const express = require("express");
const router = express.Router();
const Category = require("../models/Category"); // Adjust path as needed
const Product = require("../models/Product"); // Adjust path as needed
const mongoose = require("mongoose");

/* ================= HELPER FUNCTIONS ================= */

/**
 * Generate unique slug from name
 */
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

/* ================= GET ALL CATEGORIES ================= */

/**
 * @route   GET /api/categories
 * @desc    Get all categories with filtering and sorting
 * @access  Public
 */
router.get("/", async (req, res) => {
  try {
    const {
      isActive,
      showOnHome,
      page,
      limit,
      sortBy = "sortOrder",
      sortOrder = "asc",
    } = req.query;

    // Build filter
    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (showOnHome !== undefined) filter.showOnHome = showOnHome === "true";

    // Sorting
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    let query = Category.find(filter).sort(sort);

    // Pagination (optional)
    if (page && limit) {
      const skip = (Number(page) - 1) * Number(limit);
      query = query.limit(Number(limit)).skip(skip);
    }

    const categories = await query.lean();

    // Get total count for pagination
    let pagination = null;
    if (page && limit) {
      const total = await Category.countDocuments(filter);
      pagination = {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      };
    }

    res.json({
      success: true,
      data: categories,
      ...(pagination && { pagination }),
    });
  } catch (error) {
    console.error("Get categories error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      error: error.message,
    });
  }
});

/* ================= GET CATEGORY BY ID ================= */

/**
 * @route   GET /api/categories/:id
 * @desc    Get single category by ID
 * @access  Public
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID format",
      });
    }

    const category = await Category.findById(id).lean();

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Get product count in this category
    const productCount = await Product.countDocuments({
      category: id,
      isActive: true,
    });

    res.json({
      success: true,
      data: {
        ...category,
        productCount,
      },
    });
  } catch (error) {
    console.error("Get category by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch category",
      error: error.message,
    });
  }
});

/* ================= GET CATEGORY BY SLUG ================= */

/**
 * @route   GET /api/categories/slug/:slug
 * @desc    Get category by slug
 * @access  Public
 */
router.get("/slug/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const category = await Category.findOne({ slug }).lean();

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Get product count
    const productCount = await Product.countDocuments({
      category: category._id,
      isActive: true,
    });

    res.json({
      success: true,
      data: {
        ...category,
        productCount,
      },
    });
  } catch (error) {
    console.error("Get category by slug error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch category",
      error: error.message,
    });
  }
});

/* ================= CREATE CATEGORY ================= */

/**
 * @route   POST /api/categories
 * @desc    Create new category
 * @access  Private (Admin)
 */
router.post("/", async (req, res) => {
  try {
    const { name, image, sortOrder, showOnHome, isActive } = req.body;

    // Validation
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    // Generate slug
    let slug = generateSlug(name);

    // Check if slug already exists
    const existingCategory = await Category.findOne({ slug });
    if (existingCategory) {
      // Add timestamp to make unique
      slug = `${slug}-${Date.now()}`;
    }

    // Create category
    const category = new Category({
      name,
      slug,
      image,
      sortOrder,
      showOnHome,
      isActive,
    });

    await category.save();

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: category,
    });
  } catch (error) {
    console.error("Create category error:", error);

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Category with this name or slug already exists",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to create category",
      error: error.message,
    });
  }
});

/* ================= UPDATE CATEGORY ================= */

/**
 * @route   PUT /api/categories/:id
 * @desc    Update category by ID
 * @access  Private (Admin)
 */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID format",
      });
    }

    // Check if category exists
    const existingCategory = await Category.findById(id);
    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const updateData = { ...req.body };

    // If name is being updated, regenerate slug
    if (updateData.name && updateData.name !== existingCategory.name) {
      let newSlug = generateSlug(updateData.name);

      // Check if new slug conflicts with another category
      const slugConflict = await Category.findOne({
        slug: newSlug,
        _id: { $ne: id },
      });

      if (slugConflict) {
        newSlug = `${newSlug}-${Date.now()}`;
      }

      updateData.slug = newSlug;
    }

    // Update category
    const updatedCategory = await Category.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Category updated successfully",
      data: updatedCategory,
    });
  } catch (error) {
    console.error("Update category error:", error);

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Category with this name or slug already exists",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update category",
      error: error.message,
    });
  }
});

/* ================= DELETE CATEGORY (SOFT DELETE) ================= */

/**
 * @route   DELETE /api/categories/:id
 * @desc    Soft delete category (set isActive to false)
 * @access  Private (Admin)
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID format",
      });
    }

    // Check if category has products
    const productCount = await Product.countDocuments({
      category: id,
      isActive: true,
    });

    if (productCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category with ${productCount} active products. Please move or delete products first.`,
        productCount,
      });
    }

    const category = await Category.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.json({
      success: true,
      message: "Category deactivated successfully",
      data: category,
    });
  } catch (error) {
    console.error("Delete category error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete category",
      error: error.message,
    });
  }
});

/* ================= HARD DELETE CATEGORY ================= */

/**
 * @route   DELETE /api/categories/:id/permanent
 * @desc    Permanently delete category
 * @access  Private (Admin)
 */
router.delete("/:id/permanent", async (req, res) => {
  try {
    const { id } = req.params;
    const { force } = req.query; // force=true to delete even with products

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID format",
      });
    }

    // Check if category has products
    const productCount = await Product.countDocuments({ category: id });

    if (productCount > 0 && force !== "true") {
      return res.status(400).json({
        success: false,
        message: `Category has ${productCount} products. Use force=true to delete anyway.`,
        productCount,
      });
    }

    const category = await Category.findByIdAndDelete(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.json({
      success: true,
      message: "Category permanently deleted",
      data: category,
    });
  } catch (error) {
    console.error("Permanent delete category error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete category",
      error: error.message,
    });
  }
});

