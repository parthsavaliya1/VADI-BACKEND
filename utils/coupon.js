const mongoose = require("mongoose");
const Coupon = require("../models/Coupon");
const CouponRedemption = require("../models/CouponRedemption");
const Product = require("../models/Product");

const roundMoney = (value) => Math.round(Number(value) * 100) / 100;

function fail(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function itemMatchesCoupon(coupon, product) {
  if (!coupon || coupon.appliesTo !== "selected") return true;
  const categoryIds = (coupon.categories || []).map((id) => String(id));
  const productIds = (coupon.products || []).map((id) => String(id));
  const categoryId = product?.category?._id
    ? String(product.category._id)
    : String(product?.category || "");
  const productId = String(product?._id || "");
  return categoryIds.includes(categoryId) || productIds.includes(productId);
}

async function quoteCoupon({ code, userId, items, session, redeem, orderId }) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;

  const coupon = await Coupon.findOne({ code: normalized }).session(session || null);
  if (!coupon || !coupon.isActive) throw fail("Coupon code is not valid");

  const now = new Date();
  if (coupon.startsAt && now < coupon.startsAt) throw fail("This coupon is not active yet");
  if (coupon.expiresAt && now > coupon.expiresAt) throw fail("This coupon has expired");
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    throw fail("This coupon has reached its usage limit");
  }

  if (coupon.appliesTo === "selected") {
    const hasTargets =
      (coupon.categories || []).length > 0 || (coupon.products || []).length > 0;
    if (!hasTargets) throw fail("This coupon is not configured for any products");
  }

  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    const usedByUser = await CouponRedemption.countDocuments({
      coupon: coupon._id,
      user: userId,
    }).session(session || null);
    if (usedByUser >= coupon.perUserLimit) {
      throw fail("You have already used this coupon");
    }
  }

  const productIds = [
    ...new Set(
      (items || [])
        .map((item) => String(item.product?._id || item.product || ""))
        .filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  ];
  const products = await Product.find({ _id: { $in: productIds } })
    .select("category")
    .session(session || null)
    .lean();
  const productMap = new Map(products.map((product) => [String(product._id), product]));

  let merchandise = 0;
  let eligibleSubtotal = 0;
  for (const item of items || []) {
    const line = Number(item.subtotal || 0);
    merchandise += line;
    const productId = String(item.product?._id || item.product || "");
    const product = productMap.get(productId);
    if (itemMatchesCoupon(coupon, product)) eligibleSubtotal += line;
  }
  merchandise = roundMoney(merchandise);
  eligibleSubtotal = roundMoney(eligibleSubtotal);

  if (merchandise < Number(coupon.minOrderAmount || 0)) {
    throw fail(
      `Add ₹${roundMoney(coupon.minOrderAmount - merchandise)} more to use this coupon`,
    );
  }
  if (eligibleSubtotal <= 0) {
    throw fail("This coupon does not apply to the products in your cart");
  }

  let discountAmount = 0;
  if (coupon.discountType === "percent") {
    discountAmount = (eligibleSubtotal * Number(coupon.discountValue)) / 100;
    if (coupon.maxDiscount > 0) {
      discountAmount = Math.min(discountAmount, coupon.maxDiscount);
    }
  } else {
    discountAmount = Number(coupon.discountValue);
  }
  discountAmount = roundMoney(Math.min(discountAmount, eligibleSubtotal));
  if (discountAmount <= 0) throw fail("This coupon does not reduce the order total");

  if (redeem) {
    const usageFilter = { _id: coupon._id, isActive: true };
    if (coupon.usageLimit > 0) {
      usageFilter.usedCount = { $lt: coupon.usageLimit };
    }
    const updated = await Coupon.updateOne(
      usageFilter,
      { $inc: { usedCount: 1 } },
      { session },
    );
    if (!updated.modifiedCount) throw fail("This coupon has reached its usage limit");
    await CouponRedemption.create(
      [
        {
          coupon: coupon._id,
          user: userId,
          order: orderId,
          code: coupon.code,
          discountAmount,
        },
      ],
      { session },
    );
  }

  return {
    couponId: coupon._id,
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    appliesTo: coupon.appliesTo,
    discountAmount,
    eligibleSubtotal,
  };
}

module.exports = { quoteCoupon };
