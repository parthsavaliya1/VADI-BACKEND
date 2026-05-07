const express = require("express");
const DealSettings = require("../models/DealSettings");

const router = express.Router();

const getOrCreateSettings = async () => {
  let settings = await DealSettings.findOne({ key: "global" });
  if (!settings) {
    settings = await DealSettings.create({ key: "global" });
  }
  return settings;
};

router.get("/", async (_req, res) => {
  try {
    const settings = await getOrCreateSettings();
    return res.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error("Get deal settings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch deal settings",
      error: error.message,
    });
  }
});

router.put("/", async (req, res) => {
  try {
    const { dealEndsAt, isActive } = req.body;
    const settings = await getOrCreateSettings();

    if (dealEndsAt !== undefined) {
      if (dealEndsAt === null || dealEndsAt === "") {
        settings.dealEndsAt = null;
      } else {
        const parsed = new Date(dealEndsAt);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid deal end time",
          });
        }
        settings.dealEndsAt = parsed;
      }
    }

    if (typeof isActive === "boolean") {
      settings.isActive = isActive;
    }

    await settings.save();

    return res.json({
      success: true,
      message: "Deal settings updated",
      data: settings,
    });
  } catch (error) {
    console.error("Update deal settings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update deal settings",
      error: error.message,
    });
  }
});

module.exports = router;
