const mongoose = require("mongoose");

const DriverSchema = new mongoose.Schema(
  {
    isDemo: { type: Boolean, default: false },
    reviewPasswordHash: { type: String, select: false },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    otp: { type: String, default: null },
    otpSessionId: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },
    otpAttempts: { type: Number, default: 0 },
    lastLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      updatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Driver", DriverSchema);
