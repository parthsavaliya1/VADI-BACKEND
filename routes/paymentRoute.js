const express = require("express");
const Payment = require("../models/Payment");

const router = express.Router();

/**
 * ✅ GET USER PAYMENTS
 * GET /payments/:userId
 */
router.get("/:userId", async (req, res) => {
  try {
    const payments = await Payment.find({ user: req.params.userId })
      .populate("order")
      .sort({ createdAt: -1 });

    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
