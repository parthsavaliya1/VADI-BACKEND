const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Address = require("../models/Address");
const Cart = require("../models/Cart");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const Review = require("../models/Review");
const Seller = require("../models/Seller");
const { ensureReferralCode } = require("../utils/referralReward");

const Wishlist = require('../models/Wishlist');
const SupportMessage = require('../models/SupportMessage');
const Notification = require('../models/Notification');
const Product = require('../models/Product');
const { publicUser } = require('../middleware/sessionAuth');
const router = express.Router();

/** Fields the mobile app may PATCH (matches AuthContext). */
const ALLOWED_PATCH_FIELDS = ["name", "dob", "profileImage", "lastLoginAt", "preferredLanguage"];

/**
 * PATCH /api/users/:id
 * Used on app boot (lastLoginAt) and profile screen.
 */
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const updates = {};

    for (const key of ALLOWED_PATCH_FIELDS) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true },
    )
      .select("-otp -otpSessionId")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json(publicUser(user));
  } catch (error) {
    console.error("PATCH /api/users/:id error:", error?.message || error);
    return res.status(500).json({ message: "Failed to update user" });
  }
});

/**
 * POST /api/users/:id/referral
 * Returns the customer's share code, creating one if they signed up before referrals existed.
 */
router.post("/:id/referral", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const referralCode = await ensureReferralCode(user);
    return res.json({ referralCode });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load referral code" });
  }
});

/**
 * DELETE /api/users/:id
 * "Delete account" from the app (Profile → About VADI → Delete account).
 *
 * Removes the user document and all personal data linked to it (addresses,
 * cart, wallet + transactions, reviews, seller profile). Orders and payments
 * are kept for accounting/tax records; they only hold a dangling user id and
 * the delivery snapshot that was already captured at checkout.
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findById(id).select("_id role isDemo").lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.role === "admin") {
      return res
        .status(403)
        .json({ message: "Admin accounts cannot be deleted from the app" });
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Transactions prevent a failed cleanup from leaving a half-deleted account.
        const shop = await Seller.findOne({ user: id }).session(session);
        if (shop) await Product.updateMany({ 'seller.sellerId': shop._id }, { $set: { isActive: false, 'seller.sellerName': 'Deleted seller' }, $unset: { 'seller.contact': '', 'seller.location': '' } }, { session });
        for (const Model of [Address, Cart, WalletTransaction, Wallet, Review, Wishlist, SupportMessage, Notification, Seller]) {
          await Model.deleteMany({ user: id }).session(session);
        }
        if (user.isDemo) await require('../models/ReviewSandbox').deleteOne({ _id: 'play-review-v1' }).session(session);
        await User.findByIdAndDelete(id).session(session);
      });
    } finally { await session.endSession(); }

    return res.json({ success: true, message: "Account deleted" });
  } catch (error) {
    console.error("DELETE /api/users/:id error:", error?.message || error);
    return res.status(500).json({ message: "Failed to delete account" });
  }
});

module.exports = router;
