const express = require("express");
const axios = require("axios");
const User = require("../models/User");

const router = express.Router();

/* ────────────────────────────────────────────
   CONFIG
──────────────────────────────────────────── */

const ADMIN_PHONE = "+919909049699";
const TWO_FACTOR_API_KEY = process.env.TWO_FACTOR_API_KEY;

// Dummy / test account — bypasses real OTP
// Set DUMMY_PHONE and DUMMY_OTP in your .env to override defaults
const DUMMY_PHONE = process.env.DUMMY_PHONE || "+919999999999";
const DUMMY_OTP   = process.env.DUMMY_OTP   || "123456";

// Demo/review account — can login without OTP (for Play Store review)
// Set DEMO_PHONE in your .env to override defaults
const DEMO_PHONE = process.env.DEMO_PHONE || DUMMY_PHONE;

/* ────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────── */

/**
 * Normalise any phone input → "+91XXXXXXXXXX"
 */
function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, "");
  // already has country code
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }
  // bare 10-digit
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  // already "+91..."
  if (phone.startsWith("+91")) return phone;
  return `+91${digits}`;
}

/**
 * Returns true for the dummy/test account.
 */
function isDummyPhone(phone) {
  return normalizePhone(phone) === normalizePhone(DUMMY_PHONE);
}

function isDemoPhone(phone) {
  return normalizePhone(phone) === normalizePhone(DEMO_PHONE);
}

/**
 * 2factor.in — try AUTOGEN first (recommended for OTP SMS), then manual OTP URL.
 * @returns {{ kind: 'session', sessionId: string } | { kind: 'otp', otp: string }}
 */
