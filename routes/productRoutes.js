const express = require("express");
const router = express.Router();
const Product = require("../models/Product"); // Adjust path as needed
const mongoose = require("mongoose");

/* ================= HELPER FUNCTIONS ================= */

// Generate unique slug from name
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

// Validate variant data
const validateVariants = (variants) => {
  if (!variants || variants.length === 0) {
    throw new Error("At least one variant is required");
  }

  const defaultVariants = variants.filter((v) => v.isDefault);
  if (defaultVariants.length > 1) {
    throw new Error("Only one variant can be set as default");
  }

  // Set first variant as default if none specified
  if (defaultVariants.length === 0) {
    variants[0].isDefault = true;
  }

  return variants;
};

/* ================= GET ALL PRODUCTS ================= */

/**
 * @route   GET /api/products
 * @desc    Get all products with filtering, sorting, and pagination
 * @access  Public
 */
router.get("/", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      seller,
      featured,
      trending,
      bestDeal,
      isActive = true,
      minPrice,
      maxPrice,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build filter object
    const filter = { isActive };

    if (category) filter.category = category;
    if (seller) filter["seller.sellerId"] = seller;
    if (featured !== undefined) filter.featured = featured === "true";
    if (trending !== undefined) filter.trending = trending === "true";
    if (bestDeal !== undefined) filter.bestDeal = bestDeal === "true";

    // Search functionality
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { brand: { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
        { searchKeywords: { $in: [new RegExp(search, "i")] } },
      ];
    }

    // Price range filter (checks all variants)
    if (minPrice || maxPrice) {
      const priceFilter = {};
      if (minPrice) priceFilter.$gte = Number(minPrice);
      if (maxPrice) priceFilter.$lte = Number(maxPrice);
      filter["variants.price"] = priceFilter;
    }

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Execute query
    const products = await Product.find(filter)
      .populate("category", "name slug")
      .sort(sort)
      .limit(Number(limit))
      .skip(skip)
      .lean();

    // Get total count
    const total = await Product.countDocuments(filter);

    res.json({
      success: true,
      data: products,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Get all products error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
      error: error.message,
    });
  }
});

/* ================= GET PRODUCTS BY CATEGORY ================= */

/**
 * @route   GET /api/products/category/:categoryId
 * @desc    Get all products in a specific category
 * @access  Public
 */
router.get("/category/:categoryId", async (req, res) => {
  try {
    const { categoryId } = req.params;
    const {
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID format",
      });
    }

    const filter = { category: categoryId, isActive: true };
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    const skip = (Number(page) - 1) * Number(limit);

    const products = await Product.find(filter)
      .populate("category", "name slug")
      .sort(sort)
      .limit(Number(limit))
      .skip(skip)
      .lean();

    const total = await Product.countDocuments(filter);

    res.json({
      success: true,
      data: products,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Get products by category error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
      error: error.message,
    });
  }
});

router.get("/:id/similar", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid product ID" });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    const keywords = product.name
      .toLowerCase()
      .split(" ")
      .filter((w) => w.length > 2);

    const similarProducts = await Product.find({
      _id: { $ne: product._id },
      category: product.category, // ✅ ObjectId
      isActive: true,
      $or: [
        { name: { $regex: keywords.join("|"), $options: "i" } },
        { brand: product.brand },
      ],
    })
      .limit(8)
      .populate("category", "name slug");

    res.json({
      success: true,
      data: similarProducts,
    });
  } catch (error) {
    console.error("Similar products error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch similar products",
    });
  }
});

/* ================= GET PRODUCT BY ID ================= */

/**
 * @route   GET /api/products/:id
 * @desc    Get single product by ID
 * @access  Public
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    const product = await Product.findById(id).populate(
      "category",
      "name slug",
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Get product by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch product",
      error: error.message,
    });
  }
});

/* ================= CREATE PRODUCT ================= */

