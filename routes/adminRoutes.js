const express = require("express");
const router = express.Router();
const User = require("../models/User");
const mongoose = require("mongoose");
const adminAuth = require("../middleware/adminMiddleware");
const { getFirebaseMessaging } = require("../config/firebaseAdmin");

/* ================= GET ALL USERS (ADMIN ONLY) ================= */

/**
 * @route   GET /api/admin/users
 * @desc    Get all users (admin only)
 * @access  Admin
 */
router.get("/users", async (req, res) => {
  try {
    const {
      search = "",
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build search filter
    const searchFilter = {};
    if (search) {
      searchFilter.$or = [
        { name: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    // Sorting
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);

    const users = await User.find(searchFilter)
      .select("-otp -otpExpiresAt") // Exclude sensitive data
      .sort(sort)
      .limit(Number(limit))
      .skip(skip)
      .lean();

    const total = await User.countDocuments(searchFilter);

    res.json({
      success: true,
      data: users,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: error.message,
    });
  }
});

/* ================= GET USER BY ID ================= */

/**
 * @route   GET /api/admin/users/:id
 * @desc    Get user details by ID (admin only)
 * @access  Admin
 */
router.get("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const user = await User.findById(id).select("-otp -otpExpiresAt").lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user",
      error: error.message,
    });
  }
});

/* ================= GET DASHBOARD STATS ================= */

/**
 * @route   GET /api/admin/stats
 * @desc    Get dashboard statistics (admin only)
 * @access  Admin
 */
