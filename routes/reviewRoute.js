const express = require("express");
const router = express.Router();
const Review = require("../models/Review"); // Adjust path as needed
const Product = require("../models/Product"); // Adjust path as needed
const Order = require("../models/Orders"); // Adjust path as needed
const mongoose = require("mongoose");

/* ================= HELPER FUNCTIONS ================= */

/**
 * Update product rating and review count
 * @param {string | mongoose.Types.ObjectId} productId - Product ID
 */
const updateProductRating = async (productId) => {
  try {
    const reviews = await Review.find({
      product: productId,
      isActive: true,
    }).lean();

    const totalReviews = reviews.length;
    const averageRating =
      totalReviews > 0
        ? reviews.reduce((sum, review) => sum + review.rating, 0) / totalReviews
        : 0;

    await Product.findByIdAndUpdate(productId, {
      rating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
      reviewsCount: totalReviews,
    });

    return { rating: averageRating, reviewsCount: totalReviews };
  } catch (error) {
    console.error("Update product rating error:", error);
    throw error;
  }
};

/**
 * Check if user has purchased the product
 * @param {string | mongoose.Types.ObjectId} userId - User ID
 * @param {string | mongoose.Types.ObjectId} productId - Product ID
 */
const hasUserPurchasedProduct = async (userId, productId) => {
  const order = await Order.findOne({
    user: userId,
    "items.product": productId,
    status: "delivered",
  });

  return !!order;
};

/* ================= GET ALL REVIEWS ================= */

/**
 * @route   GET /api/reviews
 * @desc    Get all reviews with filtering
 * @access  Public
 */
router.get("/", async (req, res) => {
  try {
    const {
      productId,
      userId,
      rating,
      isVerifiedPurchase,
      isActive = "true",
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build filter with proper typing
    const filter = { isActive: isActive === "true" };
    if (productId) filter.product = productId;
    if (userId) filter.user = userId;
    if (rating) filter.rating = Number(rating);
    if (isVerifiedPurchase !== undefined)
      filter.isVerifiedPurchase = isVerifiedPurchase === "true";

    // Sorting
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);

    const reviews = await Review.find(filter)
      .populate("user", "name email")
      .populate("product", "name image")
      .sort(sort)
      .limit(Number(limit))
      .skip(skip)
      .lean();

    const total = await Review.countDocuments(filter);

    res.json({
      success: true,
      data: reviews,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Get reviews error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch reviews",
      error: error.message,
    });
  }
});

/* ================= GET REVIEWS FOR PRODUCT ================= */

/**
 * @route   GET /api/reviews/product/:productId
 * @desc    Get all reviews for a specific product
 * @access  Public
 */
router.get("/product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const {
      rating,
      isVerifiedPurchase,
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    // Build filter with proper typing
    const filter = {
      product: productId,
      isActive: true,
    };
    if (rating) filter.rating = Number(rating);
    if (isVerifiedPurchase !== undefined)
      filter.isVerifiedPurchase = isVerifiedPurchase === "true";

    // Sorting
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);

    const reviews = await Review.find(filter)
      .populate("user", "name")
      .sort(sort)
      .limit(Number(limit))
      .skip(skip)
      .lean();

    const total = await Review.countDocuments(filter);

    // Get rating distribution
    const ratingDistribution = await Review.aggregate([
      {
        $match: {
          product: new mongoose.Types.ObjectId(productId),
          isActive: true,
        },
      },
      {
        $group: {
          _id: "$rating",
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
    ]);

    // Calculate average rating
    const avgRating = await Review.aggregate([
      {
        $match: {
          product: new mongoose.Types.ObjectId(productId),
          isActive: true,
        },
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
        },
      },
    ]);

    res.json({
      success: true,
      data: reviews,
      summary: {
        averageRating: avgRating[0]?.averageRating
          ? Math.round(avgRating[0].averageRating * 10) / 10
          : 0,
        totalReviews: avgRating[0]?.totalReviews || 0,
        ratingDistribution,
      },
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Get product reviews error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch product reviews",
      error: error.message,
    });
  }
});

/* ================= GET REVIEW BY ID ================= */

/**
 * @route   GET /api/reviews/:id
 * @desc    Get single review by ID
 * @access  Public
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid review ID format",
      });
    }

    const review = await Review.findById(id)
      .populate("user", "name email")
      .populate("product", "name image")
      .lean();

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    res.json({
      success: true,
      data: review,
    });
  } catch (error) {
    console.error("Get review by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch review",
      error: error.message,
    });
  }
});

/* ================= CREATE REVIEW ================= */

