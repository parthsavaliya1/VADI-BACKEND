const express = require("express");
const HomeSectionSettings = require("../models/HomeSectionSettings");

const router = express.Router();

const getOrCreateSettings = async () => {
  let doc = await HomeSectionSettings.findOne({ key: "default" });
  if (!doc) {
    doc = await HomeSectionSettings.create({ key: "default" });
  }
  return doc;
};

router.get("/", async (_req, res) => {
  try {
    const settings = await getOrCreateSettings();
    return res.json({ success: true, data: settings });
  } catch (error) {
    console.error("Get home section settings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch home section settings",
      error: error.message,
    });
  }
});

router.put("/", async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const boolFields = [
      "showTrendingSection",
      "showFeaturedSection",
      "showBestDealsSection",
      "showShopByCategorySection",
      "showFeatureBadgesRow",
      "showHeroBanner",
    ];

    for (const field of boolFields) {
      if (typeof req.body[field] === "boolean") {
        settings[field] = req.body[field];
      }
    }

    await settings.save();
    return res.json({
      success: true,
      message: "Home section settings updated",
      data: settings,
    });
  } catch (error) {
    console.error("Update home section settings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update home section settings",
      error: error.message,
    });
  }
});

module.exports = router;
