const express = require("express");
const mongoose = require("mongoose");
const Wishlist = require("../models/Wishlist");
const Product = require("../models/Product");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }
    const rows = await Wishlist.find({ user: userId })
      .sort({ createdAt: -1 })
      .populate({
        path: "product",
        match: { isActive: true },
        populate: { path: "category", select: "name slug" },
      })
      .lean();
    res.json({
      success: true,
      data: rows.filter((row) => row.product).map((row) => row.product),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load wishlist" });
  }
});

router.get("/check", async (req, res) => {
  try {
    const { userId, productId } = req.query;
    if (
      !mongoose.Types.ObjectId.isValid(userId) ||
      !mongoose.Types.ObjectId.isValid(productId)
    ) {
      return res.json({ success: true, data: { saved: false } });
    }
    const saved = await Wishlist.exists({ user: userId, product: productId });
    res.json({ success: true, data: { saved: Boolean(saved) } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to check wishlist" });
  }
});

router.post("/toggle", async (req, res) => {
  try {
    const { userId, productId } = req.body;
    if (
      !mongoose.Types.ObjectId.isValid(userId) ||
      !mongoose.Types.ObjectId.isValid(productId)
    ) {
      return res.status(400).json({ success: false, message: "User and product are required" });
    }
    const product = await Product.findById(productId).select("_id isActive");
    if (!product || !product.isActive) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    const existing = await Wishlist.findOne({ user: userId, product: productId });
    if (existing) {
      await existing.deleteOne();
      return res.json({ success: true, data: { saved: false } });
    }
    await Wishlist.create({ user: userId, product: productId });
    res.json({ success: true, data: { saved: true } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update wishlist" });
  }
});

module.exports = router;
