const express = require("express");
const User = require("../models/User");
const {
  normalizePhone,
  dispatch2FactorOtpSms,
  verify2factorSession,
  enteredOtpMatchesStored,
} = require("../utils/twoFactorSms");
const { attachReferrer, ensureReferralCode } = require("../utils/referralReward");

const { authenticate, customerToken, publicUser } = require('../middleware/sessionAuth');
const router = express.Router();
const authAttempts = new Map();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['/send-otp', '/verify-otp', '/signup'].includes(req.path)) return next();
  const now = Date.now();
  for (const [key, val] of authAttempts) if (val.until < now) authAttempts.delete(key);
  const key = req.ip;
  const entry = authAttempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  entry.count += 1; authAttempts.set(key, entry);
  if (entry.count > 30) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  return next();
});

/* ────────────────────────────────────────────
   CONFIG
──────────────────────────────────────────── */

const ADMIN_PHONE = "+919909049699";

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
    if (!/^\+91[6-9]\d{9}$/.test(normalizedPhone)) return res.status(400).json({ error: "Enter a valid Indian mobile number" });

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

    if (user.isDemo || user.status === 'blocked') return res.status(403).json({ error: 'Use assigned test credentials, or contact support for account access' });
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

    user.otpAttempts = 0;
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

    if (user.isDemo || user.status === 'blocked') return res.status(403).json({ error: 'Account unavailable for OTP sign-in' });
    if ((user.otpAttempts || 0) >= 5) return res.status(429).json({ error: 'Too many incorrect codes. Request a new OTP after expiry.' });
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
      user: publicUser(user),
      token: customerToken(user),
      isNewUser,
    });
  } catch (err) {
    console.error("verify-otp error:", err);
    return res.status(500).json({ error: "OTP verification failed" });
  }
});

// Removed phone-only demo bypass; dedicated credentials are handled by reviewAuthRoutes.
/**
 * POST /api/auth/signup
 * Body: { name, phone, profileImage?, role? }
 */
router.post("/signup", authenticate, async (req, res) => {
  try {
    const { name, phone, profileImage, role, privacyPolicyAccepted, referralCode } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: "Name and phone are required" });
    }

    const normalizedPhone = normalizePhone(phone);
    const user = await User.findOne({ phone: normalizedPhone });

    if (!user) {
      return res.status(400).json({ error: "OTP not verified" });
    }

    if (req.auth.role !== "customer" || req.auth.id !== String(user._id)) return res.status(403).json({ error: "Verify your own phone before signup" });

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

    await attachReferrer(user, referralCode);
    await ensureReferralCode(user);

    return res.status(201).json({ ...publicUser(user), token: customerToken(user) });
  } catch (err) {
    console.error("signup error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/auth/push-token
 * Body: { userId, pushToken, platform? }
 */
router.post("/push-token", authenticate, async (req, res) => {
  try {
    const { userId, pushToken, platform = "unknown" } = req.body;
    if (req.auth.role !== "customer" || String(userId) !== req.auth.id) return res.status(403).json({ error: "Account access denied" });

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