const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema(
  {
    // Who placed the order
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Ordered items
    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        name: String, // snapshot (product name at time of order)
        price: {
          type: Number,
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
        },
        unit: String, // kg / pcs (snapshot)
        image: String, // snapshot
      },
    ],

    // Pricing summary
    totalItems: {
      type: Number,
      required: true,
    },

    subTotal: {
      type: Number,
      required: true,
    },

    deliveryFee: {
      type: Number,
      default: 0,
    },

    discountAmount: {
      type: Number,
      default: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
    },

    // Address
    address: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Address",
      required: true,
    },

    // Payment info
    paymentMethod: {
      type: String,
      enum: ["cod", "upi", "card"],
      required: true,
    },

    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },

    // Order lifecycle
    orderStatus: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "packed",
        "out_for_delivery",
        "delivered",
        "cancelled",
      ],
      default: "pending",
    },

    // Delivery
    deliveryTime: {
      type: String, // "10 mins", "1 hour"
    },

    deliveredAt: Date,

    cancelledReason: String,
  },
  { timestamps: true },
);

// Indexes for fast queries
OrderSchema.index({ user: 1, createdAt: -1 });
OrderSchema.index({ orderStatus: 1, paymentStatus: 1 });

module.exports = mongoose.model("Order", OrderSchema);
