const mongoose = require("mongoose");

const CartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // one active cart per user
      index: true,
    },

    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },

        name: String, // snapshot
        price: {
          type: Number,
          required: true,
        },

        quantity: {
          type: Number,
          required: true,
          min: 1,
        },

        unit: String, // kg / pcs
        image: String, // snapshot
      },
    ],

    totalItems: {
      type: Number,
      default: 0,
    },

    subTotal: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

// Index
CartSchema.index({ user: 1 });

module.exports = mongoose.model("Cart", CartSchema);
