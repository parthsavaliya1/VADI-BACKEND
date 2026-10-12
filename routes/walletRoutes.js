const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const { creditWallet, ensureWallet } = require("../utils/wallet");

const router = express.Router();

const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
const razorpay =
  razorpayKeyId && razorpayKeySecret
    ? new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret })
    : null;

function verifySignature(orderId, paymentId, signature) {
  if (!razorpayKeySecret) return false;
  const expected = crypto
    .createHmac("sha256", razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return expected === signature;
}

router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Valid userId is required" });
    }
    const wallet = await ensureWallet(userId);
    res.json({ success: true, data: { balance: Number(wallet.balance) } });
  } catch (error) {
    console.error("Get wallet error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch wallet" });
  }
});

router.get("/history", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Valid userId is required" });
    }
    const rows = await WalletTransaction.find({ user: userId, status: "paid" })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("order", "orderNumber")
      .lean();
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Wallet history error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch wallet history" });
  }
});

router.post("/topup/order", async (req, res) => {
  try {
    const amount = Math.round(Number(req.body.amount));
    const { userId } = req.body;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Valid userId is required" });
    }
    if (!amount || amount < 1 || amount > 100000) {
      return res.status(400).json({
        success: false,
        message: "Enter an amount between ₹1 and ₹100000",
      });
    }
    if (!razorpay) {
      return res.status(500).json({
        success: false,
        message: "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
      });
    }

    const receipt = `w${String(userId).slice(-8)}${Date.now().toString(36)}`.slice(0, 40);
    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: "INR",
      receipt,
      notes: { userId: String(userId), purpose: "wallet" },
    });

    await WalletTransaction.create({
      user: userId,
      amount,
      direction: "credit",
      reason: "topup",
      razorpayOrderId: order.id,
      status: "pending",
      balanceAfter: 0,
    });

    res.json({
      success: true,
      data: {
        key: razorpayKeyId,
        amount,
        amountInPaise: amount * 100,
        currency: "INR",
        razorpayOrderId: order.id,
        description: `Add ₹${amount} to wallet`,
      },
    });
  } catch (error) {
    console.error("Wallet topup order error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to start wallet top-up",
      error: error.message,
    });
  }
});

router.post("/topup/verify", async (req, res) => {
  try {
    const { userId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    if (!userId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        success: false,
        message: "Payment details are required",
      });
    }
    if (!verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
      return res.status(400).json({
        success: false,
        message: "Payment could not be verified",
      });
    }

    const pending = await WalletTransaction.findOne({
      user: userId,
      razorpayOrderId,
      reason: "topup",
    });
    if (!pending) {
      return res.status(404).json({ success: false, message: "Payment order not found" });
    }

    if (pending.status === "paid" && pending.razorpayPaymentId) {
      const wallet = await Wallet.findOne({ user: userId });
      return res.json({
        success: true,
        data: { balance: Number(wallet?.balance ?? 0), already_paid: true },
      });
    }

    if (razorpay) {
      const payment = await razorpay.payments.fetch(razorpayPaymentId);
      if (payment?.status !== "captured" && payment?.status !== "authorized") {
        return res.status(400).json({
          success: false,
          message: `Unexpected payment status: ${payment?.status || "unknown"}`,
        });
      }
      if (Number(payment.amount) !== Math.round(Number(pending.amount) * 100)) {
        return res.status(400).json({
          success: false,
          message: "Paid amount does not match the wallet top-up",
        });
      }
    }

    const balance = await creditWallet({
      userId,
      amount: pending.amount,
      reason: "topup",
      razorpayPaymentId,
      razorpayOrderId,
    });
    await WalletTransaction.deleteOne({ _id: pending._id, status: "pending" });

    res.json({ success: true, data: { balance } });
  } catch (error) {
    if (error?.code === 11000) {
      const wallet = await Wallet.findOne({ user: req.body.userId });
      return res.json({
        success: true,
        data: { balance: Number(wallet?.balance ?? 0), already_paid: true },
      });
    }
    console.error("Wallet verify error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add money to wallet",
      error: error.message,
    });
  }
});

module.exports = router;