/**
 * @route   POST /api/products
 * @desc    Create a new product
 * @access  Private (Add auth middleware as needed)
 */
router.post("/", async (req, res) => {
  try {
    const {
      name,
      description,
      brand,
      category,
      unit,
      seller,
      shelfLife,
      expiryRequired,
      storageInstructions,
      discount,
      tax,
      tags,
      searchKeywords,
      variants,
      image,
      images,
      featured,
      trending,
      bestDeal,
      isActive,
    } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Product name is required",
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    if (!unit) {
      return res.status(400).json({
        success: false,
        message: "Unit is required",
      });
    }

    if (!seller || !seller.sellerId) {
      return res.status(400).json({
        success: false,
        message: "Seller information is required",
      });
    }

    // Validate and process variants
    let validatedVariants;
    try {
      validatedVariants = validateVariants(variants);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    // Generate slug
    let slug = generateSlug(name);

    // Ensure slug is unique
    const existingProduct = await Product.findOne({ slug });
    if (existingProduct) {
      slug = `${slug}-${Date.now()}`;
    }

    // Create product
    const product = new Product({
      name,
      slug,
      description,
      brand,
      category,
      unit,
      seller,
      shelfLife,
      expiryRequired,
      storageInstructions,
      discount,
      tax,
      tags,
      searchKeywords,
      variants: validatedVariants,
      image,
      images,
      featured,
      trending,
      bestDeal,
      isActive,
    });

    await product.save();

    // Populate category before sending response
    await product.populate("category", "name slug");

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {
    console.error("Create product error:", error);

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Product with this slug already exists",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to create product",
      error: error.message,
    });
  }
});

/* ================= UPDATE PRODUCT ================= */

/**
 * @route   PUT /api/products/:id
 * @desc    Update product by ID (including all variants)
 * @access  Private (Add auth middleware as needed)
 */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    // Check if product exists
    const existingProduct = await Product.findById(id);
    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const updateData = { ...req.body };

    // If name is being updated, regenerate slug
    if (updateData.name && updateData.name !== existingProduct.name) {
      let newSlug = generateSlug(updateData.name);

      // Check if new slug conflicts with another product
      const slugConflict = await Product.findOne({
        slug: newSlug,
        _id: { $ne: id },
      });

      if (slugConflict) {
        newSlug = `${newSlug}-${Date.now()}`;
      }

      updateData.slug = newSlug;
    }

    // Validate variants if provided
    if (updateData.variants) {
      try {
        updateData.variants = validateVariants(updateData.variants);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }
    }

    // Update product
    const updatedProduct = await Product.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).populate("category", "name slug");

    res.json({
      success: true,
      message: "Product updated successfully",
      data: updatedProduct,
    });
  } catch (error) {
    console.error("Update product error:", error);

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Product with this slug already exists",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update product",
      error: error.message,
    });
  }
});

/* ================= DELETE PRODUCT (SOFT DELETE) ================= */

/**
 * @route   DELETE /api/products/:id
 * @desc    Soft delete product (set isActive to false)
 * @access  Private (Add auth middleware as needed)
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    const product = await Product.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
      success: true,
      message: "Product deactivated successfully",
      data: product,
    });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to deactivate product",
      error: error.message,
    });
  }
});

/* ================= VARIANT MANAGEMENT ================= */

/**
 * @route   POST /api/products/:id/variants
 * @desc    Add a new variant to existing product
 * @access  Private
 */
router.post("/:id/variants", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      packSize,
      packUnit,
      mrp,
      price,
      stock,
      lowStockThreshold,
      sku,
      isDefault,
      isActive,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    // Validation
    if (!packSize || !packUnit || !mrp || !price || stock === undefined) {
      return res.status(400).json({
        success: false,
        message: "Pack size, pack unit, MRP, price, and stock are required",
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      product.variants.forEach((v) => {
        v.isDefault = false;
      });
    }

    // Add new variant
    product.variants.push({
      packSize,
      packUnit,
      mrp,
      price,
      stock,
      lowStockThreshold,
      sku,
      isDefault: isDefault || false,
      isActive: isActive !== undefined ? isActive : true,
    });

    await product.save();

    res.status(201).json({
      success: true,
      message: "Variant added successfully",
      data: product,
    });
  } catch (error) {
    console.error("Add variant error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add variant",
      error: error.message,
    });
  }
});

