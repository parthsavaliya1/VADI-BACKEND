const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const router = express.Router();

const ADMIN_PHONE = "+919909049699";

const twilio = require("twilio");

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * ✅ SIGNUP
 * POST /api/auth/signup
 */
router.post("/signup", async (req, res) => {
  try {
    const { name, phone, password, profileImage, role } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const normalizedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;

    const user = await User.findOne({ phone: normalizedPhone });
    if (!user) {
      return res.status(400).json({ error: "OTP not verified" });
    }

    if (!user.isPhoneVerified) {
      return res.status(400).json({ error: "Phone not verified" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let finalRole = "user";
    if (normalizedPhone === ADMIN_PHONE && role === "admin") {
      finalRole = "admin";
    }

    user.name = name;
    user.password = hashedPassword;
    user.profileImage = profileImage;
    user.role = finalRole;

    await user.save();

    const { password: _, ...safeUser } = user.toObject();
    res.status(201).json(safeUser);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * ✅ LOGIN
 * POST /api/auth/login
 */
router.post("/login", async (req, res) => {
  try {
    const { phone, password } = req.body;

    const normalizedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;

    const user = await User.findOne({ phone: normalizedPhone });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const { password: _, ...safeUser } = user.toObject();
    res.json(safeUser);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    const normalizedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;

    let user = await User.findOne({ phone: normalizedPhone });
    if (!user) {
      user = await User.create({ phone: normalizedPhone });
    }

    // 🔐 DO NOT regenerate OTP if still valid
    if (user.otp && user.otpExpiresAt > new Date()) {
      return res.json({ success: true, message: "OTP already sent" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    user.otp = otp;
    user.otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    await client.messages.create({
      body: `Your VADI OTP is ${otp}. Valid for 5 minutes.`,
      from: process.env.TWILIO_PHONE,
      to: normalizedPhone,
    });

    console.log("✅ OTP sent:", otp);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ OTP send failed:", err);
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
    await user.save();

    // ✅ Return user data with signup status
    const { password: _, ...safeUser } = user.toObject();
    const isNewUser = !user.name || !user.password;

    res.json({
      success: true,
      phone: normalizedPhone,
      user: safeUser,
      isNewUser,
    });
  } catch (err) {
    console.error("Verify OTP failed:", err);
    res.status(500).json({ error: "OTP verification failed" });
  }
});

module.exports = router;
