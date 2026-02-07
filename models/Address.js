const mongoose = require("mongoose");

const AddressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["home", "work", "other"],
      default: "home",
    },

    name: String, // display name

    phone: {
      type: String,
      required: true,
    },

    addressLine1: {
      type: String,
      required: true,
    },

    addressLine2: String,

    landmark: String,

    city: {
      type: String,
      required: true,
    },

    state: {
      type: String,
      required: true,
    },

    pincode: {
      type: String,
      required: true,
    },

    location: {
      type: {
        type: String,
        enum: ["Point"],
      },
      coordinates: {
        type: [Number],
        validate: {
          validator: (v) => !v || v.length === 2,
          message: "Coordinates must be [lng, lat]",
        },
      },
    },

    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// Indexes
AddressSchema.index({ user: 1 });

// CRITICAL FIX: Use sparse index for location
// This allows documents without location field to exist
// Only documents WITH location will be indexed for geo queries
AddressSchema.index({ location: "2dsphere" }, { sparse: true });

module.exports = mongoose.model("Address", AddressSchema);
