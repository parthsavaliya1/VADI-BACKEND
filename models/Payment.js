const mongoose = require("mongoose");

const PaymentSchema = new mongoose.Schema(
  {
    /* ================= REFERENCES ================= */

    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* ================= AMOUNT ================= */

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "INR",
    },

    /* ================= METHOD ================= */

    method: {
      type: String,
      enum: ["cod", "upi", "card", "wallet"],
      required: true,
      index: true,
    },

    /* ================= STATUS ================= */

    status: {
      type: String,
      enum: [
        "initiated", // created but not attempted
        "pending", // waiting for confirmation / COD
        "success", // money received
        "failed", // payment failed
        "cancelled", // cancelled before attempt
        "refunded", // fully refunded
        "partial_refund",
      ],
      default: "initiated",
      index: true,
    },

    /* ================= COD ================= */

    isCod: {
      type: Boolean,
      default: false,
    },

    codCollected: {
      type: Boolean,
      default: false,
    },

    collectedAt: Date,

    /* ================= GATEWAY DATA ================= */

    gateway: {
      name: String, // razorpay / stripe / paytm
      paymentId: String,
      orderId: String,
      signature: String,
      response: Object, // raw gateway response (JSON)
    },

    /* ================= FAILURE / REFUND ================= */

    failureReason: String,

    refund: {
      amount: Number,
      reason: String,
      refundedAt: Date,
      gatewayRefundId: String,
    },

    /* ================= META ================= */

    attempt: {
      type: Number,
      default: 1,
    },

    notes: String,
  },
  { timestamps: true },
);

/* ================= INDEXES ================= */

PaymentSchema.index({ order: 1, attempt: 1 });
PaymentSchema.index({ status: 1, method: 1 });

/* ================= COD AUTO HANDLING ================= */

/* ================= COD AUTO HANDLING ================= */

PaymentSchema.pre("save", function () {
  if (this.method === "cod") {
    this.isCod = true;
    this.status = "pending";
  }
});
module.exports = mongoose.model("Payment", PaymentSchema);
