const mongoose = require("mongoose");

const PaymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
    amount: Number,

    method: {
      type: String,
      enum: ["cod", "upi", "card"],
    },

    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },

    transactionId: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model("Payment", PaymentSchema);
