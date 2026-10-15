const express = require("express");
const mongoose = require("mongoose");
const SupportMessage = require("../models/SupportMessage");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }
    const data = await SupportMessage.find({ user: userId }).sort({ createdAt: 1 }).limit(100).lean();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load messages" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { userId, body, orderId } = req.body || {};
    const text = String(body || "").trim();
    if (!userId || !mongoose.Types.ObjectId.isValid(userId) || text.length < 2) {
      return res.status(400).json({ success: false, message: "Write a short message" });
    }
    const message = await SupportMessage.create({
      user: userId,
      body: text.slice(0, 1000),
      order: orderId && mongoose.Types.ObjectId.isValid(orderId) ? orderId : null,
      from: "customer",
    });
    res.status(201).json({ success: true, data: message });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to send message" });
  }
});

module.exports = router;