async function dispatch2FactorOtpSms(normalizedPhoneWith91) {
  const key = TWO_FACTOR_API_KEY;
  if (!key || typeof key !== "string" || !key.trim()) {
    throw new Error("TWO_FACTOR_API_KEY missing in backend .env — SMS OTP cannot send");
  }

  const tenDigit = normalizedPhoneWith91.replace(/^\+91/, "");

  /**
   * AUTOGEN: 2Factor generates OTP and sends SMS.
   * @see https://2factor.in – SMS OTP / AUTOGEN
   */
  try {
    const autogenUrl = `https://2factor.in/API/V1/${key}/SMS/${tenDigit}/AUTOGEN`;
    const autogenRes = await axios.get(autogenUrl);
    const sessionId =
      typeof autogenRes.data?.Details === "string"
        ? autogenRes.data.Details
        : "";

    if (autogenRes.data?.Status === "Success" && sessionId) {
      return { kind: "session", sessionId };
    }
    console.warn(
      "2Factor AUTOGEN non-success:",
      autogenRes.data || autogenRes.status
    );
  } catch (e) {
    console.warn(
      "2Factor AUTOGEN failed, trying manual OTP URL:",
      e.response?.data || e.message || e
    );
  }

  /** Manual: we generate OTP — some accounts only support transactional SMS this way */
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
  const key = process.env.TWO_FACTOR_API_KEY || TWO_FACTOR_API_KEY;
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

/**
 * Compare OTP the user typed with what we saved when triggering SMS via 2Factor.
 * The SMS body contains the same OTP as `user.otp` (stored in send-otp).
 * (Separate 2factor "VERIFY" session endpoints are unused here because we persist the code.)
 */
function enteredOtpMatchesStored(storedOtp, enteredRaw) {
  const entered = String(enteredRaw ?? "").replace(/\D/g, "").slice(0, 6);
  if (!entered || entered.length !== 6) return false;
  return String(storedOtp ?? "") === entered;
}

/* ────────────────────────────────────────────
   ROUTES
──────────────────────────────────────────── */

/**
 * POST /api/auth/send-otp
 * Body: { phone, mode }   mode = "signup" | "login"
 */
router.post("/send-otp", async (req, res) => {
  try {
    const { phone, mode, forceResend } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone is required" });
    }

    if (mode !== "signup" && mode !== "login") {
      return res.status(400).json({ error: 'mode must be "signup" or "login"' });
    }

    const normalizedPhone = normalizePhone(phone);

    if (!phone) {
      return res.status(400).json({ error: "Phone is required" });
    }

    let user = await User.findOne({ phone: normalizedPhone });

    // For login: DO NOT create placeholder users.
    // If user doesn't exist, return immediately.
    if (mode === "login" && !user) {
      return res.status(404).json({ error: "Account not found. Please sign up." });
    }

    // Block re-signup for already-registered numbers
    if (mode === "signup" && user && user.name && user.isPhoneVerified) {
      return res.status(409).json({
        error: "This phone number is already registered. Please login instead.",
      });
    }

    // Create a placeholder user so we can attach OTP before verification
    if (mode === "signup" && !user) {
      user = await User.create({ phone: normalizedPhone });
    }

    // ── Dummy account: skip real OTP ──────────────────────────────────
    if (isDummyPhone(normalizedPhone)) {
      user.otp            = DUMMY_OTP;
      user.otpSessionId   = null;
      user.otpExpiresAt   = new Date(Date.now() + 10 * 60 * 1000); // 10 min
      await user.save();

      console.log(`[DEV] Dummy OTP for ${normalizedPhone}: ${DUMMY_OTP}`);

      return res.json({
        success: true,
        message: "OTP sent (dummy account)",
        // expose in dev/test so the frontend can auto-fill if needed
        ...(process.env.NODE_ENV !== "production" && { devOtp: DUMMY_OTP }),
      });
    }

    const bypassCooldown =
      forceResend === true ||
      forceResend === "true";

    /**
     * Without forceResend, avoid spamming SMS. With forceResend (app "Resend OTP"),
     * send a fresh code even if the previous one hasn't expired yet.
     */
    const stillValidExpiry =
      user.otpExpiresAt && new Date(user.otpExpiresAt) > new Date();

    if (
      !bypassCooldown &&
      (user.otp || user.otpSessionId) &&
      stillValidExpiry
    ) {
      return res.json({ success: true, message: "OTP already sent" });
    }

    const dispatched = await dispatch2FactorOtpSms(normalizedPhone);

    if (dispatched.kind === "session") {
      user.otp          = null;
      user.otpSessionId = dispatched.sessionId;
    } else {
      user.otp          = dispatched.otp;
      user.otpSessionId = null;
    }

    user.otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min
    await user.save();

    return res.json({ success: true });
  } catch (err) {
    console.error("send-otp error:", err.response?.data || err.message);
    const detail =
      (err.response?.data?.Details && String(err.response.data.Details)) ||
      err.message ||
      "";
    const msg =
      detail && String(detail).length && String(detail).length < 200
        ? `Failed to send OTP: ${detail}`
        : "Failed to send OTP";
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/auth/verify-otp
 * Body: { phone, otp }
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp, privacyPolicyAccepted } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: "Phone and OTP are required" });
    }

    const normalizedPhone = normalizePhone(phone);
    const user = await User.findOne({ phone: normalizedPhone });

    const hasChallenge =
      user &&
      user.otpExpiresAt &&
      (user.otp || user.otpSessionId);

    if (!hasChallenge || !user) {
      return res.status(400).json({ error: "OTP not found. Request again." });
    }

    if (new Date(user.otpExpiresAt) < new Date()) {
      return res.status(400).json({ error: "OTP expired" });
    }

    let isValid = false;
    if (user.otpSessionId) {
      isValid = await verify2factorSession(user.otpSessionId, otp);
    }
    if (!isValid) {
      isValid = enteredOtpMatchesStored(user.otp, otp);
    }

    if (!isValid) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      await user.save();
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // Clear OTP fields
    user.otp            = null;
    user.otpSessionId   = null;
    user.otpExpiresAt   = null;
    user.isPhoneVerified = true;
    user.otpVerifiedAt  = new Date();
    user.lastLoginAt    = new Date();

    if (privacyPolicyAccepted === true) {
      user.privacyPolicyAccepted = true;
      if (!user.privacyPolicyAcceptedAt) {
        user.privacyPolicyAcceptedAt = new Date();
      }
    }

    await user.save();

    const isNewUser = !user.name;

    return res.json({
      success: true,
      phone: normalizedPhone,
      user,
      isNewUser,
    });
  } catch (err) {
    console.error("verify-otp error:", err);
    return res.status(500).json({ error: "OTP verification failed" });
  }
});

