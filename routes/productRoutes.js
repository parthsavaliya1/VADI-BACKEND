const express = require("express");
const Product = require("../models/Product");
const upload = require("../middleware/upload");
const supabase = require("../config/supabase");

const router = express.Router();

/**
 * ✅ CREATE PRODUCT (ADMIN)
 * POST /products
 * multipart/form-data
 */
router.post("/", upload.single("image"), async (req, res) => {
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

    let imageUrl = null;

    // ✅ Upload to Supabase
    if (req.file) {
      const fileName = `products/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}-${req.file.originalname}`;

      const { error } = await supabase.storage
        .from("VADI") // ✅ FIXED
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
        });

      if (error) throw error;

      const { data } = supabase.storage
        .from("VADI") // ✅ SAME BUCKET
        .getPublicUrl(fileName);

      imageUrl = data.publicUrl;
    }

    const product = await Product.create({
      name: name.trim(),
      price: Number(price),
      unit: unit.trim(),
      category: category.trim(),
      stock: stock ? Number(stock) : 0,
      image: imageUrl,
      discount: discount ? Number(discount) : 0,
      featured: featured === "true",
      trending: trending === "true",
      bestDeal: bestDeal === "true",
    });

    res.status(201).json(product);
  } catch (error) {
    console.error("❌ Product error:", error);
    res.status(400).json({ error: error.message });
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
    if (req.file) {
      const fileName = `products/${Date.now()}-${req.file.originalname}`;

      const { error } = await supabase.storage
        .from("uploads")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
        });

      if (!error) {
        const { data } = supabase.storage
          .from("uploads")
          .getPublicUrl(fileName);

        updateData.image = data.publicUrl;
      }
    }

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
