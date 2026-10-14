const express = require("express");
const AppThemeSettings = require("../models/AppThemeSettings");

const { THEME_KEYS } = AppThemeSettings;
const router = express.Router();

const getOrCreateSettings = async () => {
  let doc = await AppThemeSettings.findOne({ key: "default" });
  if (!doc) {
    doc = await AppThemeSettings.create({ key: "default" });
  }
  return doc;
};

router.get("/", async (_req, res) => {
  try {
    const settings = await getOrCreateSettings();
    return res.json({
      success: true,
      data: { theme: settings.theme, themes: THEME_KEYS },
    });
  } catch (error) {
    console.error("Get app theme error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch app theme",
      error: error.message,
    });
  }
});

router.put("/", async (req, res) => {
  try {
    const { theme } = req.body || {};
    if (!THEME_KEYS.includes(theme)) {
      return res.status(400).json({
        success: false,
        message: `theme must be one of: ${THEME_KEYS.join(", ")}`,
      });
    }

    const settings = await getOrCreateSettings();
    settings.theme = theme;
    await settings.save();

    return res.json({
      success: true,
      message: "App theme updated",
      data: { theme: settings.theme, themes: THEME_KEYS },
    });
  } catch (error) {
    console.error("Update app theme error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update app theme",
      error: error.message,
    });
  }
});

module.exports = router;