router.get("/stats", async (req, res) => {
  try {
    const Order = require("../models/Orders");
    const Product = require("../models/Product");
    const Payment = require("../models/Payment");
    const Category = require("../models/Category");

    // Get total orders
    const totalOrders = await Order.countDocuments();

    // Get total revenue (successful payments)
    const revenueData = await Payment.aggregate([
      { $match: { status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalRevenue = revenueData[0]?.total || 0;

    // Get total products
    const totalProducts = await Product.countDocuments({ isActive: true });

    // Get total users
    const totalUsers = await User.countDocuments();

    // Get total categories
    const totalCategories = await Category.countDocuments({ isActive: true });

    // Get today's orders
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOrders = await Order.countDocuments({
      createdAt: { $gte: today },
    });

    // Get pending orders
    const pendingOrders = await Order.countDocuments({
      status: { $in: ["pending", "confirmed", "processing"] },
    });

    // Get pending payments
    const pendingPayments = await Payment.countDocuments({
      status: { $in: ["initiated", "pending"] },
    });

    // Get this month's revenue
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthlyRevenueData = await Payment.aggregate([
      {
        $match: {
          status: "success",
          createdAt: { $gte: startOfMonth },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const monthlyRevenue = monthlyRevenueData[0]?.total || 0;

    res.json({
      success: true,
      data: {
        totalOrders,
        totalRevenue,
        totalProducts,
        totalUsers,
        totalCategories,
        todayOrders,
        pendingOrders,
        pendingPayments,
        monthlyRevenue,
      },
    });
  } catch (error) {
    console.error("Get stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch statistics",
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/admin/notifications/broadcast
 * @desc    Send push notification to all users with push tokens
 * @access  Admin
 */
router.post("/notifications/broadcast", adminAuth, async (req, res) => {
  try {
    const { title, body, imageUrl } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: "title and body are required",
      });
    }

    const users = await User.find({
      pushToken: { $exists: true, $ne: null, $ne: "" },
    }).select("pushToken");

    const tokens = [...new Set(users.map((user) => user.pushToken).filter(Boolean))];

    if (!tokens.length) {
      return res.json({
        success: true,
        message: "No user push tokens found",
        stats: { totalTokens: 0, successCount: 0, failureCount: 0 },
      });
    }

    const validFcmTokens = [];
    const invalidTokens = new Set();
    const failureReasons = {};

    tokens.forEach((token) => {
      if (typeof token === "string" && !token.startsWith("ExponentPushToken[")) {
        validFcmTokens.push(token);
      } else {
        invalidTokens.add(token);
        failureReasons["invalid-fcm-token"] =
          (failureReasons["invalid-fcm-token"] || 0) + 1;
      }
    });

    if (!validFcmTokens.length) {
      if (invalidTokens.size > 0) {
        await User.updateMany(
          { pushToken: { $in: Array.from(invalidTokens) } },
          {
            $set: {
              pushToken: null,
              pushTokenUpdatedAt: new Date(),
            },
          },
        );
      }
      return res.json({
        success: true,
        message: "No valid Firebase push tokens found",
        stats: {
          totalTokens: tokens.length,
          successCount: 0,
          failureCount: tokens.length,
          invalidTokensRemoved: invalidTokens.size,
          failureReasons,
        },
      });
    }

    const messaging = getFirebaseMessaging();
    const chunkSize = 500;
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < validFcmTokens.length; i += chunkSize) {
      const tokenChunk = validFcmTokens.slice(i, i + chunkSize);
      const response = await messaging.sendEachForMulticast({
        tokens: tokenChunk,
        notification: {
          title: String(title),
          body: String(body),
          ...(imageUrl ? { imageUrl: String(imageUrl) } : {}),
        },
        data: {
          clickAction: "open_notifications",
          ...(imageUrl ? { imageUrl: String(imageUrl) } : {}),
        },
      });

      successCount += response.successCount;
      failureCount += response.failureCount;

      response.responses.forEach((item, idx) => {
        if (item.success) return;
        const code = item.error?.code || "unknown-error";
        failureReasons[code] = (failureReasons[code] || 0) + 1;
        if (
          code.includes("registration-token-not-registered") ||
          code.includes("invalid-registration-token")
        ) {
          invalidTokens.add(tokenChunk[idx]);
        }
      });
    }

    if (invalidTokens.size > 0) {
      await User.updateMany(
        { pushToken: { $in: Array.from(invalidTokens) } },
        {
          $set: {
            pushToken: null,
            pushTokenUpdatedAt: new Date(),
          },
        },
      );
    }

    return res.json({
      success: true,
      message: "Notification broadcast completed",
      stats: {
        totalTokens: tokens.length,
        successCount,
        failureCount: failureCount + (tokens.length - validFcmTokens.length),
        invalidTokensRemoved: invalidTokens.size,
        failureReasons,
      },
    });
  } catch (error) {
    console.error("Broadcast notification error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send notifications",
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/admin/notifications/tokens
 * @desc    Debug token health for notification delivery
 * @access  Admin
 */
router.get("/notifications/tokens", adminAuth, async (req, res) => {
  try {
    const users = await User.find(
      {},
      { name: 1, phone: 1, pushToken: 1, pushPlatform: 1, pushTokenUpdatedAt: 1 },
    )
      .sort({ updatedAt: -1 })
      .lean();

    const maskToken = (token) => {
      if (!token) return null;
      if (token.length <= 20) return token;
      return `${token.slice(0, 12)}...${token.slice(-6)}`;
    };

    const tokenRows = users.map((user) => {
      const token = user.pushToken || null;
      const isFcmToken =
        Boolean(token) && typeof token === "string" && !token.startsWith("ExponentPushToken[");
      return {
        userId: user._id,
        name: user.name || null,
        phone: user.phone || null,
        pushPlatform: user.pushPlatform || "unknown",
        pushTokenUpdatedAt: user.pushTokenUpdatedAt || null,
        hasToken: Boolean(token),
        isValidFcmToken: isFcmToken,
        tokenPreview: maskToken(token),
      };
    });

    const stats = {
      totalUsers: tokenRows.length,
      withToken: tokenRows.filter((row) => row.hasToken).length,
      validFcmTokens: tokenRows.filter((row) => row.isValidFcmToken).length,
      invalidTokens: tokenRows.filter((row) => row.hasToken && !row.isValidFcmToken)
        .length,
      withoutToken: tokenRows.filter((row) => !row.hasToken).length,
    };

    return res.json({
      success: true,
      stats,
      data: tokenRows,
    });
  } catch (error) {
    console.error("Notification token debug error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notification token diagnostics",
      error: error.message,
    });
  }
});

module.exports = router;
