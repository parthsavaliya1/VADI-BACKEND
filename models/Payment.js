const mongoose = require("mongoose");

const PaymentSchema = new mongoose.Schema(
  {
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
      index: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    currency: {
      type: String,
      default: "INR",
    },

    paymentType: {
      type: String,
      enum: ["online", "cod"],
      required: true,
    },

    method: {
      type: String,
      enum: ["upi", "card", "netbanking", "cod"],
      required: true,
    },

    gateway: {
      type: String,
      enum: ["razorpay", "stripe", "cash"],
    },

    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },

    transactionId: String,
    gatewayOrderId: String,

    failureReason: String,

    paidAt: Date,

    refund: {
      status: {
        type: String,
        enum: ["none", "initiated", "processed"],
        default: "none",
      },
      amount: Number,
      refundedAt: Date,
    },
  },
  { timestamps: true },
);

// Indexes
PaymentSchema.index({ order: 1, status: 1 });
PaymentSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Payment", PaymentSchema);
