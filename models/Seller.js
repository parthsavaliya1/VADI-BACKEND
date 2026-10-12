const mongoose = require("mongoose");

const SellerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      trim: true,
      uppercase: true,
      unique: true,
      sparse: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    location: {
      city: {
        type: String,
        trim: true,
      },
      area: {
        type: String,
        trim: true,
      },
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      sparse: true,
      index: true,
    },
    /** Omitted means the seller uses the admin default commission. */
    commissionPercent: {
      type: Number,
      min: 0,
      max: 100,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    passwordHash: {
      type: String,
      select: false,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Seller", SellerSchema);