/* ================= REORDER CATEGORIES ================= */

/**
 * @route   PUT /api/categories/reorder
 * @desc    Update sort order for multiple categories
 * @access  Private (Admin)
 */
router.put("/reorder", async (req, res) => {
  try {
    const { categories } = req.body;

    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Categories array is required",
      });
    }

    // Validate format: [{ id, sortOrder }, ...]
    for (const cat of categories) {
      if (!cat.id || cat.sortOrder === undefined) {
        return res.status(400).json({
          success: false,
          message: "Each category must have id and sortOrder",
        });
      }
    }

    // Update each category
    const updatePromises = categories.map((cat) =>
      Category.findByIdAndUpdate(
        cat.id,
        { sortOrder: cat.sortOrder },
        { new: true },
      ),
    );

    const updatedCategories = await Promise.all(updatePromises);

    res.json({
      success: true,
      message: "Categories reordered successfully",
      data: updatedCategories,
    });
  } catch (error) {
    console.error("Reorder categories error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reorder categories",
      error: error.message,
    });
  }
});

/* ================= TOGGLE CATEGORY VISIBILITY ================= */

/**
 * @route   PATCH /api/categories/:id/toggle-home
 * @desc    Toggle showOnHome status
 * @access  Private (Admin)
 */
router.patch("/:id/toggle-home", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID format",
      });
    }

    const category = await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    category.showOnHome = !category.showOnHome;
    await category.save();

    res.json({
      success: true,
      message: `Category ${category.showOnHome ? "shown on" : "hidden from"} home`,
      data: category,
    });
  } catch (error) {
    console.error("Toggle home visibility error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to toggle visibility",
      error: error.message,
    });
  }
});

/* ================= TOGGLE CATEGORY ACTIVE STATUS ================= */

/**
 * @route   PATCH /api/categories/:id/toggle-active
 * @desc    Toggle isActive status
 * @access  Private (Admin)
 */
router.patch("/:id/toggle-active", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID format",
      });
    }

    const category = await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    category.isActive = !category.isActive;
    await category.save();

    res.json({
      success: true,
      message: `Category ${category.isActive ? "activated" : "deactivated"}`,
      data: category,
    });
  } catch (error) {
    console.error("Toggle active status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to toggle active status",
      error: error.message,
    });
  }
});

/* ================= GET HOME CATEGORIES ================= */

/**
 * @route   GET /api/categories/home/featured
 * @desc    Get categories to show on home page
 * @access  Public
 */
router.get("/home/featured", async (req, res) => {
  try {
    const categories = await Category.find({
      isActive: true,
      showOnHome: true,
    })
      .sort({ sortOrder: 1 })
      .lean();

    // Get product count for each category
    const categoriesWithCount = await Promise.all(
      categories.map(async (category) => {
        const productCount = await Product.countDocuments({
          category: category._id,
          isActive: true,
        });
        return {
          ...category,
          productCount,
        };
      }),
    );

    res.json({
      success: true,
      data: categoriesWithCount,
    });
  } catch (error) {
    console.error("Get home categories error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch home categories",
      error: error.message,
    });
  }
});

/* ================= GET CATEGORY STATISTICS ================= */

/**
 * @route   GET /api/categories/:id/stats
 * @desc    Get statistics for a category
 * @access  Public
 */
router.get("/:id/stats", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID format",
      });
    }

    const category = await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Get product statistics
    const totalProducts = await Product.countDocuments({ category: id });
    const activeProducts = await Product.countDocuments({
      category: id,
      isActive: true,
    });
    const inactiveProducts = totalProducts - activeProducts;

    // Get featured products count
    const featuredProducts = await Product.countDocuments({
      category: id,
      featured: true,
      isActive: true,
    });

    // Get products with low stock
    const lowStockProducts = await Product.countDocuments({
      category: id,
      isActive: true,
      "variants.stock": { $lt: 5 },
    });

    res.json({
      success: true,
      data: {
        category,
        statistics: {
          totalProducts,
          activeProducts,
          inactiveProducts,
          featuredProducts,
          lowStockProducts,
        },
      },
    });
  } catch (error) {
    console.error("Get category stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch category statistics",
      error: error.message,
    });
  }
});

/* ================= BULK OPERATIONS ================= */

/**
 * @route   POST /api/categories/bulk/activate
 * @desc    Bulk activate categories
 * @access  Private (Admin)
 */
router.post("/bulk/activate", async (req, res) => {
  try {
    const { categoryIds } = req.body;

    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Category IDs array is required",
      });
    }

    const result = await Category.updateMany(
      { _id: { $in: categoryIds } },
      { isActive: true },
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} categories activated`,
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    console.error("Bulk activate error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to activate categories",
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/categories/bulk/deactivate
 * @desc    Bulk deactivate categories
 * @access  Private (Admin)
 */
router.post("/bulk/deactivate", async (req, res) => {
  try {
    const { categoryIds } = req.body;

    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Category IDs array is required",
      });
    }

    const result = await Category.updateMany(
      { _id: { $in: categoryIds } },
      { isActive: false },
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} categories deactivated`,
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    console.error("Bulk deactivate error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to deactivate categories",
      error: error.message,
    });
  }
});

module.exports = router;
