const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    unit: { type: String, required: true }, // kg / pcs
    category: { type: String, required: true, index: true },
    image: String,

    stock: {
      type: Number,
      required: true, // quantity available
    },

    // New fields for home page sections
    discount: {
      type: Number,
      default: 0,
      min: 0,
      max: 100, // percentage (0-100)
    },

    featured: {
      type: Boolean,
      default: false, // Shows in "Featured Products" section
    },

    trending: {
      type: Boolean,
      default: false, // Shows in "Trending Now" section
    },

    bestDeal: {
      type: Boolean,
      default: false, // Shows in "Best Deals" section
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Index for faster queries on the new fields
ProductSchema.index({ featured: 1, trending: 1, bestDeal: 1 });

module.exports = mongoose.model("Product", ProductSchema);
