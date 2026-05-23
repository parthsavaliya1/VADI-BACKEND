const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const TAG_LEN = 16;

let cachedAesKey = null;

function getAesKey() {
  if (cachedAesKey) return cachedAesKey;
  const secret =
    process.env.DELIVERY_HANDOVER_SECRET ||
    process.env.JWT_SECRET ||
    "vadi-dev-delivery-handover-change-me";
  cachedAesKey = crypto.createHash("sha256").update(String(secret), "utf8").digest();
  return cachedAesKey;
}

/** 6-digit numeric string */
function generateHandoverCode() {
  return String(100000 + crypto.randomInt(900000));
}

function encryptHandoverCode(plain) {
  const key = getAesKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv, {
    authTagLength: TAG_LEN,
  });
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

function decryptHandoverCode(payload) {
  if (!payload || typeof payload !== "string") return null;
  const buf = Buffer.from(payload, "base64url");
  if (buf.length < IV_LEN + TAG_LEN + 1) return null;
  const key = getAesKey();
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv, {
    authTagLength: TAG_LEN,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

function normalizeCodeInput(input) {
  if (input == null) return "";
  return String(input).replace(/\D/g, "").slice(0, 6);
}

function codesEqualTimingSafe(a, b) {
  const x = Buffer.from(String(a), "utf8");
  const y = Buffer.from(String(b), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

const MAX_WRONG_ATTEMPTS = 5;

const {
  normalizePhone: normalizePhoneIndia,
  sendCustomSixDigitOtpSms,
} = require("./twoFactorSms");

/**
 * SMS delivery handover code using 2factor.in (same API key as login OTP).
 * @param {string} orderNumber — used for logs only; 2factor template is fixed for manual OTP
 */
async function sendHandoverSmsIfConfigured(toPhone, code, orderNumber) {
  try {
    const normalized = normalizePhoneIndia(String(toPhone ?? "").trim());
    const result = await sendCustomSixDigitOtpSms(normalized, code);
    if (!result.sent) {
      console.warn(
        `Handover SMS not sent for order ${orderNumber}:`,
        result.reason || "unknown",
      );
    }
    return result;
  } catch (e) {
    console.error("sendHandoverSmsIfConfigured:", e.message);
    return { sent: false, reason: e.message };
  }
}

module.exports = {
  generateHandoverCode,
  encryptHandoverCode,
  decryptHandoverCode,
  normalizeCodeInput,
  codesEqualTimingSafe,
  MAX_WRONG_ATTEMPTS,
  sendHandoverSmsIfConfigured,
};
