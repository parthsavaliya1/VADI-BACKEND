const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        quantity: Number,
        price: Number,
      },
    ],

    totalAmount: Number,

    address: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Address",
    },

    status: {
      type: String,
      enum: ["pending", "paid", "delivered", "cancelled"],
      default: "pending",
    },

    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Order", OrderSchema);
