const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    /* ================= BASIC INFO ================= */

    name: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    description: {
      type: String,
      trim: true,
    },

    brand: {
      type: String,
    },

    baseProductId: {
      type: String,
      index: true,
    },

    /* ================= CATEGORY ================= */

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
      index: true,
    },

    /* ================= UNIT ================= */

    unit: {
      type: String,
      required: true, // kg / pcs / litre
    },

    /* ================= SELLER INFO (PRODUCT LEVEL) ================= */

    seller: {
      sellerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Seller",
        required: true,
      },

      sellerName: String,

      contact: {
        phone: String,
        email: String,
      },

      location: {
        city: String,
        area: String,
      },
    },

    /* ================= SHELF LIFE ================= */

    shelfLife: {
      value: Number,
      unit: {
        type: String,
        enum: ["days", "months"],
      },
    },

    expiryRequired: {
      type: Boolean,
      default: true,
    },

    storageInstructions: String,

    /* ================= PRICING HELPERS ================= */

    discount: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    tax: {
      gstPercent: {
        type: Number,
        default: 0,
      },
      inclusive: {
        type: Boolean,
        default: true,
      },
    },

    /* ================= SEARCH ================= */

    tags: [String],
    searchKeywords: [String],

    /* ================= VARIANTS ================= */

    variants: [
      {
        packSize: {
          type: Number,
          required: true,
        },

        packUnit: {
          type: String,
          enum: ["kg", "g", "litre", "ml", "pcs"],
          required: true,
        },

        mrp: {
          type: Number,
          required: true,
        },

        price: {
          type: Number,
          required: true,
        },

        stock: {
          type: Number,
          required: true,
          min: 0,
        },

        lowStockThreshold: {
          type: Number,
          default: 5,
        },

        sku: String,

        isDefault: {
          type: Boolean,
          default: false,
        },

        isActive: {
          type: Boolean,
          default: true,
        },
      },
    ],

    /* ================= IMAGES ================= */

    image: String,
    images: [String],

    /* ================= UI FLAGS ================= */

    featured: {
      type: Boolean,
      default: false,
      index: true,
    },

    trending: {
      type: Boolean,
      default: false,
      index: true,
    },

    bestDeal: {
      type: Boolean,
      default: false,
      index: true,
    },

    rating: {
      type: Number,
      default: 0,
    },

    reviewsCount: {
      type: Number,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

/* ================= INDEXES ================= */

ProductSchema.index({
  category: 1,
  featured: 1,
  trending: 1,
  bestDeal: 1,
  isActive: 1,
});

module.exports = mongoose.model("Product", ProductSchema);
