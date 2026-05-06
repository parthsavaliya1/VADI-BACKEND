const express = require("express");
const router = express.Router();
const User = require("../models/User");
const mongoose = require("mongoose");

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

module.exports = router;
