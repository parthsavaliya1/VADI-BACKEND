const express = require("express");
const Category = require("../models/Category");

const router = express.Router();

/**
 * ✅ CREATE CATEGORY (ADMIN)
 * POST /categories
 */
router.post("/", async (req, res) => {
  try {
    const category = await Category.create(req.body);
    res.status(201).json(category);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * ✅ GET ALL CATEGORIES
 * GET /categories
 */
router.get("/", async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true }).sort({
      createdAt: -1,
    });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ✅ GET SINGLE CATEGORY
 * GET /categories/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
