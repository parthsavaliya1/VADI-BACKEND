const express = require("express");
const Product = require("../models/Product");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

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

    const { name, price, unit, category, stock } = req.body;

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

    // Create product
    const product = await Product.create({
      name: name.trim(),
      price: Number(price),
      unit: unit.trim(),
      category: category.trim(),
      stock: stock ? Number(stock) : 0,
      image: req.file ? `/uploads/${req.file.filename}` : null,
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
 * GET /products?category=vegetables
 */
router.get("/", async (req, res) => {
  try {
    const { category } = req.query;

    const filter = category ? { category, isActive: true } : { isActive: true };

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
    const { name, price, unit, category, stock } = req.body;

    const updateData = {};

    if (name) updateData.name = name.trim();
    if (price) updateData.price = Number(price);
    if (unit) updateData.unit = unit.trim();
    if (category) updateData.category = category.trim();
    if (stock !== undefined) updateData.stock = Number(stock);
    if (req.file) updateData.image = `/uploads/${req.file.filename}`;

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

module.exports = router;
