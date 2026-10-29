const express = require("express");
const { getRemoteConfig } = require("firebase-admin/remote-config");
const { ensureFirebaseApp } = require("../config/firebaseAdmin");

const router = express.Router();

/** Remote Config parameter key (same as Firebase Console). */
const RC_API_BASE_URL_KEY = "api_base_url";

/**
 * @param {unknown} dv
 */
function pickStringFromDefaultValue(dv) {
  if (!dv || typeof dv !== "object") return "";
  if ("value" in dv && typeof dv.value === "string") {
    return dv.value.trim();
  }
  return "";
}

/**
 * Reads string from Remote Config parameter (default or first conditional value).
 * @param {import("firebase-admin/remote-config").RemoteConfigTemplate} template
 * @param {string} key
 */
function getStringFromTemplate(template, key) {
  const param = template?.parameters?.[key];
  if (!param || typeof param !== "object") return "";

  const fromDefault = pickStringFromDefaultValue(param.defaultValue);
  if (fromDefault) return fromDefault;

  const cv = param.conditionalValues;
  if (cv && typeof cv === "object") {
    for (const name of Object.keys(cv)) {
      const v = pickStringFromDefaultValue(cv[name]);
      if (v) return v;
    }
  }
  return "";
}

/**
 * GET /app-config
 * Public JSON: reads Firebase Remote Config server template (works with React Native).
 */
router.get("/app-config", async (req, res) => {
  try {
    const rc = getRemoteConfig(ensureFirebaseApp());
    const template = await rc.getTemplate();
    const apiBaseUrl = getStringFromTemplate(template, RC_API_BASE_URL_KEY);

    if (!apiBaseUrl) {
      const keys = template?.parameters
        ? Object.keys(template.parameters).slice(0, 30)
        : [];
      console.warn(
        "[app-config] Remote Config has no string value for",
        RC_API_BASE_URL_KEY,
        "— template keys:",
        keys.join(", ") || "(none)",
      );
    }

    return res.json({
      success: true,
      apiBaseUrl,
    });
  } catch (error) {
    console.error("GET /app-config error:", error?.message || error);
    return res.status(503).json({
      success: false,
      apiBaseUrl: "",
      message:
        error?.message ||
        "Could not load Remote Config (check Firebase Admin env and Remote Config API).",
    });
  }
});

module.exports = router;
