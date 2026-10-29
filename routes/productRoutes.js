const express = require("express");
const router = express.Router();
const Product = require("../models/Product"); // Adjust path as needed
const Seller = require("../models/Seller");
const mongoose = require("mongoose");

/* ================= HELPER FUNCTIONS ================= */

const normalizeVariantImages = (images) => Array.isArray(images)
  ? [...new Set(images.filter((url) => typeof url === "string").map((url) => url.trim()).filter(Boolean))]
  : [];

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

  variants.forEach((variant) => {
    variant.image =
      typeof variant.image === "string" ? variant.image.trim() : "";
    variant.images = normalizeVariantImages(variant.images);
    if (!variant.image) variant.image = variant.images[0] || "";
  });

  return variants;
};

const coverImageFromVariants = (variants, fallback = "") => {
  const explicit = typeof fallback === "string" ? fallback.trim() : "";
  if (explicit) return explicit;
  const preferred =
    variants.find((variant) => variant.isDefault && variant.image) ||
    variants.find((variant) => variant.image);
  return preferred?.image || "";
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
    const filter = {};
    if (isActive !== undefined && isActive !== "all") {
      filter.isActive = isActive === true || isActive === "true";
    } else if (isActive !== "all") {
      filter.isActive = true;
    }

    if (category) filter.category = category;
    if (seller && mongoose.Types.ObjectId.isValid(seller)) {
      filter["seller.sellerId"] = seller;
    }
    if (featured !== undefined) filter.featured = featured === "true";
    if (trending !== undefined) filter.trending = trending === "true";
    if (bestDeal !== undefined) filter.bestDeal = bestDeal === "true";
    if (req.query.isOrganic === "true") filter.isOrganic = true;

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

    const extra = [];
    if (req.query.inStock === "true") {
      extra.push({
        variants: {
          $elemMatch: { stock: { $gt: 0 }, isActive: { $ne: false } },
        },
      });
    }
    if (req.query.onSale === "true") {
      extra.push({
        $or: [
          { discount: { $gt: 0 } },
          {
            $expr: {
              $anyElementTrue: {
                $map: {
                  input: "$variants",
                  as: "v",
                  in: { $lt: ["$$v.price", "$$v.mrp"] },
                },
              },
            },
          },
        ],
      });
    }
    if (extra.length) {
      filter.$and = [...(filter.$and || []), ...extra];
    }

    if (req.query.includePending !== "true") {
      const visible = {
        $or: [
          { approvalStatus: "approved" },
          { approvalStatus: { $exists: false } },
          { approvalStatus: null },
        ],
      };
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, visible];
        delete filter.$or;
      } else {
        filter.$and = [visible];
      }
    }

    const sortFields = {
      createdAt: "createdAt",
      rating: "rating",
      name: "name",
      price: "price",
    };
    const sortKey = sortFields[sortBy] || "createdAt";
    const sortDir = sortOrder === "asc" ? 1 : -1;

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);

    let products;
    if (sortKey === "price") {
      const ranked = await Product.aggregate([
        { $match: filter },
        { $addFields: { sortPrice: { $min: "$variants.price" } } },
        { $sort: { sortPrice: sortDir } },
        { $skip: skip },
        { $limit: Number(limit) },
        { $project: { _id: 1 } },
      ]);
      const orderedIds = ranked.map((row) => row._id);
      const found = await Product.find({ _id: { $in: orderedIds } })
        .populate("category", "name slug")
        .populate("seller.sellerId", "name code")
        .lean();
      const orderMap = new Map(orderedIds.map((id, index) => [String(id), index]));
      products = found.sort(
        (a, b) => orderMap.get(String(a._id)) - orderMap.get(String(b._id)),
      );
    } else {
      const sort = { [sortKey]: sortDir };
      products = await Product.find(filter)
      .populate("category", "name slug")
      .populate("seller.sellerId", "name code")
      .sort(sort)
      .limit(Number(limit))
      .skip(skip)
      .lean();
    }

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
      .populate("seller.sellerId", "name code")
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

    const keywordQuery =
      keywords.length > 0
        ? {
            _id: { $ne: product._id },
            category: product.category,
            isActive: true,
            $or: [
              { name: { $regex: keywords.join("|"), $options: "i" } },
              ...(product.brand ? [{ brand: product.brand }] : []),
            ],
          }
        : null;

    let similarProducts = keywordQuery
      ? await Product.find(keywordQuery)
          .limit(8)
          .populate("category", "name slug")
          .populate("seller.sellerId", "name code")
      : [];

    if (similarProducts.length < 4) {
      const more = await Product.find({
        _id: {
          $nin: [product._id, ...similarProducts.map((item) => item._id)],
        },
        category: product.category,
        isActive: true,
      })
        .limit(8 - similarProducts.length)
        .populate("category", "name slug")
        .populate("seller.sellerId", "name code");
      similarProducts = similarProducts.concat(more);
    }

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

    const product = await Product.findById(id)
      .populate("category", "name slug")
      .populate("seller.sellerId", "name code")
      .lean();

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

