const express = require("express");
const Product = require("../models/Product");

const router = express.Router();

/**
 * ✅ CREATE PRODUCT (ADMIN)
 * POST /products
 */
router.post("/", async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (error) {
    res.status(400).json({ error: error.message });
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

    const products = await Product.find(filter).sort({ createdAt: -1 });

    res.json(products);
  } catch (error) {
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
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
