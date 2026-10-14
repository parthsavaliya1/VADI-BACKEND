const mongoose = require("mongoose");

const CouponRedemptionSchema = new mongoose.Schema(
  {
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true,
    },
    code: String,
    discountAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  { timestamps: true },
);

CouponRedemptionSchema.index({ coupon: 1, user: 1 });

module.exports = mongoose.model("CouponRedemption", CouponRedemptionSchema);
