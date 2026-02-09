const mongoose = require("mongoose");

const CartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product is required"],
    },

    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Variant is required"],
    },

    /* ===== SNAPSHOT ===== */

    productName: {
      type: String,
      required: true,
      trim: true,
    },

    image: {
      type: String,
    },

    packSize: {
      type: Number,
      required: true,
      min: [0.1, "Pack size must be greater than 0"],
    },

    packUnit: {
      type: String,
      required: true,
      enum: ["kg", "g", "litre", "ml", "pcs"],
    },

    unitPrice: {
      type: Number,
      required: true,
      min: [0, "Price cannot be negative"],
    },

    mrp: {
      type: Number,
      min: [0, "MRP cannot be negative"],
    },

    discount: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    tax: {
      gstPercent: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
      },
      inclusive: {
        type: Boolean,
        default: true,
      },
    },

    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
    },

    subtotal: {
      type: Number,
      required: true,
      min: [0, "Subtotal cannot be negative"],
    },

    /* ===== SELLER SNAPSHOT ===== */

    seller: {
      sellerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Seller",
        required: true,
      },
      sellerName: {
        type: String,
        required: true,
      },
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false },
);

const CartSchema = new mongoose.Schema(
  {
    /* ================= USER ================= */

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* ================= ITEMS ================= */

    items: {
      type: [CartItemSchema],
      validate: {
        validator: function (v) {
          return v.length > 0;
        },
        message: "Cart must contain at least one item",
      },
    },

    /* ================= TOTALS ================= */

    totalItems: {
      type: Number,
      min: 0,
      default: 0,
    },

    totalQuantity: {
      type: Number,
      min: 0,
      default: 0,
    },

    subtotal: {
      type: Number,
      min: 0,
      default: 0,
    },

    totalDiscount: {
      type: Number,
      min: 0,
      default: 0,
    },

    taxAmount: {
      type: Number,
      min: 0,
      default: 0,
    },

    grandTotal: {
      type: Number,
      min: 0,
      default: 0,
    },

    /* ================= STATUS ================= */

    status: {
      type: String,
      enum: ["active", "converted", "abandoned"],
      default: "active",
      index: true,
    },

    expiresAt: {
      type: Date,
    },

    lastValidatedAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Cart", CartSchema);
