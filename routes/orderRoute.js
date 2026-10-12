const express = require("express");
const router = express.Router();
const Order = require("../models/Orders"); // Adjust path as needed
const Payment = require("../models/Payment");
const { debitWallet, creditWallet } = require("../utils/wallet"); // Adjust path as needed
const Cart = require("../models/Cart"); // Adjust path as needed
const Product = require("../models/Product"); // Adjust path as needed
const User = require("../models/User");
const mongoose = require("mongoose");
const crypto = require("crypto");
const {
  quoteDeliveryFee,
  quoteDeliverySlot,
  normalizeAddressSnapshot,
} = require("../utils/deliveryQuote");
const {
  generateHandoverCode,
  encryptHandoverCode,
  decryptHandoverCode,
  normalizeCodeInput,
  codesEqualTimingSafe,
  MAX_WRONG_ATTEMPTS,
  sendHandoverSmsIfConfigured,
} = require("../utils/deliveryHandover");
const { buildOrderInvoicePdf } = require("../utils/orderInvoicePdf");
const adminOrDriverMiddleware = require("../middleware/adminOrDriverMiddleware");

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

const verifyRazorpaySignature = ({ orderId, paymentId, signature }) => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return expected === signature;
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
      paymentDetails,
      deliverySlot,
      notes,
    } = req.body;

    // Validation
    if (!userId || !addressId || !paymentMethod) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "User ID, Address ID, and Payment Method are required",
      });
    }

    if (!["cod", "upi", "card", "wallet", "balance"].includes(paymentMethod)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
    }

    if (paymentMethod !== "cod" && paymentMethod !== "balance") {
      if (
        !paymentDetails?.razorpayPaymentId ||
        !paymentDetails?.razorpayOrderId ||
        !paymentDetails?.razorpaySignature
      ) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Online payment details are required",
        });
      }

      const duplicatePayment = await Payment.findOne({
        "gateway.paymentId": paymentDetails.razorpayPaymentId,
      }).populate("order", "_id orderNumber");

      if (duplicatePayment?.order) {
        await session.abortTransaction();
        return res.status(409).json({
          success: false,
          message: "This payment has already been used",
          data: {
            orderId: duplicatePayment.order._id,
            orderNumber: duplicatePayment.order.orderNumber,
          },
        });
      }

      const signatureOk = verifyRazorpaySignature({
        orderId: paymentDetails.razorpayOrderId,
        paymentId: paymentDetails.razorpayPaymentId,
        signature: paymentDetails.razorpaySignature,
      });

      if (!signatureOk) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Payment signature verification failed",
        });
      }
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

    // Delivery fee is quoted from the cart, not trusted from the client.
    const quotedDeliveryFee = quoteDeliveryFee(cart.grandTotal);
    const grandTotal = cart.grandTotal + quotedDeliveryFee;
    const quotedSlot =
      deliverySlot?.date && deliverySlot?.slot
        ? deliverySlot
        : quoteDeliverySlot();

    // Create order
    const order = new Order({
      user: userId,
      items: cart.items,
      totalItems: cart.totalItems,
      totalQuantity: cart.totalQuantity,
      subtotal: cart.subtotal,
      totalDiscount: cart.totalDiscount,
      taxAmount: cart.taxAmount,
      deliveryFee: quotedDeliveryFee,
      grandTotal,
      payment: {
        method: paymentMethod,
        status: paymentMethod === "cod" ? "pending" : "paid",
        isCod: paymentMethod === "cod",
        transactionId:
          paymentMethod === "balance" ? "wallet" : paymentDetails?.razorpayPaymentId,
        gatewayOrderId: paymentDetails?.razorpayOrderId,
        gatewaySignature: paymentDetails?.razorpaySignature,
        paidAt: paymentMethod === "cod" ? undefined : new Date(),
      },
      address: {
        addressId,
        snapshot: normalizeAddressSnapshot(addressSnapshot),
      },
      deliverySlot: quotedSlot,
      status: paymentMethod === "cod" ? "placed" : "confirmed",
      orderNumber,
      notes,
    });

    await order.save({ session });

    if (paymentMethod === "balance") {
      await debitWallet({
        userId,
        amount: grandTotal,
        orderId: order._id,
        session,
      });
    }

    // Create payment record
    const payment = new Payment({
      order: order._id,
      user: userId,
      amount: grandTotal,
      method: paymentMethod,
      status: paymentMethod === "cod" ? "pending" : "success",
      isCod: paymentMethod === "cod",
      gateway:
        paymentMethod === "cod" || paymentMethod === "balance"
          ? paymentMethod === "balance"
            ? { name: "wallet", response: { source: "checkout" } }
            : undefined
          : {
              name: "razorpay",
              paymentId: paymentDetails?.razorpayPaymentId,
              orderId: paymentDetails?.razorpayOrderId,
              signature: paymentDetails?.razorpaySignature,
              response: {
                source: "checkout",
              },
            },
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
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Failed to create order",
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
/* ================= GET ALL ORDERS (USER & ADMIN) ================= */

/**
 * @route   GET /api/orders
 * @desc    Get all orders for a user or all orders for admin
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
      isAdmin,
    } = req.query;

    // Build filter
    const filter = {};

    // If not admin, filter by userId
    if (!isAdmin && userId) {
      filter.user = userId;
    } else if (!isAdmin && !userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required for non-admin access",
      });
    }

    if (status) {
      filter.status = status;
    }

    // Sorting
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);

    const orders = await Order.find(filter)
      .populate("items.product", "name image")
      .populate("user", "name email phone")
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

/**
 * @route   GET /orders/:id/invoice
 * @desc    PDF invoice (delivered orders only). Query: userId (owner) OR isAdmin=true.
 */
router.get("/:id/invoice", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, isAdmin } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID format",
      });
    }

    const order = await Order.findById(id)
      .populate("items.product", "name image")
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.status !== "delivered") {
      return res.status(400).json({
        success: false,
        message: "Invoice is available only after the order is delivered",
      });
    }

    const adminBypass = String(isAdmin).toLowerCase() === "true";
    const ownerOk =
      userId && order.user.toString() === String(userId).trim();
    if (!ownerOk && !adminBypass) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to download this invoice",
      });
    }

    const buf = await buildOrderInvoicePdf(order);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="VADI-Invoice-${order.orderNumber || id}.pdf"`,
    );
    return res.send(buf);
  } catch (error) {
    console.error("GET order invoice error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate invoice",
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

    const order = await Order.findById(id)
      .select("+deliveryHandoverCipher")
      .populate("items.product", "name image");

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

    const orderPayload = order.toObject();
    delete orderPayload.deliveryHandoverCipher;

    const ownerRequested =
      userId && order.user.toString() === userId && order.status === "out_for_delivery";
    if (
      ownerRequested &&
      !order.deliveryHandoverVerifiedAt &&
      order.deliveryHandoverCipher
    ) {
      try {
        const code = decryptHandoverCode(order.deliveryHandoverCipher);
        if (code) orderPayload.deliveryHandoverCode = code;
      } catch (e) {
        console.error("Decrypt handover code error:", e.message);
      }
    }

    // Get payment details
    const payment = await Payment.findOne({ order: order._id }).lean();

    res.json({
      success: true,
      data: {
        order: orderPayload,
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
      "shipped",
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

    const order = await Order.findById(id).select("+deliveryHandoverCipher");

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

    const prevStatus = order.status;

    if (status === "delivered") {
      if (order.deliveryHandoverGeneratedAt && !order.deliveryHandoverVerifiedAt) {
        return res.status(400).json({
          success: false,
          message:
            "Verify the customer's 6-digit delivery code before marking this order as delivered.",
        });
      }
    }

    const updateData = { status };

    let handoverPlain = null;
    if (status === "out_for_delivery" && prevStatus !== "out_for_delivery") {
      handoverPlain = generateHandoverCode();
      const plain = handoverPlain;
      updateData.deliveryHandoverCipher = encryptHandoverCode(plain);
      updateData.deliveryHandoverGeneratedAt = new Date();
      updateData.deliveryHandoverWrongAttempts = 0;
      updateData.deliveryHandoverVerifiedAt = null;
      updateData.deliveryHandoverVerifiedByDriver = null;
    }

    if (
      prevStatus === "out_for_delivery" &&
      status !== "out_for_delivery" &&
      status !== "delivered"
    ) {
      updateData.deliveryHandoverCipher = null;
      updateData.deliveryHandoverGeneratedAt = null;
      updateData.deliveryHandoverWrongAttempts = 0;
      updateData.deliveryHandoverVerifiedAt = null;
      updateData.deliveryHandoverVerifiedByDriver = null;
    }

    // Handle delivery
    if (status === "delivered") {
      updateData.deliveredAt = new Date();
      updateData.deliveryHandoverCipher = null;
      updateData.deliveryHandoverWrongAttempts = 0;

      if (order.deliveryHandoverVerifiedByDriver) {
        updateData.deliveredByDriver = order.deliveryHandoverVerifiedByDriver;
      }

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

    if (handoverPlain) {
      const phone =
        order.address?.snapshot?.phone ||
        updatedOrder?.address?.snapshot?.phone;
      if (phone) {
        sendHandoverSmsIfConfigured(phone, handoverPlain, order.orderNumber).catch(
          (err) => console.error("Handover SMS error:", err.message),
        );
      }
    }

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

/**
 * Resolve :id for handover verify — MongoDB ObjectId (24 hex) OR orderNumber (e.g. ORD23908068615, #ORD…).
 * @route   POST /api/orders/:id/verify-delivery-handover
 * @desc    Confirm the 6-digit code the customer shared with delivery staff
 * @access  Private (Admin JWT or driver JWT)
 */
router.post(
  "/:id/verify-delivery-handover",
  adminOrDriverMiddleware,
  async (req, res) => {
    try {
    const rawRef = decodeURIComponent(String(req.params.id || "").trim());
    const ref = rawRef.replace(/^#/, "").trim();
    const { code } = req.body;

      let order = null;
      if (/^[a-fA-F0-9]{24}$/.test(ref)) {
        order = await Order.findById(ref).select("+deliveryHandoverCipher");
      } else if (ref.length >= 3 && ref.length <= 64) {
        order = await Order.findOne({
          orderNumber: new RegExp(`^${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
        }).select("+deliveryHandoverCipher");
      }

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found. Use order number (e.g. ORD…) or the ID from the admin order URL.",
        });
      }

      const orderIdStr = order._id.toString();

      if (order.status !== "out_for_delivery") {
        return res.status(400).json({
          success: false,
          message:
            "Handover code can only be verified while the order is out for delivery",
        });
      }

      if (!order.deliveryHandoverCipher) {
        return res.status(400).json({
          success: false,
          message: "No active delivery handover code for this order",
        });
      }

      if (order.deliveryHandoverVerifiedAt) {
        return res.status(400).json({
          success: false,
          message: "Delivery handover was already verified",
        });
      }

      if (order.deliveryHandoverWrongAttempts >= MAX_WRONG_ATTEMPTS) {
        return res.status(429).json({
          success: false,
          message:
            "Too many incorrect attempts. Contact support or regenerate by updating status.",
        });
      }

      const entered = normalizeCodeInput(code);
      if (entered.length !== 6) {
        return res.status(400).json({
          success: false,
          message: "Enter the 6-digit code",
        });
      }

      let expected;
      try {
        expected = decryptHandoverCode(order.deliveryHandoverCipher);
      } catch (e) {
        console.error("Handover decrypt error:", e.message);
        return res.status(500).json({
          success: false,
          message: "Could not verify code",
        });
      }

      if (!expected || !codesEqualTimingSafe(entered, expected)) {
        await Order.findByIdAndUpdate(orderIdStr, {
          $inc: { deliveryHandoverWrongAttempts: 1 },
        });
        return res.status(400).json({
          success: false,
          message: "Invalid code",
        });
      }

      const driverId = req.driver?.id
        ? new mongoose.Types.ObjectId(req.driver.id)
        : null;

      /** Completing delivery: correct code ⇒ mark delivered (driver gets credit when they verified). */
      const finalizeUpdate = {
        deliveryHandoverVerifiedAt: new Date(),
        deliveryHandoverCipher: null,
        deliveryHandoverWrongAttempts: 0,
        deliveryHandoverVerifiedByDriver: driverId,
        status: "delivered",
        deliveredAt: new Date(),
        deliveredByDriver: driverId,
      };

      if (order.payment?.isCod) {
        finalizeUpdate["payment.status"] = "paid";
        finalizeUpdate["payment.codCollected"] = true;
        finalizeUpdate["payment.paidAt"] = new Date();
      }

      const updatedOrder = await Order.findByIdAndUpdate(
        orderIdStr,
        finalizeUpdate,
        { new: true, runValidators: true },
      ).populate("items.product", "name image");

      if (order.payment?.isCod) {
        await Payment.findOneAndUpdate(
          { order: order._id },
          {
            status: "success",
            codCollected: true,
            collectedAt: new Date(),
          },
        );
      }

      return res.json({
        success: true,
        message: "Code verified — order marked as delivered.",
        data: updatedOrder,
      });
    } catch (error) {
      console.error("Verify delivery handover error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to verify handover code",
        error: error.message,
      });
    }
  },
);

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

    const order = await Order.findById(id)
      .select("+deliveryHandoverCipher")
      .session(session);

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

    if (order.payment.method === "balance" && order.payment.status === "paid") {
      await creditWallet({
        userId: order.user,
        amount: order.grandTotal,
        reason: "refund",
        orderId: order._id,
        session,
      });
      order.payment.status = "refunded";
    } else {
      order.payment.status = "cancelled";
    }

    // Update order status
    order.status = "cancelled";
    order.cancelledAt = new Date();
    order.cancelReason = reason;
    order.deliveryHandoverVerifiedAt = null;
    order.deliveryHandoverVerifiedByDriver = null;
    order.deliveryHandoverCipher = null;
    order.deliveryHandoverGeneratedAt = null;
    order.deliveryHandoverWrongAttempts = 0;

    await order.save({ session });

    // Update payment status
    await Payment.findOneAndUpdate(
      { order: order._id },
      { status: order.payment.method === "balance" ? "refunded" : "cancelled" },
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
