const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    isDemo: { type: Boolean, default: false },
    reviewPasswordHash: { type: String, select: false },
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

    /** 2factor.in session id when OTP is AUTOGEN (verify via VERIFY API instead of comparing otp) */
    otpSessionId: {
      type: String,
      default: null,
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
      enum: ["user", "seller", "admin"],
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

    pushToken: {
      type: String,
      default: null,
    },

    pushPlatform: {
      type: String,
      enum: ["ios", "android", "web", "unknown"],
      default: "unknown",
    },

    pushTokenUpdatedAt: {
      type: Date,
    },

    /** Broadcast notification docs (admin) this user has marked as read in the app */
    readBroadcastNotificationIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Notification" }],
      default: [],
    },

    deletedNotificationIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Notification" }],
      default: [],
    },
    privacyPolicyAccepted: {
      type: Boolean,
      default: false,
    },

    privacyPolicyAcceptedAt: {
      type: Date,
      default: null,
    },

    preferredLanguage: {
      type: String,
      enum: ["en", "hi", "gu"],
      default: "en",
    },

    referralCode: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      unique: true,
    },

    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    referralRewardPaid: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// Indexes
UserSchema.index({ role: 1, status: 1 });

module.exports = mongoose.model("User", UserSchema);
