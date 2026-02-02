const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
    },
    unit: {
      type: String,
      required: true, // kg / pcs
    },
    category: {
      type: String,
      required: true, // vegetables, fruits
      index: true,
    },
    image: {
      type: String, // image URL
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Product", ProductSchema);
