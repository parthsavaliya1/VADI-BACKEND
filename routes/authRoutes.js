const express = require("express");
const axios = require("axios");
const User = require("../models/User");

const router = express.Router();

const ADMIN_PHONE = "+919909049699";
const TWO_FACTOR_API_KEY = process.env.TWO_FACTOR_API_KEY;

// -----------------------------------------------------------------
// UTIL: Send OTP via 2Factor.in
// URL format: /API/V1/{apiKey}/SMS/{phone}/AUTOGEN/OTP1
// 2Factor generates and sends the OTP — returns sessionId
// -----------------------------------------------------------------
async function sendOtpVia2Factor(phone) {
  const url = `https://2factor.in/API/V1/${TWO_FACTOR_API_KEY}/SMS/${phone}/AUTOGEN/OTP1`;
  const response = await axios.get(url);
  const data = response.data;

  // { Status: "Success", Details: "SESSION_ID" }
  if (data.Status !== "Success") {
    throw new Error(`2Factor send failed: ${data.Details}`);
  }

  return data.Details; // sessionId (not needed for VERIFY3 but useful to store)
}

// -----------------------------------------------------------------
// UTIL: Verify OTP via 2Factor.in
// URL format: /API/V1/{apiKey}/SMS/VERIFY3/{phone}/{otp}
// Note: VERIFY3 uses phone number, not sessionId
// -----------------------------------------------------------------
async function verifyOtpVia2Factor(phone, otp) {
  const url = `https://2factor.in/API/V1/${TWO_FACTOR_API_KEY}/SMS/VERIFY3/${phone}/${otp}`;
  const response = await axios.get(url);
  const data = response.data;

  // { Status: "Success", Details: "OTP Matched" }
  return data.Status === "Success" && data.Details === "OTP Matched";
}

// -----------------------------------------------------------------
// SIGNUP
// POST /api/auth/signup
// Called AFTER OTP is verified. Completes the user profile.
// -----------------------------------------------------------------
router.post("/signup", async (req, res) => {
  try {
    const { name, phone, profileImage, role } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: "Name and phone are required" });
    }

    const normalizedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;
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

    let finalRole = "user";
    if (normalizedPhone === ADMIN_PHONE && role === "admin") {
      finalRole = "admin";
    }

    user.name = name;
    user.profileImage = profileImage;
    user.role = finalRole;
    user.lastLoginAt = new Date();
    await user.save();

    res.status(201).json(user);
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------------------------------------------------
// SEND OTP
// POST /api/auth/send-otp
// Body: { phone, mode }  — mode: "signup" | "login"
// -----------------------------------------------------------------
router.post("/send-otp", async (req, res) => {
  try {
    const { phone, mode } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone is required" });
    }

    const normalizedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;
    let user = await User.findOne({ phone: normalizedPhone });

    // Block signup if already fully registered
    if (mode === "signup" && user && user.name && user.isPhoneVerified) {
      return res.status(409).json({
        error: "This phone number is already registered. Please login instead.",
      });
    }

    // Create stub user on first contact
    if (!user) {
      user = await User.create({ phone: normalizedPhone });
    }

    // Don't resend if a valid OTP window is still open
    if (user.otp && user.otpExpiresAt > new Date()) {
      return res.json({ success: true, message: "OTP already sent" });
    }

    // Send via 2Factor — they generate + deliver the OTP
    await sendOtpVia2Factor(normalizedPhone);

    // Mark OTP as sent; set 5-min expiry window on our side too
    user.otp = "sent";
    user.otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    user.otpAttempts = 0;
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error("OTP send failed:", err);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

// -----------------------------------------------------------------
// VERIFY OTP
// POST /api/auth/verify-otp
// Body: { phone, otp }
// 2Factor VERIFY3 verifies against phone number directly
// -----------------------------------------------------------------
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: "Phone and OTP are required" });
    }

    const normalizedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;
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

    // Clear OTP state, mark phone as verified
    user.otp = null;
    user.otpExpiresAt = null;
    user.otpAttempts = 0;
    user.isPhoneVerified = true;
    user.otpVerifiedAt = new Date();
    user.lastLoginAt = new Date();
    await user.save();

    const isNewUser = !user.name;

    res.json({
      success: true,
      phone: normalizedPhone,
      user,
      isNewUser,
    });
  } catch (err) {
    console.error("Verify OTP failed:", err);
    res.status(500).json({ error: "OTP verification failed" });
  }
});

module.exports = router;