/**
 * POST /api/auth/demo-login
 * Body: { phone }
 *
 * For Play Store review: allow a single demo number to login without OTP.
 */
router.post("/demo-login", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone is required" });

    const normalizedPhone = normalizePhone(phone);
    if (!isDemoPhone(normalizedPhone)) {
      return res.status(403).json({ error: "Demo login not allowed for this number" });
    }

    let user = await User.findOne({ phone: normalizedPhone });
    if (!user) {
      user = await User.create({
        phone: normalizedPhone,
        name: "Demo User",
        role: "user",
        isPhoneVerified: true,
        otp: null,
        otpExpiresAt: null,
        otpVerifiedAt: new Date(),
        lastLoginAt: new Date(),
      });
    } else {
      user.isPhoneVerified = true;
      if (!user.name) user.name = "Demo User";
      user.otp = null;
      user.otpExpiresAt = null;
      user.otpVerifiedAt = new Date();
      user.lastLoginAt = new Date();
      await user.save();
    }

    return res.json({ success: true, user });
  } catch (err) {
    console.error("demo-login error:", err);
    return res.status(500).json({ error: "Demo login failed" });
  }
});

/**
 * POST /api/auth/signup
 * Body: { name, phone, profileImage?, role? }
 */
router.post("/signup", async (req, res) => {
  try {
    const { name, phone, profileImage, role, privacyPolicyAccepted } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: "Name and phone are required" });
    }

    const normalizedPhone = normalizePhone(phone);
    const user = await User.findOne({ phone: normalizedPhone });

    if (!user) {
      return res.status(400).json({ error: "OTP not verified" });
    }

    if (!user.isPhoneVerified) {
      return res.status(400).json({ error: "Phone not verified" });
    }

    if (user.name && user.isPhoneVerified) {
      return res.status(409).json({
        error: "This phone number is already registered. Please login instead.",
      });
    }

    // Only allow admin role for the designated admin number
    let finalRole = "user";
    if (normalizedPhone === ADMIN_PHONE && role === "admin") {
      finalRole = "admin";
    }

    user.name         = name;
    user.profileImage = profileImage;
    user.role         = finalRole;
    user.lastLoginAt  = new Date();

    if (privacyPolicyAccepted === true) {
      user.privacyPolicyAccepted = true;
      if (!user.privacyPolicyAcceptedAt) {
        user.privacyPolicyAcceptedAt = new Date();
      }
    }

    await user.save();

    return res.status(201).json(user);
  } catch (err) {
    console.error("signup error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/auth/push-token
 * Body: { userId, pushToken, platform? }
 */
router.post("/push-token", async (req, res) => {
  try {
    const { userId, pushToken, platform = "unknown" } = req.body;

    if (!userId || !pushToken) {
      return res.status(400).json({ error: "userId and pushToken are required" });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.pushToken = String(pushToken).trim();
    user.pushPlatform = ["ios", "android", "web"].includes(platform)
      ? platform
      : "unknown";
    user.pushTokenUpdatedAt = new Date();

    await user.save();

    return res.json({ success: true });
  } catch (err) {
    console.error("push-token error:", err);
    return res.status(500).json({ error: "Failed to save push token" });
  }
});

module.exports = router;