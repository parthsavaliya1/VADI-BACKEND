const axios = require("axios");

const TWO_FACTOR_API_KEY = process.env.TWO_FACTOR_API_KEY;

/**
 * Normalise any phone input → "+91XXXXXXXXXX"
 */
function normalizePhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (String(phone ?? "").trim().startsWith("+91")) return String(phone).trim();
  return `+91${digits}`;
}

/**
 * 2factor.in — try AUTOGEN first, then manual OTP URL (same as customer login).
 * @returns {{ kind: 'session', sessionId: string } | { kind: 'otp', otp: string }}
 */
async function dispatch2FactorOtpSms(normalizedPhoneWith91) {
  const key = TWO_FACTOR_API_KEY;
  if (!key || typeof key !== "string" || !key.trim()) {
    throw new Error("TWO_FACTOR_API_KEY missing in backend .env — SMS OTP cannot send");
  }

  const tenDigit = normalizedPhoneWith91.replace(/^\+91/, "");

  try {
    const autogenUrl = `https://2factor.in/API/V1/${key}/SMS/${tenDigit}/AUTOGEN`;
    const autogenRes = await axios.get(autogenUrl);
    const sessionId =
      typeof autogenRes.data?.Details === "string" ? autogenRes.data.Details : "";

    if (autogenRes.data?.Status === "Success" && sessionId) {
      return { kind: "session", sessionId };
    }
    console.warn("2Factor AUTOGEN non-success:", autogenRes.data || autogenRes.status);
  } catch (e) {
    console.warn(
      "2Factor AUTOGEN failed, trying manual OTP URL:",
      e.response?.data || e.message || e,
    );
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const manualUrl = `https://2factor.in/API/V1/${key}/SMS/${tenDigit}/${otp}`;
  const response = await axios.get(manualUrl);

  if (response.data?.Status !== "Success") {
    const detail =
      response.data?.Details ||
      JSON.stringify(response.data || {}) ||
      "2Factor manual OTP send failed";
    throw new Error(detail);
  }

  return { kind: "otp", otp };
}

/** Verify OTP typed by user against an AUTOGEN session */
async function verify2factorSession(sessionId, enteredOtp) {
  const key = TWO_FACTOR_API_KEY;
  const code = String(enteredOtp ?? "").replace(/\D/g, "").slice(0, 6);
  if (!key || !sessionId || code.length !== 6) return false;

  try {
    const url = `https://2factor.in/API/V1/${key}/SMS/VERIFY/${sessionId}/${code}`;
    const r = await axios.get(url);
    return r.data?.Status === "Success";
  } catch (e) {
    console.warn("2Factor VERIFY error:", e.response?.data || e.message);
    return false;
  }
}

function enteredOtpMatchesStored(storedOtp, enteredRaw) {
  const entered = String(enteredRaw ?? "").replace(/\D/g, "").slice(0, 6);
  if (!entered || entered.length !== 6) return false;
  return String(storedOtp ?? "") === entered;
}

/**
 * Send SMS with an exact 6-digit code (delivery handover). Uses 2factor transactional
 * manual OTP URL — same channel as login OTP.
 */
async function sendCustomSixDigitOtpSms(normalizedPhoneWith91, sixDigitCode) {
  const key = TWO_FACTOR_API_KEY?.trim();
  if (!key) {
    return { sent: false, reason: "TWO_FACTOR_API_KEY missing" };
  }
  const tenDigit = normalizedPhoneWith91.replace(/^\+91/, "");
  const code = String(sixDigitCode ?? "").replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) {
    return { sent: false, reason: "invalid_code" };
  }

  const url = `https://2factor.in/API/V1/${key}/SMS/${tenDigit}/${code}`;
  try {
    const response = await axios.get(url);
    if (response.data?.Status !== "Success") {
      const detail =
        response.data?.Details || JSON.stringify(response.data || {}) || "2Factor send failed";
      return { sent: false, reason: detail };
    }
    return { sent: true };
  } catch (e) {
    console.error("2factor custom OTP SMS:", e.response?.data || e.message);
    return { sent: false, reason: e.message || "request_failed" };
  }
}

module.exports = {
  normalizePhone,
  dispatch2FactorOtpSms,
  verify2factorSession,
  enteredOtpMatchesStored,
  sendCustomSixDigitOtpSms,
};
