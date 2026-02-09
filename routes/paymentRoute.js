const express = require("express");
const router = express.Router();
const Payment = require("../models/Payment"); // Adjust path as needed
const Order = require("../models/Orders"); // Adjust path as needed
const mongoose = require("mongoose");

/* ================= GET PAYMENT BY ID ================= */

/**
 * @route   GET /api/payments/:id
 * @desc    Get payment details by ID
 * @access  Private
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format",
      });
    }

    const payment = await Payment.findById(id)
      .populate("order", "orderNumber status grandTotal")
      .populate("user", "name email")
      .lean();

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    // Verify user owns this payment
    if (userId && payment.user._id.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access to payment",
      });
    }

    res.json({
      success: true,
      data: payment,
    });
  } catch (error) {
    console.error("Get payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment",
      error: error.message,
    });
  }
});

/* ================= GET PAYMENT BY ORDER ================= */

/**
 * @route   GET /api/payments/order/:orderId
 * @desc    Get payment details by order ID
 * @access  Private
 */
router.get("/order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { userId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID format",
      });
    }

    const payment = await Payment.findOne({ order: orderId })
      .populate("order", "orderNumber status grandTotal")
      .lean();

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found for this order",
      });
    }

    // Verify user owns this payment
    if (userId && payment.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access to payment",
      });
    }

    res.json({
      success: true,
      data: payment,
    });
  } catch (error) {
    console.error("Get payment by order error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment",
      error: error.message,
    });
  }
});

/* ================= GET ALL PAYMENTS (USER) ================= */

/**
 * @route   GET /api/payments
 * @desc    Get all payments for a user
 * @access  Private
 */
router.get("/", async (req, res) => {
  try {
    const {
      userId,
      status,
      method,
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
    if (status) filter.status = status;
    if (method) filter.method = method;

    // Sorting
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);

    const payments = await Payment.find(filter)
      .populate("order", "orderNumber status grandTotal")
      .sort(sort)
      .limit(Number(limit))
      .skip(skip)
      .lean();

    const total = await Payment.countDocuments(filter);

    res.json({
      success: true,
      data: payments,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Get payments error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payments",
      error: error.message,
    });
  }
});

/* ================= INITIATE PAYMENT ================= */

/**
 * @route   POST /api/payments/initiate
 * @desc    Initiate payment for an order (for gateway integration)
 * @access  Private
 */
router.post("/initiate", async (req, res) => {
  try {
    const { orderId, gatewayName } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID format",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Check if payment already exists
    let payment = await Payment.findOne({ order: orderId });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
      });
    }

    // Skip for COD
    if (payment.isCod) {
      return res.status(400).json({
        success: false,
        message: "Payment initiation not required for COD orders",
      });
    }

    // Update payment status
    payment.status = "initiated";
    if (gatewayName) {
      payment.gateway.name = gatewayName;
    }

    await payment.save();

    // Here you would integrate with your payment gateway (Razorpay, Stripe, etc.)
    // and get gateway order ID, payment ID, etc.

    // Example response structure for Razorpay:
    const gatewayData = {
      gatewayOrderId: `gateway_${Date.now()}`, // Replace with actual gateway order ID
      amount: payment.amount,
      currency: payment.currency,
      // Add other gateway-specific data
    };

    res.json({
      success: true,
      message: "Payment initiated successfully",
      data: {
        paymentId: payment._id,
        orderId: order._id,
        orderNumber: order.orderNumber,
        amount: payment.amount,
        currency: payment.currency,
        gateway: gatewayData,
      },
    });
  } catch (error) {
    console.error("Initiate payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initiate payment",
      error: error.message,
    });
  }
});

/* ================= VERIFY PAYMENT ================= */

/**
 * @route   POST /api/payments/verify
 * @desc    Verify payment after gateway callback
 * @access  Private
 */
