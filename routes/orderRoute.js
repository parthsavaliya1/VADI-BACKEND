const express = require("express");
const Order = require("../models/Orders");
const Product = require("../models/Product");
const Payment = require("../models/Payment");

const router = express.Router();

/**
 * ✅ PLACE ORDER
 * POST /orders
 */
router.post("/", async (req, res) => {
  try {
    const { user, items, address, paymentMethod } = req.body;

    let totalAmount = 0;

    // stock check
    for (let item of items) {
      const product = await Product.findById(item.product);
      if (!product || product.stock < item.quantity) {
        return res.status(400).json({ error: `${product.name} out of stock` });
      }
      totalAmount += product.price * item.quantity;
    }

    const order = await Order.create({
      user,
      items,
      totalAmount,
      address,
    });

    // reduce stock
    for (let item of items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: -item.quantity },
      });
    }

    const payment = await Payment.create({
      user,
      order: order._id,
      amount: totalAmount,
      method: paymentMethod,
      status: paymentMethod === "cod" ? "pending" : "success",
    });

    order.payment = payment._id;
    await order.save();

    res.status(201).json({ order, payment });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * ✅ ORDER HISTORY (USER)
 * GET /orders/user/:userId
 */
router.get("/user/:userId", async (req, res) => {
  try {
    const orders = await Order.find({ user: req.params.userId })
      .populate("items.product")
      .populate("payment")
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
