const express = require("express");
const { loadFeeSettings } = require("../utils/deliveryQuote");

const router = express.Router();

/** Public rules the customer app uses for cart and checkout. */
router.get("/", async (req, res) => {
  try {
    const settings = await loadFeeSettings();
    res.json({
      success: true,
      data: {
        deliveryFee: settings.deliveryFee,
        freeDeliveryAbove: settings.freeDeliveryAbove,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load fees" });
  }
});

module.exports = router;