router.post("/verify", async (req, res) => {
  try {
    const {
      paymentId,
      orderId,
      gatewayPaymentId,
      gatewayOrderId,
      signature,
      gatewayResponse,
    } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const payment = await Payment.findOne({ order: orderId });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    // Here you would verify the signature with your payment gateway
    // For Razorpay: verify using razorpay_payment_id, razorpay_order_id, razorpay_signature

    const isSignatureValid = true; // Replace with actual signature verification

    if (!isSignatureValid) {
      payment.status = "failed";
      payment.failureReason = "Invalid signature";
      await payment.save();

      return res.status(400).json({
        success: false,
        message: "Payment verification failed - Invalid signature",
      });
    }

    // Update payment status
    payment.status = "success";
    payment.gateway.paymentId = gatewayPaymentId;
    payment.gateway.orderId = gatewayOrderId;
    payment.gateway.signature = signature;
    payment.gateway.response = gatewayResponse;

    await payment.save();

    // Update order
    await Order.findByIdAndUpdate(orderId, {
      "payment.status": "paid",
      "payment.transactionId": gatewayPaymentId,
      "payment.paidAt": new Date(),
      status: "confirmed",
    });

    res.json({
      success: true,
      message: "Payment verified successfully",
      data: payment,
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

/* ================= PAYMENT FAILED ================= */

/**
 * @route   POST /api/payments/:id/failed
 * @desc    Mark payment as failed
 * @access  Private
 */
router.post("/:id/failed", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, gatewayResponse } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format",
      });
    }

    const payment = await Payment.findById(id);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    payment.status = "failed";
    payment.failureReason = reason;
    if (gatewayResponse) {
      payment.gateway.response = gatewayResponse;
    }

    await payment.save();

    // Update order
    await Order.findByIdAndUpdate(payment.order, {
      "payment.status": "failed",
    });

    res.json({
      success: true,
      message: "Payment marked as failed",
      data: payment,
    });
  } catch (error) {
    console.error("Mark payment failed error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update payment status",
      error: error.message,
    });
  }
});

/* ================= REFUND PAYMENT ================= */

/**
 * @route   POST /api/payments/:id/refund
 * @desc    Process payment refund
 * @access  Private (Admin)
 */
router.post("/:id/refund", async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason, isPartial = false } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format",
      });
    }

    const payment = await Payment.findById(id);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    if (payment.status !== "success") {
      return res.status(400).json({
        success: false,
        message: "Can only refund successful payments",
      });
    }

    const refundAmount = amount || payment.amount;

    if (refundAmount > payment.amount) {
      return res.status(400).json({
        success: false,
        message: "Refund amount cannot exceed payment amount",
      });
    }

    // Here you would process refund with payment gateway
    const gatewayRefundId = `refund_${Date.now()}`; // Replace with actual gateway refund ID

    // Update payment
    payment.status = isPartial ? "partial_refund" : "refunded";
    payment.refund = {
      amount: refundAmount,
      reason,
      refundedAt: new Date(),
      gatewayRefundId,
    };

    await payment.save();

    // Update order
    await Order.findByIdAndUpdate(payment.order, {
      "payment.status": "refunded",
    });

    res.json({
      success: true,
      message: "Refund processed successfully",
      data: payment,
    });
  } catch (error) {
    console.error("Process refund error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process refund",
      error: error.message,
    });
  }
});

/* ================= MARK COD AS COLLECTED ================= */

/**
 * @route   POST /api/payments/:id/collect-cod
 * @desc    Mark COD payment as collected
 * @access  Private (Delivery Agent/Admin)
 */
router.post("/:id/collect-cod", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format",
      });
    }

    const payment = await Payment.findById(id);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    if (!payment.isCod) {
      return res.status(400).json({
        success: false,
        message: "This is not a COD payment",
      });
    }

    if (payment.codCollected) {
      return res.status(400).json({
        success: false,
        message: "COD already collected",
      });
    }

    payment.status = "success";
    payment.codCollected = true;
    payment.collectedAt = new Date();

    await payment.save();

    // Update order
    await Order.findByIdAndUpdate(payment.order, {
      "payment.status": "paid",
      "payment.codCollected": true,
      "payment.paidAt": new Date(),
    });

    res.json({
      success: true,
      message: "COD collected successfully",
      data: payment,
    });
  } catch (error) {
    console.error("Collect COD error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark COD as collected",
      error: error.message,
    });
  }
});

/* ================= PAYMENT STATISTICS ================= */

/**
 * @route   GET /api/payments/stats/:userId
 * @desc    Get payment statistics for user
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

    const stats = await Payment.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: {
            status: "$status",
            method: "$method",
          },
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    const totalPaid = await Payment.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(userId),
          status: "success",
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalRefunded = await Payment.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(userId),
          status: { $in: ["refunded", "partial_refund"] },
        },
      },
      { $group: { _id: null, total: { $sum: "$refund.amount" } } },
    ]);

    res.json({
      success: true,
      data: {
        totalPaid: totalPaid[0]?.total || 0,
        totalRefunded: totalRefunded[0]?.total || 0,
        breakdown: stats,
      },
    });
  } catch (error) {
    console.error("Get payment stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment statistics",
      error: error.message,
    });
  }
});

module.exports = router;
