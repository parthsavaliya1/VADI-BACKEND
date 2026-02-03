const mongoose = require("mongoose");

const AddressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: String, // Home / Office
    addressLine: {
      type: String,
      required: true,
    },
    city: String,
    state: String,
    pincode: String,
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Address", AddressSchema);
