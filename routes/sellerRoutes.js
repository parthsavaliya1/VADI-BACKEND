const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Seller = require("../models/Seller");

router.get("/", async (req, res) => {
  try {
    const { isActive, search, page, limit, sortBy = "name", sortOrder = "asc" } =
      req.query;

    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }

    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    let query = Seller.find(filter).sort(sort);

    if (page && limit) {
      const skip = (Number(page) - 1) * Number(limit);
      query = query.skip(skip).limit(Number(limit));
    }

    const sellers = await query.lean();
    let pagination = null;

    if (page && limit) {
      const total = await Seller.countDocuments(filter);
      pagination = {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      };
    }

    res.json({
      success: true,
      data: sellers,
      ...(pagination && { pagination }),
    });
  } catch (error) {
    console.error("Get sellers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch sellers",
      error: error.message,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid seller ID format" });
    }

    const seller = await Seller.findById(id).lean();
    if (!seller) {
      return res
        .status(404)
        .json({ success: false, message: "Seller not found" });
    }

    res.json({ success: true, data: seller });
  } catch (error) {
    console.error("Get seller by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch seller",
      error: error.message,
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, code, phone, email, location, isActive } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Seller name is required" });
    }

    const seller = new Seller({ name, code, phone, email, location, isActive });
    await seller.save();

    res.status(201).json({
      success: true,
      message: "Seller created successfully",
      data: seller,
    });
  } catch (error) {
    console.error("Create seller error:", error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Seller code already exists",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to create seller",
      error: error.message,
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid seller ID format" });
    }

    const seller = await Seller.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!seller) {
      return res
        .status(404)
        .json({ success: false, message: "Seller not found" });
    }

    res.json({
      success: true,
      message: "Seller updated successfully",
      data: seller,
    });
  } catch (error) {
    console.error("Update seller error:", error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Seller code already exists",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to update seller",
      error: error.message,
    });
  }
});

module.exports = router;
