const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
    },

    // Pricing
    mrp: {
      type: Number,
      required: true,
    },

    price: {
      type: Number,
      required: true,
    },

    discount: {
      type: Number,
      default: 0, // percentage
      min: 0,
      max: 100,
    },

    unit: {
      type: String,
      required: true, // kg / pcs / litre
    },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
      index: true,
    },

    // Images
    image: String, // main image
    images: [String], // multiple images

    brand: {
      type: String, // optional (farm name / vendor)
    },

    stock: {
      type: Number,
      required: true,
      min: 0,
    },

    // Order quantity control
    minOrderQty: {
      type: Number,
      default: 1,
    },

    maxOrderQty: {
      type: Number,
    },

    // UI helpers
    featured: {
      type: Boolean,
      default: false,
    },

    trending: {
      type: Boolean,
      default: false,
    },

    bestDeal: {
      type: Boolean,
      default: false,
    },

    deliveryTime: {
      type: String, // "10 mins", "1 hour"
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
    },
  },
  { timestamps: true },
);

// Indexes for faster homepage queries
ProductSchema.index({
  featured: 1,
  trending: 1,
  bestDeal: 1,
  category: 1,
});

module.exports = mongoose.model("Product", ProductSchema);
