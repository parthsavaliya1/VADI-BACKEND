const mongoose = require("mongoose");

const SellerLedgerSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    orderNumber: String,
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
      index: true,
    },
    sellerName: String,
    gross: {
      type: Number,
      required: true,
      min: 0,
    },
    commissionPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    sellerAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["credited", "reversed"],
      default: "credited",
      index: true,
    },
    paidAt: Date,
  },
  { timestamps: true },
);

SellerLedgerSchema.index({ order: 1, seller: 1 }, { unique: true });

module.exports = mongoose.model("SellerLedger", SellerLedgerSchema);