/**
 * @route   PUT /api/products/:id/variants/:variantId
 * @desc    Update a specific variant
 * @access  Private
 */
router.put("/:id/variants/:variantId", async (req, res) => {
  try {
    const { id, variantId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Find variant
    const variant = product.variants.id(variantId);

    if (!variant) {
      return res.status(404).json({
        success: false,
        message: "Variant not found",
      });
    }

    // Update variant fields
    const {
      packSize,
      packUnit,
      mrp,
      price,
      stock,
      lowStockThreshold,
      sku,
      isDefault,
      isActive,
    } = req.body;

    if (packSize !== undefined) variant.packSize = packSize;
    if (packUnit !== undefined) variant.packUnit = packUnit;
    if (mrp !== undefined) variant.mrp = mrp;
    if (price !== undefined) variant.price = price;
    if (stock !== undefined) variant.stock = stock;
    if (lowStockThreshold !== undefined)
      variant.lowStockThreshold = lowStockThreshold;
    if (sku !== undefined) variant.sku = sku;
    if (isActive !== undefined) variant.isActive = isActive;

    // Handle default variant
    if (isDefault === true) {
      product.variants.forEach((v) => {
        v.isDefault = false;
      });
      variant.isDefault = true;
    } else if (isDefault === false) {
      variant.isDefault = false;
    }

    await product.save();

    res.json({
      success: true,
      message: "Variant updated successfully",
      data: product,
    });
  } catch (error) {
    console.error("Update variant error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update variant",
      error: error.message,
    });
  }
});

/**
 * @route   DELETE /api/products/:id/variants/:variantId
 * @desc    Delete a specific variant
 * @access  Private
 */
router.delete("/:id/variants/:variantId", async (req, res) => {
  try {
    const { id, variantId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Check if product has only one variant
    if (product.variants.length === 1) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete the only variant. Product must have at least one variant.",
      });
    }

    // Find and remove variant
    const variant = product.variants.id(variantId);

    if (!variant) {
      return res.status(404).json({
        success: false,
        message: "Variant not found",
      });
    }

    const wasDefault = variant.isDefault;

    // Remove variant using pull
    product.variants.pull(variantId);

    // If deleted variant was default, set first remaining variant as default
    if (wasDefault && product.variants.length > 0) {
      product.variants[0].isDefault = true;
    }

    await product.save();

    res.json({
      success: true,
      message: "Variant deleted successfully",
      data: product,
    });
  } catch (error) {
    console.error("Delete variant error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete variant",
      error: error.message,
    });
  }
});

/**
 * @route   PATCH /api/products/:id/variants/:variantId/stock
 * @desc    Update only stock quantity for a variant
 * @access  Private
 */
router.patch("/:id/variants/:variantId/stock", async (req, res) => {
  try {
    const { id, variantId } = req.params;
    const { stock } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    if (stock === undefined || stock < 0) {
      return res.status(400).json({
        success: false,
        message: "Valid stock quantity is required",
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const variant = product.variants.id(variantId);

    if (!variant) {
      return res.status(404).json({
        success: false,
        message: "Variant not found",
      });
    }

    variant.stock = stock;
    await product.save();

    res.json({
      success: true,
      message: "Stock updated successfully",
      data: {
        productId: product._id,
        variantId: variant._id,
        stock: variant.stock,
      },
    });
  } catch (error) {
    console.error("Update stock error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update stock",
      error: error.message,
    });
  }
});

module.exports = router;
