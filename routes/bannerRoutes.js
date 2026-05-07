const express = require("express");
const router = express.Router();
const Banner = require("../models/Banner");

router.get("/", async (req, res) => {
  try {
    const activeOnly = req.query.active !== "false";
    const filter = activeOnly ? { isActive: true } : {};

    const banners = await Banner.find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: banners,
    });
  } catch (error) {
    console.error("Get banners error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch banners",
      error: error.message,
    });
  }
});

module.exports = router;
