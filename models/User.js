const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    profileImage: {
      type: String,
    },

    // OTP auth fields
    otp: {
      type: String,
    },

    otpExpiresAt: {
      type: Date,
    },

    otpAttempts: {
      type: Number,
      default: 0,
    },

    otpVerifiedAt: {
      type: Date,
    },

    isPhoneVerified: {
      type: Boolean,
      default: false,
    },

    // Optional personal info
    dob: {
      type: String,
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    status: {
      type: String,
      enum: ["active", "blocked"],
      default: "active",
    },

    lastLoginAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

// Indexes
UserSchema.index({ phone: 1 });
UserSchema.index({ role: 1, status: 1 });

module.exports = mongoose.model("User", UserSchema);
