const axios = require("axios");

const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_CHUNK_SIZE = 100;
/** Keep the message on FCM/APNs so a powered-off phone still receives it after it turns on. */
const EXPO_TTL_SECONDS = 60 * 60 * 24 * 28;
const EXPO_TOKEN_REGEX = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

function isExpoPushToken(token) {
  return EXPO_TOKEN_REGEX.test(String(token || "").trim());
}

/**
 * Visible, high-priority Expo push. The OS shows this when the app is killed
 * and the screen is off — same delivery path as VADI Hisab.
 */
async function sendExpoPush(tokens, { title, body, imageUrl }) {
  const unique = [...new Set((tokens || []).map((t) => String(t).trim()).filter(isExpoPushToken))];
  const failureReasons = {};
  const invalidTokens = [];
  let successCount = 0;
  let failureCount = 0;

  if (!unique.length) {
    return { successCount, failureCount, invalidTokens, failureReasons };
  }

  const imageUrlStr = imageUrl ? String(imageUrl).trim() : "";
  const data = { clickAction: "open_notifications" };
  if (imageUrlStr) {
    data.imageUrl = imageUrlStr;
    data.image = imageUrlStr;
  }

  for (let i = 0; i < unique.length; i += EXPO_CHUNK_SIZE) {
    const chunk = unique.slice(i, i + EXPO_CHUNK_SIZE);
    const messages = chunk.map((to) => {
      const msg = {
        to,
        title: String(title),
        body: String(body),
        sound: "default",
        priority: "high",
        channelId: "default",
        ttl: EXPO_TTL_SECONDS,
        expiration: Math.floor(Date.now() / 1000) + EXPO_TTL_SECONDS,
        data,
      };
      if (imageUrlStr) {
        msg.mutableContent = true;
        msg.richContent = { image: imageUrlStr };
      }
      return msg;
    });

    let tickets = [];
    try {
      const response = await axios.post(EXPO_PUSH_API_URL, messages, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        timeout: 20000,
      });
      tickets = Array.isArray(response.data?.data) ? response.data.data : [];
    } catch (error) {
      const status = error.response?.status || "network";
      failureReasons[`expo-http-${status}`] =
        (failureReasons[`expo-http-${status}`] || 0) + chunk.length;
      failureCount += chunk.length;
      console.error("[expoPush] send failed:", error.response?.data || error.message);
      continue;
    }

    tickets.forEach((ticket, idx) => {
      if (ticket?.status === "ok") {
        successCount += 1;
        return;
      }
      failureCount += 1;
      const code = ticket?.details?.error || ticket?.message || "unknown";
      failureReasons[code] = (failureReasons[code] || 0) + 1;
      if (code === "DeviceNotRegistered" && chunk[idx]) {
        invalidTokens.push(chunk[idx]);
      }
    });

    if (tickets.length < chunk.length) {
      const missing = chunk.length - tickets.length;
      failureCount += missing;
      failureReasons["missing-ticket"] = (failureReasons["missing-ticket"] || 0) + missing;
    }
  }

  return { successCount, failureCount, invalidTokens, failureReasons };
}

module.exports = { isExpoPushToken, sendExpoPush };
