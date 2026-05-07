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

/**
 * Send OTP via 2Factor API.
 * Docs: https://2factor.in/API/
 * Returns the session ID string on success, throws on failure.
 */
async function send2FactorOTP(phone, otp) {
  const tenDigit = phone.replace(/^\+91/, ""); // 2factor expects 10 digits

  const url = `https://2factor.in/API/V1/${process.env.TWO_FACTOR_API_KEY}/SMS/${tenDigit}/${otp}`;

  const response = await axios.get(url);

  if (response.data?.Status !== "Success") {
    throw new Error(response.data?.Details || "2Factor OTP send failed");
  }

  return response.data.Details; // session ID
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
    const { phone, mode } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone is required" });
    }

    const normalizedPhone = normalizePhone(phone);

    if (!phone) {
      return res.status(400).json({ error: "Phone is required" });
    }

    let user = await User.findOne({ phone: normalizedPhone });

    // Block re-signup for already-registered numbers
    if (mode === "signup" && user && user.name && user.isPhoneVerified) {
      return res.status(409).json({
        error: "This phone number is already registered. Please login instead.",
      });
    }

    // Create a placeholder user so we can attach OTP before verification
    if (!user) {
      user = await User.create({ phone: normalizedPhone });
    }

    // ── Dummy account: skip real OTP ──────────────────────────────────
    if (isDummyPhone(normalizedPhone)) {
      user.otp          = DUMMY_OTP;
      user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
      await user.save();

      console.log(`[DEV] Dummy OTP for ${normalizedPhone}: ${DUMMY_OTP}`);

      return res.json({
        success: true,
        message: "OTP sent (dummy account)",
        // expose in dev/test so the frontend can auto-fill if needed
        ...(process.env.NODE_ENV !== "production" && { devOtp: DUMMY_OTP }),
      });
    }

    // ── Real account: don't regenerate if a valid OTP already exists ──
    if (user.otp && user.otpExpiresAt > new Date()) {
      return res.json({ success: true, message: "OTP already sent" });
    }

    // Generate fresh OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Send via 2Factor
    await send2FactorOTP(normalizedPhone, otp);

    user.otp          = otp;
    user.otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min
    await user.save();

    return res.json({ success: true });
  } catch (err) {
    console.error("send-otp error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to send OTP" });
  }
});

/**
 * POST /api/auth/verify-otp
 * Body: { phone, otp }
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: "Phone and OTP are required" });
    }

    const normalizedPhone = normalizePhone(phone);
    const user = await User.findOne({ phone: normalizedPhone });

    if (!user || !user.otp || !user.otpExpiresAt) {
      return res.status(400).json({ error: "OTP not found. Request again." });
    }

    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({ error: "OTP expired" });
    }

    // Verify with 2Factor using phone + user-entered OTP
    const isValid = await verifyOtpVia2Factor(normalizedPhone, otp);

    if (!isValid) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      await user.save();
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // Clear OTP fields
    user.otp            = null;
    user.otpExpiresAt   = null;
    user.isPhoneVerified = true;
    user.lastLoginAt    = new Date();

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
 * POST /api/auth/signup
 * Body: { name, phone, profileImage?, role? }
 */
router.post("/signup", async (req, res) => {
  try {
    const { name, phone, profileImage, role } = req.body;

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