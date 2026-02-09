const express = require("express");
const router = express.Router();
const Order = require("../models/Orders"); // Adjust path as needed
const Payment = require("../models/Payment"); // Adjust path as needed
const Cart = require("../models/Cart"); // Adjust path as needed
const Product = require("../models/Product"); // Adjust path as needed
const mongoose = require("mongoose");

/* ================= HELPER FUNCTIONS ================= */

/**
 * Generate unique order number
 */
const generateOrderNumber = async () => {
  const prefix = "ORD";
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");

  const orderNumber = `${prefix}${timestamp}${random}`;

  // Ensure uniqueness
  const existing = await Order.findOne({ orderNumber });
  if (existing) {
    return generateOrderNumber(); // Recursive retry
  }

  return orderNumber;
};

/**
 * Validate stock availability for order items
 */
const validateOrderStock = async (items) => {
  const stockIssues = [];

  for (const item of items) {
    const product = await Product.findById(item.product);

    if (!product || !product.isActive) {
      stockIssues.push({
        productId: item.product,
        productName: item.productName,
        issue: "Product not available",
      });
      continue;
    }

    const variant = product.variants.find(
      (v) => v._id.toString() === item.variantId.toString(),
    );

    if (!variant || !variant.isActive) {
      stockIssues.push({
        productId: item.product,
        productName: item.productName,
        issue: "Variant not available",
      });
      continue;
    }

    if (variant.stock < item.quantity) {
      stockIssues.push({
        productId: item.product,
        productName: item.productName,
        issue: `Insufficient stock. Required: ${item.quantity}, Available: ${variant.stock}`,
      });
    }
  }

  return stockIssues;
};

/**
 * Reduce stock for order items
 */
const reduceStock = async (items) => {
  for (const item of items) {
    await Product.updateOne(
      {
        _id: item.product,
        "variants._id": item.variantId,
      },
      {
        $inc: { "variants.$.stock": -item.quantity },
      },
    );
  }
};

/**
 * Restore stock (for cancellations/failures)
 */
const restoreStock = async (items) => {
  for (const item of items) {
    await Product.updateOne(
      {
        _id: item.product,
        "variants._id": item.variantId,
      },
      {
        $inc: { "variants.$.stock": item.quantity },
      },
    );
  }
};

/* ================= CREATE ORDER ================= */

/**
 * @route   POST /api/orders
 * @desc    Create new order from cart
 * @access  Private
 */
router.post("/", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      userId,
      addressId,
      addressSnapshot,
      paymentMethod,
      deliverySlot,
      deliveryFee = 0,
      notes,
    } = req.body;

    console.log("RERER", req?.body);

    // Validation
    if (!userId || !addressId || !paymentMethod) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "User ID, Address ID, and Payment Method are required",
      });
    }

    if (!["cod", "upi", "card", "wallet"].includes(paymentMethod)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
    }

    // Get active cart
    const cart = await Cart.findOne({ user: userId, status: "active" }).session(
      session,
    );

    if (!cart || cart.items.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Cart is empty",
      });
    }

    // Validate stock
    const stockIssues = await validateOrderStock(cart.items);
    if (stockIssues.length > 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Stock validation failed",
        issues: stockIssues,
      });
    }

    // Generate order number
    const orderNumber = await generateOrderNumber();

    // Calculate grand total including delivery fee
    const grandTotal = cart.grandTotal + deliveryFee;

    // Create order
    const order = new Order({
      user: userId,
      items: cart.items,
      totalItems: cart.totalItems,
      totalQuantity: cart.totalQuantity,
      subtotal: cart.subtotal,
      totalDiscount: cart.totalDiscount,
      taxAmount: cart.taxAmount,
      deliveryFee,
      grandTotal,
      payment: {
        method: paymentMethod,
        status: paymentMethod === "cod" ? "pending" : "pending",
        isCod: paymentMethod === "cod",
      },
      address: {
        addressId,
        snapshot: addressSnapshot,
      },
      deliverySlot,
      status: "placed",
      orderNumber,
      notes,
    });

    await order.save({ session });

    // Create payment record
    const payment = new Payment({
      order: order._id,
      user: userId,
      amount: grandTotal,
      method: paymentMethod,
      status: paymentMethod === "cod" ? "pending" : "initiated",
      isCod: paymentMethod === "cod",
    });

    await payment.save({ session });

    // Reduce stock
    await reduceStock(cart.items);

    // Mark cart as converted
    cart.status = "converted";
    await cart.save({ session });

    await session.commitTransaction();

    // Populate order details
    await order.populate("items.product", "name image");

    res.status(201).json({
      success: true,
      message: "Order placed successfully",
      data: {
        order,
        payment: {
          id: payment._id,
          status: payment.status,
          method: payment.method,
          amount: payment.amount,
        },
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Create order error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
});

/* ================= GET ALL ORDERS (USER) ================= */

/**
 * @route   GET /api/orders
 * @desc    Get all orders for a user
 * @access  Private
 */
router.get("/", async (req, res) => {
  try {
    const {
      userId,
      status,
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Build filter
    const filter = { user: userId };
    if (status) {
      filter.status = status;
    }

    // Sorting
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);

    const orders = await Order.find(filter)
      .populate("items.product", "name image")
      .sort(sort)
      .limit(Number(limit))
      .skip(skip)
      .lean();

    const total = await Order.countDocuments(filter);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Get orders error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
});

/* ================= GET ORDER BY ID ================= */

/**
 * @route   GET /api/orders/:id
 * @desc    Get single order by ID
 * @access  Private
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query; // For authorization

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID format",
      });
    }

    const order = await Order.findById(id).populate(
      "items.product",
      "name image",
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Optional: Verify user owns this order
    if (userId && order.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access to order",
      });
    }

    // Get payment details
    const payment = await Payment.findOne({ order: order._id }).lean();

    res.json({
      success: true,
      data: {
        order,
        payment,
      },
    });
  } catch (error) {
    console.error("Get order by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch order",
      error: error.message,
    });
  }
});

/* ================= GET ORDER BY ORDER NUMBER ================= */

/**
 * @route   GET /api/orders/number/:orderNumber
 * @desc    Get order by order number
 * @access  Private
 */
router.get("/number/:orderNumber", async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const { userId } = req.query;

    const order = await Order.findOne({ orderNumber }).populate(
      "items.product",
      "name image",
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Verify user owns this order
    if (userId && order.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access to order",
      });
    }

    const payment = await Payment.findOne({ order: order._id }).lean();

    res.json({
      success: true,
      data: {
        order,
        payment,
      },
    });
  } catch (error) {
    console.error("Get order by number error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch order",
      error: error.message,
    });
  }
});

