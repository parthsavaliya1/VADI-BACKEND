const express = require("express");
const mongoose = require("mongoose");
const Coupon = require("../models/Coupon");
const Cart = require("../models/Cart");
const { quoteCoupon } = require("../utils/coupon");

const publicRouter = express.Router();
const adminRouter = express.Router();

const toIdList = (value) => {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => {
          if (item && typeof item === "object") return String(item._id || "");
          return String(item || "");
        })
        .filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  ];
};

function normalizeCouponBody(body, { partial = false } = {}) {
  const payload = {};
  if (!partial || body.code !== undefined) {
    const code = String(body.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) {
      throw new Error("Code must be 3–20 letters, numbers, _ or -");
    }
    payload.code = code;
  }
  if (!partial || body.description !== undefined) {
    payload.description = String(body.description || "").trim();
  }
  if (!partial || body.discountType !== undefined) {
    if (!["percent", "flat"].includes(body.discountType)) {
      throw new Error("Discount type must be percent or flat");
    }
    payload.discountType = body.discountType;
  }
  if (!partial || body.discountValue !== undefined) {
    const discountValue = Number(body.discountValue);
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      throw new Error("Discount value must be greater than 0");
    }
    if ((payload.discountType || body.discountType) === "percent" && discountValue > 100) {
      throw new Error("Percent discount cannot be more than 100");
    }
    payload.discountValue = discountValue;
  }
  if (!partial || body.maxDiscount !== undefined) {
    payload.maxDiscount = Math.max(0, Number(body.maxDiscount) || 0);
  }
  if (!partial || body.minOrderAmount !== undefined) {
    payload.minOrderAmount = Math.max(0, Number(body.minOrderAmount) || 0);
  }
  if (!partial || body.usageLimit !== undefined) {
    payload.usageLimit = Math.max(0, Math.floor(Number(body.usageLimit) || 0));
  }
  if (!partial || body.perUserLimit !== undefined) {
    payload.perUserLimit = Math.max(1, Math.floor(Number(body.perUserLimit) || 1));
  }
  if (!partial || body.startsAt !== undefined) {
    payload.startsAt = body.startsAt ? new Date(body.startsAt) : null;
    if (payload.startsAt && Number.isNaN(payload.startsAt.getTime())) {
      throw new Error("Start date is invalid");
    }
  }
  if (!partial || body.expiresAt !== undefined) {
    payload.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (payload.expiresAt && Number.isNaN(payload.expiresAt.getTime())) {
      throw new Error("Expiry date is invalid");
    }
  }
  if (!partial || body.isActive !== undefined) {
    payload.isActive = body.isActive !== false;
  }
  if (!partial || body.appliesTo !== undefined) {
    payload.appliesTo = body.appliesTo === "selected" ? "selected" : "all";
  }
  if (!partial || body.categories !== undefined) {
    payload.categories = toIdList(body.categories);
  }
  if (!partial || body.products !== undefined) {
    payload.products = toIdList(body.products);
  }

  const appliesTo = payload.appliesTo || body.appliesTo;
  const categories = payload.categories || body.categories || [];
  const products = payload.products || body.products || [];
  if (appliesTo === "selected" && categories.length === 0 && products.length === 0) {
    throw new Error("Select at least one category or product");
  }
  if (appliesTo === "all") {
    payload.categories = [];
    payload.products = [];
  }
  return payload;
}

publicRouter.post("/preview", require("../middleware/mobileAccess")("coupons"), async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }
    const cart = await Cart.findOne({ user: userId, status: "active" });
    if (!cart || !cart.items.length) {
      return res.status(400).json({ success: false, message: "Cart is empty" });
    }
    const quote = await quoteCoupon({ code, userId, items: cart.items });
    res.json({ success: true, data: quote });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Could not apply coupon",
    });
  }
});

adminRouter.get("/", async (req, res) => {
  try {
    const coupons = await Coupon.find()
      .populate("categories", "name")
      .populate("products", "name")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: coupons });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load coupons" });
  }
});

adminRouter.post("/", async (req, res) => {
  try {
    const payload = normalizeCouponBody(req.body);
    const existing = await Coupon.findOne({ code: payload.code });
    if (existing) {
      return res.status(400).json({ success: false, message: "This coupon code already exists" });
    }
    const coupon = await Coupon.create(payload);
    res.status(201).json({ success: true, data: coupon });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || "Failed to create coupon" });
  }
});

adminRouter.put("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid coupon id" });
    }
    const current = await Coupon.findById(req.params.id);
    if (!current) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }
    const payload = normalizeCouponBody(
      {
        ...current.toObject(),
        ...req.body,
        categories: req.body.categories ?? current.categories,
        products: req.body.products ?? current.products,
      },
      { partial: false },
    );
    if (payload.code !== current.code) {
      const clash = await Coupon.findOne({ code: payload.code, _id: { $ne: current._id } });
      if (clash) {
        return res.status(400).json({ success: false, message: "This coupon code already exists" });
      }
    }
    Object.assign(current, payload);
    await current.save();
    res.json({ success: true, data: current });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || "Failed to update coupon" });
  }
});

adminRouter.delete("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid coupon id" });
    }
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }
    res.json({ success: true, message: "Coupon deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete coupon" });
  }
});

module.exports = publicRouter;
module.exports.admin = adminRouter;
