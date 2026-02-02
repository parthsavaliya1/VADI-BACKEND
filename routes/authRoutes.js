const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const router = express.Router();

const ADMIN_PHONE = "+919909049699";

/**
 * ✅ SIGNUP
 * POST /api/auth/signup
 */
router.post("/signup", async (req, res) => {
  try {
    const { name, phone, password, dob, profileImage, role } = req.body;

    // ✅ Validate
    if (!name || !phone || !password || !dob) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // ✅ Normalize phone (safety)
    const normalizedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;

    // ✅ Check existing user
    const existing = await User.findOne({ phone: normalizedPhone });
    if (existing) {
      return res.status(400).json({ error: "User already exists" });
    }

    // ✅ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ Decide role (BACKEND AUTHORITY)
    let finalRole = "user";
    if (normalizedPhone === ADMIN_PHONE && role === "admin") {
      finalRole = "admin";
    }

    const user = await User.create({
      name,
      phone: normalizedPhone,
      password: hashedPassword,
      dob,
      profileImage,
      role: finalRole,
    });

    // ❌ Never send password
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
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: "Phone required" });
  }

  let user = await User.findOne({ phone });

  if (!user) {
    user = await User.create({ phone });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  user.otp = otp;
  user.otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await user.save();

  // 🔔 SEND SMS HERE (Twilio / MSG91)
  console.log("OTP:", otp); // DEV ONLY

  res.json({ success: true });
});

router.post("/verify-otp", async (req, res) => {
  const { phone, otp } = req.body;

  const user = await User.findOne({ phone });

  if (!user || user.otp !== otp) {
    return res.status(400).json({ error: "Invalid OTP" });
  }

  if (user.otpExpiresAt < new Date()) {
    return res.status(400).json({ error: "OTP expired" });
  }

  user.otp = null;
  user.otpExpiresAt = null;
  await user.save();

  const { password, ...safeUser } = user.toObject();
  res.json(safeUser);
});

module.exports = router;