/* ================= UPDATE ORDER STATUS ================= */

/**
 * @route   PUT /api/orders/:id/status
 * @desc    Update order status (Admin/Seller)
 * @access  Private (Admin/Seller)
 */
router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID format",
      });
    }

    const validStatuses = [
      "placed",
      "confirmed",
      "packed",
      "out_for_delivery",
      "delivered",
      "cancelled",
      "returned",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Prevent status change if already delivered/cancelled
    if (["delivered", "cancelled", "returned"].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot change status of ${order.status} order`,
      });
    }

    const updateData = { status };

    // Handle delivery
    if (status === "delivered") {
      updateData.deliveredAt = new Date();

      // For COD, mark payment as success when delivered
      if (order.payment.isCod) {
        updateData["payment.status"] = "paid";
        updateData["payment.codCollected"] = true;
        updateData["payment.paidAt"] = new Date();

        // Update payment record
        await Payment.findOneAndUpdate(
          { order: order._id },
          {
            status: "success",
            codCollected: true,
            collectedAt: new Date(),
          },
        );
      }
    }

    // Add notes if provided
    if (notes) {
      updateData.notes = notes;
    }

    const updatedOrder = await Order.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).populate("items.product", "name image");

    res.json({
      success: true,
      message: `Order status updated to ${status}`,
      data: updatedOrder,
    });
  } catch (error) {
    console.error("Update order status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update order status",
      error: error.message,
    });
  }
});

/* ================= CANCEL ORDER ================= */

/**
 * @route   POST /api/orders/:id/cancel
 * @desc    Cancel order (User/Admin)
 * @access  Private
 */
router.post("/:id/cancel", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { userId, reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid order ID format",
      });
    }

    const order = await Order.findById(id).session(session);

    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Verify user owns this order
    if (userId && order.user.toString() !== userId) {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "Unauthorized to cancel this order",
      });
    }

    // Check if order can be cancelled
    if (["delivered", "cancelled", "returned"].includes(order.status)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Cannot cancel ${order.status} order`,
      });
    }

    // Prevent cancellation if out for delivery (optional business rule)
    if (order.status === "out_for_delivery") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Cannot cancel order that is out for delivery",
      });
    }

    // Update order status
    order.status = "cancelled";
    order.cancelledAt = new Date();
    order.cancelReason = reason;
    order.payment.status = "cancelled";

    await order.save({ session });

    // Update payment status
    await Payment.findOneAndUpdate(
      { order: order._id },
      { status: "cancelled" },
      { session },
    );

    // Restore stock
    await restoreStock(order.items);

    await session.commitTransaction();

    res.json({
      success: true,
      message: "Order cancelled successfully",
      data: order,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Cancel order error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel order",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
});

/* ================= PAYMENT VERIFICATION ================= */

/**
 * @route   POST /api/orders/:id/verify-payment
 * @desc    Verify payment (for online payments)
 * @access  Private
 */
router.post("/:id/verify-payment", async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentId, signature, gatewayResponse } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID format",
      });
    }

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Skip for COD
    if (order.payment.isCod) {
      return res.status(400).json({
        success: false,
        message: "Payment verification not required for COD orders",
      });
    }

    // Update order payment status
    order.payment.status = "paid";
    order.payment.transactionId = paymentId;
    order.payment.paidAt = new Date();

    // Update order status to confirmed
    if (order.status === "placed") {
      order.status = "confirmed";
    }

    await order.save();

    // Update payment record
    await Payment.findOneAndUpdate(
      { order: order._id },
      {
        status: "success",
        "gateway.paymentId": paymentId,
        "gateway.signature": signature,
        "gateway.response": gatewayResponse,
      },
    );

    res.json({
      success: true,
      message: "Payment verified successfully",
      data: order,
    });
  } catch (error) {
    console.error("Verify payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify payment",
      error: error.message,
    });
  }
});

/* ================= GET ORDER STATISTICS ================= */

/**
 * @route   GET /api/orders/stats/:userId
 * @desc    Get order statistics for user
 * @access  Private
 */
router.get("/stats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const stats = await Order.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$grandTotal" },
        },
      },
    ]);

    const totalOrders = await Order.countDocuments({ user: userId });
    const totalSpent = await Order.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(userId),
          status: { $in: ["delivered"] },
        },
      },
      { $group: { _id: null, total: { $sum: "$grandTotal" } } },
    ]);

    res.json({
      success: true,
      data: {
        totalOrders,
        totalSpent: totalSpent[0]?.total || 0,
        statusBreakdown: stats,
      },
    });
  } catch (error) {
    console.error("Get order stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch order statistics",
      error: error.message,
    });
  }
});

module.exports = router;
