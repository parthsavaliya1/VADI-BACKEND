const express = require("express");
const Product = require("../models/Product");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

const getImageUrl = (req, filename) => {
  return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
};

/* =======================
   ENSURE UPLOADS DIRECTORY EXISTS
======================= */
const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("✅ Created uploads directory");
}

/* =======================
   MULTER CONFIG
======================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueName + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter(req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Only image files (JPEG, PNG, GIF, WEBP) are allowed"));
  },
});

/**
 * ✅ CREATE PRODUCT (ADMIN)
 * POST /products
 * multipart/form-data
 */
router.post("/", upload.single("image"), async (req, res) => {
  try {
    console.log("📦 Received product creation request");
    console.log("Body:", req.body);
    console.log("File:", req.file);

    const {
      name,
      price,
      unit,
      category,
      stock,
      discount,
      featured,
      trending,
      bestDeal,
    } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Product name is required" });
    }

    if (!price || isNaN(price) || Number(price) <= 0) {
      return res.status(400).json({ error: "Valid price is required" });
    }

    if (!unit || !unit.trim()) {
      return res.status(400).json({ error: "Unit is required" });
    }

    if (!category || !category.trim()) {
      return res.status(400).json({ error: "Category is required" });
    }

    if (stock !== undefined && (isNaN(stock) || Number(stock) < 0)) {
      return res
        .status(400)
        .json({ error: "Stock must be a non-negative number" });
    }

    // Validate discount
    if (discount !== undefined) {
      const discountNum = Number(discount);
      if (isNaN(discountNum) || discountNum < 0 || discountNum > 100) {
        return res
          .status(400)
          .json({ error: "Discount must be between 0 and 100" });
      }
    }

    // Create product
    const product = await Product.create({
      name: name.trim(),
      price: Number(price),
      unit: unit.trim(),
      category: category.trim(),
      stock: stock ? Number(stock) : 0,
      image: req.file ? getImageUrl(req, req.file.filename) : null,
      discount: discount ? Number(discount) : 0,
      featured: featured === "true" || featured === true,
      trending: trending === "true" || trending === true,
      bestDeal: bestDeal === "true" || bestDeal === true,
    });

    console.log("✅ Product created successfully:", product._id);
    res.status(201).json(product);
  } catch (error) {
    console.error("❌ Error creating product:", error);

    // Delete uploaded file if product creation fails
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("Error deleting file:", err);
      });
    }

    res.status(400).json({
      error: error.message || "Failed to create product",
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * ✅ GET PRODUCTS
 * GET /products?category=vegetables&featured=true&trending=true&bestDeal=true
 */
router.get("/", async (req, res) => {
  try {
    const { category, featured, trending, bestDeal } = req.query;

    const filter = { isActive: true };

    if (category) {
      filter.category = category;
    }

    // Add filters for special sections
    if (featured === "true") {
      filter.featured = true;
    }

    if (trending === "true") {
      filter.trending = true;
    }

    if (bestDeal === "true") {
      filter.bestDeal = true;
    }

    const products = await Product.find(filter).sort({
      createdAt: -1,
    });

    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * ✅ GET SINGLE PRODUCT
 * GET /products/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json(product);
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * ✅ UPDATE PRODUCT
 * PUT /products/:id
 */
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const {
      name,
      price,
      unit,
      category,
      stock,
      discount,
      featured,
      trending,
      bestDeal,
    } = req.body;

    const updateData = {};

    if (name) updateData.name = name.trim();
    if (price) updateData.price = Number(price);
    if (unit) updateData.unit = unit.trim();
    if (category) updateData.category = category.trim();
    if (stock !== undefined) updateData.stock = Number(stock);
    if (req.file) updateData.image = getImageUrl(req, req.file.filename);

    // Update new fields
    if (discount !== undefined) {
      const discountNum = Number(discount);
      if (discountNum >= 0 && discountNum <= 100) {
        updateData.discount = discountNum;
      }
    }

    if (featured !== undefined) {
      updateData.featured = featured === "true" || featured === true;
    }

    if (trending !== undefined) {
      updateData.trending = trending === "true" || trending === true;
    }

    if (bestDeal !== undefined) {
      updateData.bestDeal = bestDeal === "true" || bestDeal === true;
    }

    const product = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json(product);
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * ✅ DELETE PRODUCT
 * DELETE /products/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Delete associated image file
    if (product.image) {
      const imagePath = path.join(__dirname, "..", product.image);
      fs.unlink(imagePath, (err) => {
        if (err) console.error("Error deleting image:", err);
      });
    }

    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * ✅ BULK UPDATE DEALS/FEATURED/TRENDING
 * PATCH /products/bulk-update
 * Body: { productIds: [], updates: { featured: true, trending: false } }
 */
router.patch("/bulk-update", async (req, res) => {
  try {
    const { productIds, updates } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: "Product IDs array is required" });
    }

    if (!updates || typeof updates !== "object") {
      return res.status(400).json({ error: "Updates object is required" });
    }

    const allowedUpdates = ["featured", "trending", "bestDeal", "discount"];
    const updateData = {};

    Object.keys(updates).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updateData[key] = updates[key];
      }
    });

    const result = await Product.updateMany(
      { _id: { $in: productIds } },
      { $set: updateData },
    );

    res.json({
      message: "Products updated successfully",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error bulk updating products:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
