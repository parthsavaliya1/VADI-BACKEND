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

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Product", ProductSchema);