/* ================= SELLER CREATE PRODUCT ================= */

router.post("/mine", async (req, res) => {
  try {
    const {
      userId,
      sellerId,
      name,
      description,
      category,
      unit,
      packSize,
      packUnit,
      price,
      mrp,
      stock,
      image,
      variants: incomingVariants,
    } = req.body;

    if (!name || !category || !unit) {
      return res.status(400).json({
        success: false,
        message: "Name, category, and unit are required",
      });
    }

    let sellerDoc = null;
    if (sellerId && mongoose.Types.ObjectId.isValid(sellerId)) {
      sellerDoc = await Seller.findOne({ _id: sellerId, status: "approved", isActive: true });
    } else if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      sellerDoc = await Seller.findOne({ user: userId, status: "approved", isActive: true });
    }
    if (!sellerDoc) {
      return res.status(403).json({
        success: false,
        message: "Only an approved seller can add a product",
      });
    }

    const allowedUnits = ["kg", "g", "litre", "ml", "pcs"];
    const sourceVariants =
      Array.isArray(incomingVariants) && incomingVariants.length
        ? incomingVariants
        : [
            {
              packSize,
              packUnit,
              price,
              mrp,
              stock,
              image: "",
              isDefault: true,
            },
          ];

    let validatedVariants;
    try {
      validatedVariants = validateVariants(
        sourceVariants.map((variant) => {
          const salePrice = Number(variant.price);
          const listPrice = Number(variant.mrp || variant.price);
          const qty = Number(variant.stock);
          const size = Number(variant.packSize);
          if (
            !salePrice ||
            salePrice <= 0 ||
            !listPrice ||
            listPrice < salePrice ||
            !size ||
            size <= 0 ||
            qty < 0 ||
            Number.isNaN(qty)
          ) {
            throw new Error(
              "Each variant needs a valid pack size, price, MRP, and stock",
            );
          }
          return {
            packSize: size,
            packUnit: allowedUnits.includes(variant.packUnit)
              ? variant.packUnit
              : "pcs",
            mrp: listPrice,
            price: salePrice,
            stock: qty,
            image: typeof variant.image === "string" ? variant.image : "",
            images: normalizeVariantImages(variant.images),
            isDefault: Boolean(variant.isDefault),
            isActive: variant.isActive !== false,
          };
        }),
      );
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    let slug = generateSlug(name);
    if (await Product.findOne({ slug })) slug = `${slug}-${Date.now()}`;

    const product = new Product({
      name: String(name).trim(),
      slug,
      description,
      category,
      unit,
      seller: {
        sellerId: sellerDoc._id,
        sellerName: sellerDoc.name,
        contact: { phone: sellerDoc.phone || "", email: sellerDoc.email || "" },
        location: {
          city: sellerDoc.location?.city || "",
          area: sellerDoc.location?.area || "",
        },
      },
      variants: validatedVariants,
      image: coverImageFromVariants(validatedVariants, image),
      approvalStatus: "approved",
      isActive: true,
      featured: false,
      trending: false,
      bestDeal: false,
    });

    await product.save();
    await product.populate("category", "name slug");

    res.status(201).json({
      success: true,
      message: "Product submitted. It will go live after admin approval.",
      data: product,
    });
  } catch (error) {
    console.error("Seller create product error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create product",
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
      isOrganic,
      offerEndsAt,
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

    const sellerId = seller?.sellerId || seller;
    if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) {
      return res.status(400).json({
        success: false,
        message: "Valid seller is required",
      });
    }

    const sellerDoc = await Seller.findById(sellerId);
    if (!sellerDoc || !sellerDoc.isActive) {
      return res.status(400).json({
        success: false,
        message: "Seller not found or inactive",
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

    let parsedOfferEndsAt = null;
    if (offerEndsAt !== undefined && offerEndsAt !== null && offerEndsAt !== "") {
      const d = new Date(offerEndsAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid offer end date",
        });
      }
      parsedOfferEndsAt = d;
    }

    // Create product
    const product = new Product({
      name,
      slug,
      description,
      brand,
      category,
      unit,
      seller: {
        sellerId: sellerDoc._id,
        sellerName: sellerDoc.name,
        contact: {
          phone: sellerDoc.phone || "",
          email: sellerDoc.email || "",
        },
        location: {
          city: sellerDoc.location?.city || "",
          area: sellerDoc.location?.area || "",
        },
      },
      shelfLife,
      expiryRequired,
      storageInstructions,
      discount,
      tax,
      tags,
      searchKeywords,
      variants: validatedVariants,
      image: coverImageFromVariants(validatedVariants, image),
      images,
      featured,
      trending,
      bestDeal,
      isOrganic: Boolean(isOrganic),
      offerEndsAt: parsedOfferEndsAt,
      isActive,
    });

    await product.save();

    // Populate category before sending response
    await product.populate("category", "name slug");
    await product.populate("seller.sellerId", "name code");

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

    if (Object.prototype.hasOwnProperty.call(updateData, "offerEndsAt")) {
      const v = updateData.offerEndsAt;
      if (v === null || v === "") {
        updateData.offerEndsAt = null;
      } else {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid offer end date",
          });
        }
        updateData.offerEndsAt = d;
      }
    }

    if (updateData.seller) {
      const sellerId = updateData.seller?.sellerId || updateData.seller;
      if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) {
        return res.status(400).json({
          success: false,
          message: "Valid seller is required",
        });
      }

      const sellerDoc = await Seller.findById(sellerId);
      if (!sellerDoc || !sellerDoc.isActive) {
        return res.status(400).json({
          success: false,
          message: "Seller not found or inactive",
        });
      }

      updateData.seller = {
        sellerId: sellerDoc._id,
        sellerName: sellerDoc.name,
        contact: {
          phone: sellerDoc.phone || "",
          email: sellerDoc.email || "",
        },
        location: {
          city: sellerDoc.location?.city || "",
          area: sellerDoc.location?.area || "",
        },
      };
    }

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
        if (!updateData.image) {
          updateData.image = coverImageFromVariants(
            updateData.variants,
            existingProduct.image,
          );
        }
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
    })
      .populate("category", "name slug")
      .populate("seller.sellerId", "name code");

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
      image,
      images,
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
      image: typeof image === "string" && image.trim() ? image.trim() : normalizeVariantImages(images)[0] || "",
      images: normalizeVariantImages(images),
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
      image,
      images,
    } = req.body;

    if (packSize !== undefined) variant.packSize = packSize;
    if (packUnit !== undefined) variant.packUnit = packUnit;
    if (mrp !== undefined) variant.mrp = mrp;
    if (price !== undefined) variant.price = price;
    if (stock !== undefined) variant.stock = stock;
    if (lowStockThreshold !== undefined)
      variant.lowStockThreshold = lowStockThreshold;
    if (sku !== undefined) variant.sku = sku;
    if (image !== undefined) variant.image = String(image || "").trim();
    if (images !== undefined) {
      variant.images = normalizeVariantImages(images);
      if (image === undefined) variant.image = variant.images[0] || "";
    }
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