/**
 * @route   POST /api/reviews
 * @desc    Create a new review
 * @access  Private
 */
router.post("/", async (req, res) => {
  try {
    const { userId, productId, rating, comment } = req.body;

    // Validation
    if (!userId || !productId || !rating) {
      return res.status(400).json({
        success: false,
        message: "User ID, Product ID, and Rating are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
      });
    }

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Check if user already reviewed this product
    const existingReview = await Review.findOne({
      user: userId,
      product: productId,
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message:
          "You have already reviewed this product. Please update your existing review.",
      });
    }

    // Check if user has purchased the product
    const isPurchased = await hasUserPurchasedProduct(userId, productId);

    // Create review
    const review = new Review({
      user: userId,
      product: productId,
      rating,
      comment,
      isVerifiedPurchase: isPurchased,
    });

    await review.save();

    // Update product rating
    await updateProductRating(productId);

    // Populate user and product details
    await review.populate("user", "name email");
    await review.populate("product", "name image");

    res.status(201).json({
      success: true,
      message: "Review submitted successfully",
      data: review,
    });
  } catch (error) {
    console.error("Create review error:", error);

    // Handle duplicate review error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this product",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to create review",
      error: error.message,
    });
  }
});

/* ================= UPDATE REVIEW ================= */

/**
 * @route   PUT /api/reviews/:id
 * @desc    Update review
 * @access  Private
 */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, rating, comment } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid review ID format",
      });
    }

    const review = await Review.findById(id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    // Verify user owns this review
    if (userId && review.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to update this review",
      });
    }

    // Validate rating if provided
    if (rating && (rating < 1 || rating > 5)) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
      });
    }

    // Update review
    const updateData = {};
    if (rating !== undefined) updateData.rating = rating;
    if (comment !== undefined) updateData.comment = comment;

    const updatedReview = await Review.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("user", "name email")
      .populate("product", "name image");

    // Update product rating if rating changed
    if (rating !== undefined) {
      await updateProductRating(review.product);
    }

    res.json({
      success: true,
      message: "Review updated successfully",
      data: updatedReview,
    });
  } catch (error) {
    console.error("Update review error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update review",
      error: error.message,
    });
  }
});

/* ================= DELETE REVIEW (SOFT DELETE) ================= */

/**
 * @route   DELETE /api/reviews/:id
 * @desc    Soft delete review (set isActive to false)
 * @access  Private
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid review ID format",
      });
    }

    const review = await Review.findById(id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    // Verify user owns this review
    if (userId && review.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to delete this review",
      });
    }

    review.isActive = false;
    await review.save();

    // Update product rating
    await updateProductRating(review.product);

    res.json({
      success: true,
      message: "Review deleted successfully",
      data: review,
    });
  } catch (error) {
    console.error("Delete review error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete review",
      error: error.message,
    });
  }
});

/* ================= HARD DELETE REVIEW ================= */

/**
 * @route   DELETE /api/reviews/:id/permanent
 * @desc    Permanently delete review
 * @access  Private (Admin)
 */
router.delete("/:id/permanent", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid review ID format",
      });
    }

    const review = await Review.findByIdAndDelete(id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    // Update product rating
    await updateProductRating(review.product);

    res.json({
      success: true,
      message: "Review permanently deleted",
      data: review,
    });
  } catch (error) {
    console.error("Permanent delete review error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete review",
      error: error.message,
    });
  }
});

/* ================= CHECK IF USER CAN REVIEW ================= */

/**
 * @route   GET /api/reviews/can-review/:productId
 * @desc    Check if user can review a product
 * @access  Private
 */
router.get("/can-review/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    // Check if user already reviewed
    const existingReview = await Review.findOne({
      user: userId,
      product: productId,
    });

    if (existingReview) {
      return res.json({
        success: true,
        canReview: false,
        reason: "Already reviewed",
        existingReview,
      });
    }

    // Check if user has purchased
    const hasPurchased = await hasUserPurchasedProduct(userId, productId);

    res.json({
      success: true,
      canReview: true,
      hasPurchased,
      message: hasPurchased
        ? "You can submit a verified review"
        : "You can submit a review (not verified)",
    });
  } catch (error) {
    console.error("Check can review error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check review eligibility",
      error: error.message,
    });
  }
});

