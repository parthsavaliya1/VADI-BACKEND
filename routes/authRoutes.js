const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const router = express.Router();

const ADMIN_PHONE = "+919909049699";

const axios = require("axios");

/**
 * ✅ SIGNUP
 * POST /api/auth/signup
 */

router.post("/signup", async (req, res) => {
  try {
    const { name, phone, profileImage, role } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: "Name and phone are required" });
    }

    const normalizedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;

    const user = await User.findOne({ phone: normalizedPhone });

    // ❌ If no user found (OTP not verified)
    if (!user) {
      return res.status(400).json({ error: "OTP not verified" });
    }

    // ❌ If phone not verified
    if (!user.isPhoneVerified) {
      return res.status(400).json({ error: "Phone not verified" });
    }

    // ❌ If user already completed signup
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
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/send-otp", async (req, res) => {
  try {
    const { phone, mode } = req.body;

    const cleanPhone = phone.replace(/\D/g, "");
    const normalizedPhone =
      cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

    let user = await User.findOne({ phone: `+${normalizedPhone}` });

    // 🚨 If signup mode and already registered
    if (mode === "signup" && user && user.name && user.isPhoneVerified) {
      return res.status(409).json({
        error: "This phone number is already registered. Please login instead.",
      });
    }

    if (!user) {
      user = await User.create({ phone: `+${normalizedPhone}` });
    }

    // Prevent regenerating valid OTP
    if (user.otp && user.otpExpiresAt > new Date()) {
      return res.json({ success: true, message: "OTP already sent" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    user.otp = otp;
    user.otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    // 🔥 SEND OTP VIA MSG91
    await axios.post(
      "https://control.msg91.com/api/v5/otp",
      {
        mobile: normalizedPhone,
        otp: otp,
        sender: process.env.MSG91_SENDER_ID,
      },
      {
        headers: {
          authkey: process.env.MSG91_AUTH_KEY,
          "Content-Type": "application/json",
        },
      },
    );

    res.json({ success: true });
  } catch (err) {
    console.error("MSG91 OTP send failed:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp } = req.body;

    const normalizedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;
    const user = await User.findOne({ phone: normalizedPhone });

    if (!user || !user.otp || !user.otpExpiresAt) {
      return res.status(400).json({ error: "OTP not found. Request again." });
    }

    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({ error: "OTP expired" });
    }

    if (String(user.otp) !== String(otp)) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    user.otp = null;
    user.otpExpiresAt = null;
    user.isPhoneVerified = true;
    user.lastLoginAt = new Date();

    await user.save();

    // New user if name not set yet
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
