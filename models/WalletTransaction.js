const mongoose = require("mongoose");

const WalletTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    direction: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    reason: {
      type: String,
      enum: ["topup", "order", "refund"],
      required: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
    razorpayOrderId: String,
    razorpayPaymentId: {
      type: String,
      unique: true,
      sparse: true,
    },
    balanceAfter: Number,
    status: {
      type: String,
      enum: ["pending", "paid"],
      default: "paid",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("WalletTransaction", WalletTransactionSchema);