/* ================= GET USER'S REVIEWS ================= */

/**
 * @route   GET /api/reviews/user/:userId
 * @desc    Get all reviews by a specific user
 * @access  Private
 */
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const filter = { user: userId, isActive: true };
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    const skip = (Number(page) - 1) * Number(limit);

    const reviews = await Review.find(filter)
      .populate("product", "name image")
      .sort(sort)
      .limit(Number(limit))
      .skip(skip)
      .lean();

    const total = await Review.countDocuments(filter);

    res.json({
      success: true,
      data: reviews,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Get user reviews error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user reviews",
      error: error.message,
    });
  }
});

/* ================= TOGGLE REVIEW ACTIVE STATUS ================= */

/**
 * @route   PATCH /api/reviews/:id/toggle-active
 * @desc    Toggle review active status (Admin)
 * @access  Private (Admin)
 */
router.patch("/:id/toggle-active", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid review ID format",
      });
    }

    const review = await Review.findById(id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    review.isActive = !review.isActive;
    await review.save();

    // Update product rating
    await updateProductRating(review.product);

    res.json({
      success: true,
      message: `Review ${review.isActive ? "activated" : "deactivated"}`,
      data: review,
    });
  } catch (error) {
    console.error("Toggle active status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to toggle review status",
      error: error.message,
    });
  }
});

/* ================= GET REVIEW STATISTICS ================= */

/**
 * @route   GET /api/reviews/stats/overall
 * @desc    Get overall review statistics
 * @access  Public
 */
router.get("/stats/overall", async (req, res) => {
  try {
    const { productId } = req.query;

    const matchFilter = { isActive: true };
    if (productId) {
      matchFilter.product = new mongoose.Types.ObjectId(productId);
    }

    const stats = await Review.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          averageRating: { $avg: "$rating" },
          verifiedPurchases: {
            $sum: { $cond: ["$isVerifiedPurchase", 1, 0] },
          },
        },
      },
    ]);

    // Rating distribution
    const ratingDistribution = await Review.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: "$rating",
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
    ]);

    res.json({
      success: true,
      data: {
        totalReviews: stats[0]?.totalReviews || 0,
        averageRating: stats[0]?.averageRating
          ? Math.round(stats[0].averageRating * 10) / 10
          : 0,
        verifiedPurchases: stats[0]?.verifiedPurchases || 0,
        ratingDistribution,
      },
    });
  } catch (error) {
    console.error("Get review stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch review statistics",
      error: error.message,
    });
  }
});

/* ================= BULK OPERATIONS ================= */

/**
 * @route   POST /api/reviews/bulk/activate
 * @desc    Bulk activate reviews
 * @access  Private (Admin)
 */
router.post("/bulk/activate", async (req, res) => {
  try {
    const { reviewIds } = req.body;

    if (!Array.isArray(reviewIds) || reviewIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Review IDs array is required",
      });
    }

    const result = await Review.updateMany(
      { _id: { $in: reviewIds } },
      { isActive: true },
    );

    // Update product ratings for affected products
    const reviews = await Review.find({ _id: { $in: reviewIds } }).distinct(
      "product",
    );

    // Update each product's rating
    for (const productId of reviews) {
      await updateProductRating(productId);
    }

    res.json({
      success: true,
      message: `${result.modifiedCount} reviews activated`,
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    console.error("Bulk activate error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to activate reviews",
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/reviews/bulk/deactivate
 * @desc    Bulk deactivate reviews
 * @access  Private (Admin)
 */
router.post("/bulk/deactivate", async (req, res) => {
  try {
    const { reviewIds } = req.body;

    if (!Array.isArray(reviewIds) || reviewIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Review IDs array is required",
      });
    }

    const result = await Review.updateMany(
      { _id: { $in: reviewIds } },
      { isActive: false },
    );

    // Update product ratings for affected products
    const reviews = await Review.find({ _id: { $in: reviewIds } }).distinct(
      "product",
    );

    // Update each product's rating
    for (const productId of reviews) {
      await updateProductRating(productId);
    }

    res.json({
      success: true,
      message: `${result.modifiedCount} reviews deactivated`,
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    console.error("Bulk deactivate error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to deactivate reviews",
      error: error.message,
    });
  }
});

module.exports = router;
