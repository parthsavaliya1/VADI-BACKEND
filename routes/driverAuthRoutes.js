const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Driver = require("../models/Driver");
const Order = require("../models/Orders");
const driverOnlyMiddleware = require("../middleware/driverOnlyMiddleware");
const {
  normalizePhone,
  dispatch2FactorOtpSms,
  verify2factorSession,
  enteredOtpMatchesStored,
} = require("../utils/twoFactorSms");

const router = express.Router();

/**
 * POST /api/driver/send-otp
 * Body: { phone }
 */
router.post("/send-otp", async (req, res) => {
  try {
    const { phone, forceResend } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: "Phone is required" });
    }

    const normalizedPhone = normalizePhone(phone);
    const driver = await Driver.findOne({ phone: normalizedPhone });

    if (!driver) {
      return res.status(404).json({
        success: false,
        error: "This number is not registered as delivery staff. Ask your admin to add you.",
      });
    }

    if (!driver.isActive) {
      return res.status(403).json({ success: false, error: "Account is inactive" });
    }

    if (normalizedPhone === "+919080808080") {
      driver.otp = "123456";
      driver.otpSessionId = null;
      driver.otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
      driver.otpAttempts = 0;
      await driver.save();
      return res.json({ success: true, message: "Test code is 123456" });
    }

    const bypassCooldown = forceResend === true || forceResend === "true";
    const stillValid =
      driver.otpExpiresAt && new Date(driver.otpExpiresAt) > new Date();
    if (!bypassCooldown && (driver.otp || driver.otpSessionId) && stillValid) {
      return res.json({ success: true, message: "OTP already sent" });
    }

    const dispatched = await dispatch2FactorOtpSms(normalizedPhone);

    if (dispatched.kind === "session") {
      driver.otp = null;
      driver.otpSessionId = dispatched.sessionId;
    } else {
      driver.otp = dispatched.otp;
      driver.otpSessionId = null;
    }

    driver.otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    driver.otpAttempts = 0;
    await driver.save();

    return res.json({ success: true, message: "OTP sent" });
  } catch (err) {
    console.error("driver send-otp:", err.response?.data || err.message);
    const detail =
      (err.response?.data?.Details && String(err.response.data.Details)) ||
      err.message ||
      "";
    return res.status(500).json({
      success: false,
      error: detail && detail.length < 200 ? `Failed to send OTP: ${detail}` : "Failed to send OTP",
    });
  }
});

/**
 * POST /api/driver/verify-otp
 * Body: { phone, otp }
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ success: false, error: "Phone and OTP are required" });
    }

    const normalizedPhone = normalizePhone(phone);
    const driver = await Driver.findOne({ phone: normalizedPhone });

    if (!driver || !driver.isActive) {
      return res.status(404).json({ success: false, error: "Driver not found" });
    }

    const hasChallenge =
      driver.otpExpiresAt && (driver.otp || driver.otpSessionId);
    if (!hasChallenge) {
      return res.status(400).json({ success: false, error: "OTP not found. Request again." });
    }

    if (new Date(driver.otpExpiresAt) < new Date()) {
      return res.status(400).json({ success: false, error: "OTP expired" });
    }

    let isValid = false;
    if (driver.otpSessionId) {
      isValid = await verify2factorSession(driver.otpSessionId, otp);
    }
    if (!isValid) {
      isValid = enteredOtpMatchesStored(driver.otp, otp);
    }

    if (!isValid) {
      driver.otpAttempts = (driver.otpAttempts || 0) + 1;
      await driver.save();
      return res.status(400).json({ success: false, error: "Invalid OTP" });
    }

    driver.otp = null;
    driver.otpSessionId = null;
    driver.otpExpiresAt = null;
    await driver.save();

    const token = jwt.sign(
      { id: driver._id, role: "driver" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    return res.json({
      success: true,
      token,
      driver: {
        id: driver._id,
        phone: driver.phone,
        name: driver.name,
      },
    });
  } catch (err) {
    console.error("driver verify-otp:", err);
    return res.status(500).json({ success: false, error: "Verification failed" });
  }
});

/**
 * GET /api/driver/deliveries
 * - completed: status delivered & attributed to this driver
 * - pendingAdmin: you verified the handover code; order still out_for_delivery until admin marks Delivered
 */
router.get("/deliveries", driverOnlyMiddleware, async (req, res) => {
  try {
    const driverId = new mongoose.Types.ObjectId(req.driver.id);
    const [assigned, completed, pendingAdmin] = await Promise.all([
      Order.find({
        assignedDriver: driverId,
        status: { $in: ["confirmed", "packed", "shipped", "out_for_delivery"] },
      })
        .populate("items.product", "name image")
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean(),
      Order.find({
        status: "delivered",
        deliveredByDriver: driverId,
      })
        .populate("items.product", "name image")
        .sort({ deliveredAt: -1 })
        .limit(200)
        .lean(),
      Order.find({
        status: "out_for_delivery",
        deliveryHandoverVerifiedByDriver: driverId,
        deliveryHandoverVerifiedAt: { $ne: null },
      })
        .populate("items.product", "name image")
        .sort({ deliveryHandoverVerifiedAt: -1 })
        .limit(50)
        .lean(),
    ]);

    return res.json({
      success: true,
      data: {
        assigned,
        completed,
        pendingAdmin,
      },
    });
  } catch (err) {
    console.error("driver deliveries:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load deliveries",
      error: err.message,
    });
  }
});

router.post("/location", driverOnlyMiddleware, async (req, res) => {
  try {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ success: false, message: "Location is required" });
    }
    const updatedAt = new Date();
    await Driver.findByIdAndUpdate(req.driver.id, {
      lastLocation: { lat, lng, updatedAt },
    });
    await Order.updateMany(
      {
        assignedDriver: req.driver.id,
        status: { $in: ["shipped", "out_for_delivery"] },
      },
      { driverLocation: { lat, lng, updatedAt } },
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to save location" });
  }
});

module.exports = router;
