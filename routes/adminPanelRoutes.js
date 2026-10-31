const express = require("express");
const mongoose = require("mongoose");
const adminAuth = require("../middleware/adminMiddleware");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Seller = require("../models/Seller");
const Order = require("../models/Orders");
const { reopenDeliveredOrder } = require("../utils/orderCorrections");
const Payment = require("../models/Payment");
const User = require("../models/User");
const { decryptHandoverCode } = require("../utils/deliveryHandover");
const SellerLedger = require("../models/SellerLedger");
const {
  getCommissionSettings,
  settleUnsettledPaidOrders,
} = require("../utils/commission");
const { readFeeSettings, DRIVER_FEE_MODES } = require("../utils/deliveryQuote");
const { creditWallet } = require("../utils/wallet");
const { reverseOrderCommission } = require("../utils/commission");
const { quoteReturn, resolveOrderReturn } = require("../utils/orderReturns");
const { notifyOrderStatus } = require("../utils/orderNotify");
const SellerPayout = require("../models/SellerPayout");
const SupportMessage = require("../models/SupportMessage");

const productRoutes = require("./productRoutes");
const categoryRoutes = require("./categoryRoutes");
const sellerRoutes = require("./sellerRoutes");
const orderRoutes = require("./orderRoute");
const paymentRoutes = require("./paymentRoute");
const dealSettingsRoutes = require("./dealSettingsRoutes");
const homeSectionSettingsRoutes = require("./homeSectionSettingsRoutes");
const appThemeRoutes = require("./appThemeRoutes");

const router = express.Router();

function forward(target, path) {
  return (req, res, next) => {
    const qIndex = req.url.indexOf("?");
    const query = qIndex >= 0 ? req.url.slice(qIndex) : "";
    req.url = `${path}${query}`;
    target.handle(req, res, next);
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function boolQuery(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return undefined;
}

function paginationOf(page, limit, total) {
  return {
    page: Number(page),
    limit: Number(limit),
    total,
    pages: Math.max(1, Math.ceil(total / Number(limit)) || 1),
  };
}

router.use(adminAuth);

/* ================= PRODUCTS ================= */

router.get("/products", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      category,
      seller,
      featured,
      trending,
      bestDeal,
      isActive,
      approvalStatus,
      minPrice,
      maxPrice,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const filter = {};
    const active = boolQuery(isActive);
    if (active !== undefined) filter.isActive = active;
    if (category && mongoose.Types.ObjectId.isValid(category)) {
      filter.category = category;
    }
    if (seller && mongoose.Types.ObjectId.isValid(seller)) {
      filter["seller.sellerId"] = seller;
    }
    if (["pending", "approved", "rejected"].includes(approvalStatus)) {
      filter.approvalStatus = approvalStatus;
    }

    const featuredFlag = boolQuery(featured);
    const trendingFlag = boolQuery(trending);
    const bestDealFlag = boolQuery(bestDeal);
    if (featuredFlag !== undefined) filter.featured = featuredFlag;
    if (trendingFlag !== undefined) filter.trending = trendingFlag;
    if (bestDealFlag !== undefined) filter.bestDeal = bestDealFlag;

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      filter.$or = [
        { name: regex },
        { description: regex },
        { brand: regex },
        { tags: { $in: [regex] } },
        { searchKeywords: { $in: [regex] } },
      ];
    }

    if (minPrice || maxPrice) {
      const priceFilter = {};
      if (minPrice) priceFilter.$gte = Number(minPrice);
      if (maxPrice) priceFilter.$lte = Number(maxPrice);
      filter["variants.price"] = priceFilter;
    }

    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    const skip = (Number(page) - 1) * Number(limit);

    const [products, total] = await Promise.all([
      Product.find(filter)
        .populate("category", "name slug")
        .populate("seller.sellerId", "name code")
        .sort(sort)
        .limit(Number(limit))
        .skip(skip)
        .lean(),
      Product.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: products,
      pagination: paginationOf(page, limit, total),
    });
  } catch (error) {
    console.error("Admin get products error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
      error: error.message,
    });
  }
});

router.get("/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid product ID format" });
    }

    const product = await Product.findById(id)
      .populate("category", "name slug")
      .populate("seller.sellerId", "name code")
      .lean();

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.json({ success: true, data: product });
  } catch (error) {
    console.error("Admin get product error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch product",
      error: error.message,
    });
  }
});

router.post("/products", forward(productRoutes, "/"));
router.put("/products/:id", (req, res, next) =>
  forward(productRoutes, `/${req.params.id}`)(req, res, next),
);
router.delete("/products/:id", (req, res, next) =>
  forward(productRoutes, `/${req.params.id}`)(req, res, next),
);

/* ================= CATEGORIES ================= */

router.get("/categories", async (req, res) => {
  try {
    const {
      isActive,
      showOnHome,
      search,
      page,
      limit,
      sortBy = "sortOrder",
      sortOrder = "asc",
    } = req.query;

    const filter = {};
    const active = boolQuery(isActive);
    const home = boolQuery(showOnHome);
    if (active !== undefined) filter.isActive = active;
    if (home !== undefined) filter.showOnHome = home;
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      filter.$or = [
        { name: regex },
        { slug: regex },
      ];
    }

    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    let query = Category.find(filter).sort(sort);

    if (page && limit) {
      const skip = (Number(page) - 1) * Number(limit);
      query = query.skip(skip).limit(Number(limit));
    }

    const categories = await query.lean();
    let pagination = null;
    if (page && limit) {
      const total = await Category.countDocuments(filter);
      pagination = paginationOf(page, limit, total);
    }

    res.json({
      success: true,
      data: categories,
      ...(pagination && { pagination }),
    });
  } catch (error) {
    console.error("Admin get categories error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      error: error.message,
    });
  }
});

router.get("/categories/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid category ID format" });
    }

    const category = await Category.findById(id).lean();
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const productCount = await Product.countDocuments({ category: id });
    res.json({ success: true, data: { ...category, productCount } });
  } catch (error) {
    console.error("Admin get category error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch category",
      error: error.message,
    });
  }
});

router.post("/categories", forward(categoryRoutes, "/"));
router.put("/categories/:id/approval", async (req, res) => {
  try {
    const { approvalStatus } = req.body;
    if (!["pending", "approved", "rejected"].includes(approvalStatus)) {
      return res.status(400).json({ success: false, message: "Invalid approval status" });
    }
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ success: false, message: "Category not found" });
    category.approvalStatus = approvalStatus;
    category.isActive = approvalStatus === "approved";
    await category.save();
    res.json({ success: true, message: "Category updated", data: category });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update category" });
  }
});
router.put("/categories/:id", (req, res, next) =>
  forward(categoryRoutes, `/${req.params.id}`)(req, res, next),
);
router.delete("/categories/:id", (req, res, next) =>
  forward(categoryRoutes, `/${req.params.id}`)(req, res, next),
);

/* ================= SELLERS ================= */

router.get("/sellers", forward(sellerRoutes, "/"));
router.post("/sellers", forward(sellerRoutes, "/"));
router.get("/sellers/:id", (req, res, next) =>
  forward(sellerRoutes, `/${req.params.id}`)(req, res, next),
);
router.put("/sellers/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid seller status" });
    }
    const seller = await Seller.findById(id);
    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found" });
    }
    seller.status = status;
    seller.isActive = status === "approved";
    await seller.save();
    if (status === "approved") {
      await Product.updateMany(
        { "seller.sellerId": seller._id, approvalStatus: "pending" },
        { $set: { approvalStatus: "approved", isActive: true } },
      );
    }
    if (seller.user) {
      await User.findByIdAndUpdate(seller.user, {
        role: status === "approved" ? "seller" : "user",
      });
    }
    res.json({ success: true, message: "Seller updated", data: seller });
  } catch (error) {
    console.error("Update seller status error:", error);
    res.status(500).json({ success: false, message: "Failed to update seller" });
  }
});

router.put("/products/:id/approval", async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalStatus } = req.body;
    if (!["pending", "approved", "rejected"].includes(approvalStatus)) {
      return res.status(400).json({ success: false, message: "Invalid approval status" });
    }
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    product.approvalStatus = approvalStatus;
    product.isActive = approvalStatus === "approved";
    await product.save();
    res.json({ success: true, message: "Product approval updated", data: product });
  } catch (error) {
    console.error("Product approval error:", error);
    res.status(500).json({ success: false, message: "Failed to update product" });
  }
});

/* ================= ORDERS ================= */

router.get("/orders", async (req, res) => {
  try {
    const {
      status,
      search,
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const filter = {};
    if (status) filter.status = status;

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      const users = await User.find({
        $or: [{ name: regex }, { phone: regex }, { email: regex }],
      })
        .select("_id")
        .lean();

      filter.$or = [
        { orderNumber: regex },
        { user: { $in: users.map((user) => user._id) } },
      ];
    }

    const pageNumber = Math.max(1, Math.floor(Number(page)) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 10));
    const sortField = ["createdAt", "updatedAt", "orderNumber"].includes(sortBy) ? sortBy : "createdAt";
    const direction = sortOrder === "asc" ? 1 : -1;
    const sort = { [sortField]: direction, _id: direction };
    const skip = (pageNumber - 1) * pageSize;
    const [orders, total] = await Promise.all([
      Order.find(filter).populate("items.product", "name image").populate("user", "name email phone")
        .sort(sort).skip(skip).limit(pageSize).lean(),
      Order.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: orders,
      pagination: paginationOf(pageNumber, pageSize, total),
    });
  } catch (error) {
    console.error("Admin get orders error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
});

router.get("/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid order ID format" });
    }

    const order = await Order.findById(id)
      .select("+deliveryHandoverCipher")
      .populate("items.product", "name image")
      .populate("user", "name email phone");

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const orderPayload = order.toObject();
    if (
      order.status === "out_for_delivery" &&
      !order.deliveryHandoverVerifiedAt &&
      order.deliveryHandoverCipher
    ) {
      try {
        const code = decryptHandoverCode(order.deliveryHandoverCipher);
        if (code) orderPayload.deliveryHandoverCode = code;
      } catch (error) {
        console.error("Admin decrypt handover code error:", error.message);
      }
    }
    delete orderPayload.deliveryHandoverCipher;

    const payment = await Payment.findOne({ order: order._id }).lean();
    res.json({ success: true, data: { order: orderPayload, payment } });
  } catch (error) {
    console.error("Admin get order error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch order",
      error: error.message,
    });
  }
});

router.post("/orders/:id/reopen", async (req, res) => {
  try {
    const updated = await reopenDeliveredOrder({ ...req.body, id: req.params.id, adminId: req.auth?.id || req.admin?.id });
    try { await notifyOrderStatus(updated, updated.status); }
    catch (error) { console.error("Reopen notification failed:", error.message); }
    res.json({ success: true, message: "Order reopened. Payment and delivery details have been updated.", data: updated });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || "Could not reopen order" });
  }
});

router.put("/orders/:id/status", (req, res, next) =>
  forward(orderRoutes, `/${req.params.id}/status`)(req, res, next),
);
router.post("/orders/:id/cancel", (req, res, next) =>
  forward(orderRoutes, `/${req.params.id}/cancel`)(req, res, next),
);
router.post("/orders/:id/verify-delivery-handover", (req, res, next) =>
  forward(orderRoutes, `/${req.params.id}/verify-delivery-handover`)(req, res, next),
);
router.get("/orders/:id/invoice", (req, res, next) => {
  req.query.isAdmin = "true";
  const qIndex = req.url.indexOf("?");
  const query = qIndex >= 0 ? req.url.slice(qIndex) : "";
  const joiner = query ? "&" : "?";
  req.url = `/${req.params.id}/invoice${query}${joiner}isAdmin=true`;
  orderRoutes.handle(req, res, next);
});

/* ================= PAYMENTS ================= */

router.get("/payments", async (req, res) => {
  try {
    const {
      status,
      method,
      search,
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (method) filter.method = method;

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      const [users, orders] = await Promise.all([
        User.find({
          $or: [{ name: regex }, { phone: regex }, { email: regex }],
        })
          .select("_id")
          .lean(),
        Order.find({ orderNumber: regex }).select("_id").lean(),
      ]);
      filter.$or = [
        { user: { $in: users.map((user) => user._id) } },
        { order: { $in: orders.map((order) => order._id) } },
      ];
    }

    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    const skip = (Number(page) - 1) * Number(limit);

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .populate("order", "orderNumber status grandTotal")
        .populate("user", "name email phone")
        .sort(sort)
        .limit(Number(limit))
        .skip(skip)
        .lean(),
      Payment.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: payments,
      pagination: paginationOf(page, limit, total),
    });
  } catch (error) {
    console.error("Admin get payments error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payments",
      error: error.message,
    });
  }
});

router.get("/payments/:id", (req, res, next) =>
  forward(paymentRoutes, `/${req.params.id}`)(req, res, next),
);
router.post("/payments/:id/collect-cod", (req, res, next) =>
  forward(paymentRoutes, `/${req.params.id}/collect-cod`)(req, res, next),
);

/* ================= SETTINGS ================= */

router.get("/commission-settings", async (req, res) => {
  try {
    const settings = await getCommissionSettings();
    res.json({ success: true, data: readFeeSettings(settings) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load commission settings" });
  }
});

router.put("/commission-settings", async (req, res) => {
  try {
    const percent = Number(req.body.defaultCommissionPercent);
    const deliveryFee = Number(req.body.deliveryFee);
    const freeDeliveryAbove = Number(req.body.freeDeliveryAbove);
    const driverFeeValue = Number(req.body.driverFeeValue);
    const driverFeeMode = req.body.driverFeeMode;

    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return res.status(400).json({
        success: false,
        message: "Commission must be a number from 0 to 100",
      });
    }
    if (!Number.isFinite(deliveryFee) || deliveryFee < 0) {
      return res.status(400).json({
        success: false,
        message: "Delivery fee must be 0 or more",
      });
    }
    if (!Number.isFinite(freeDeliveryAbove) || freeDeliveryAbove < 0) {
      return res.status(400).json({
        success: false,
        message: "Free-delivery amount must be 0 or more",
      });
    }
    if (!DRIVER_FEE_MODES.includes(driverFeeMode)) {
      return res.status(400).json({
        success: false,
        message: "Choose how the driver fee is calculated",
      });
    }
    const driverMax = driverFeeMode === "flat" ? Number.POSITIVE_INFINITY : 100;
    if (!Number.isFinite(driverFeeValue) || driverFeeValue < 0 || driverFeeValue > driverMax) {
      return res.status(400).json({
        success: false,
        message:
          driverFeeMode === "flat"
            ? "Driver fee must be 0 or more"
            : "Driver fee percent must be from 0 to 100",
      });
    }

    const settings = await getCommissionSettings();
    settings.defaultCommissionPercent = percent;
    settings.deliveryFee = deliveryFee;
    settings.freeDeliveryAbove = freeDeliveryAbove;
    settings.driverFeeMode = driverFeeMode;
    settings.driverFeeValue = driverFeeValue;
    await settings.save();
    res.json({
      success: true,
      message: "Payment rules updated",
      data: readFeeSettings(settings),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to save commission" });
  }
});

router.put("/sellers/:id/commission", async (req, res) => {
  try {
    const seller = await Seller.findById(req.params.id);
    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found" });
    }
    const raw = req.body.commissionPercent;
    if (raw === null || raw === "" || raw === undefined) {
      seller.commissionPercent = undefined;
      await seller.save();
      await Seller.updateOne({ _id: seller._id }, { $unset: { commissionPercent: "" } });
    } else {
      const percent = Number(raw);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return res.status(400).json({
          success: false,
          message: "Commission must be a number from 0 to 100",
        });
      }
      seller.commissionPercent = percent;
      await seller.save();
    }
    const fresh = await Seller.findById(seller._id).select("commissionPercent").lean();
    res.json({
      success: true,
      message: "Seller commission updated",
      data: { _id: seller._id, commissionPercent: fresh?.commissionPercent ?? null },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update seller commission" });
  }
});

router.get("/commission-report", async (req, res) => {
  try {
    await settleUnsettledPaidOrders();
    const settings = await getCommissionSettings();
    const [sellers, ledger, deliveryOrders] = await Promise.all([
      Seller.find().select("name phone email commissionPercent status").sort({ name: 1 }).lean(),
      SellerLedger.find({ status: "credited" }).lean(),
      Order.find({ "payment.status": "paid", commissionReversed: { $ne: true } })
        .select("deliveryFee driverPayout")
        .lean(),
    ]);

    const bySeller = new Map();
    for (const row of ledger) {
      const id = String(row.seller);
      const current = bySeller.get(id) || {
        gross: 0,
        commission: 0,
        sellerPayout: 0,
        orders: 0,
      };
      current.gross += Number(row.gross) || 0;
      current.commission += Number(row.commissionAmount) || 0;
      current.sellerPayout += Number(row.sellerAmount) || 0;
      current.orders += 1;
      bySeller.set(id, current);
    }

    const rows = sellers.map((seller) => {
      const totals = bySeller.get(String(seller._id)) || {
        gross: 0,
        commission: 0,
        sellerPayout: 0,
        orders: 0,
      };
      const usesDefault =
        seller.commissionPercent === undefined || seller.commissionPercent === null;
      return {
        _id: seller._id,
        name: seller.name,
        phone: seller.phone || "",
        email: seller.email || "",
        status: seller.status,
        commissionPercent: usesDefault ? null : seller.commissionPercent,
        effectivePercent: usesDefault
          ? settings.defaultCommissionPercent
          : seller.commissionPercent,
        ...totals,
      };
    });

    const totals = rows.reduce(
      (sum, row) => ({
        gross: sum.gross + row.gross,
        commission: sum.commission + row.commission,
        sellerPayout: sum.sellerPayout + row.sellerPayout,
        orders: sum.orders + row.orders,
      }),
      { gross: 0, commission: 0, sellerPayout: 0, orders: 0 },
    );
    const deliveryFee = deliveryOrders.reduce((sum, order) => sum + (Number(order.deliveryFee) || 0), 0);
    const driverPayout = deliveryOrders.reduce((sum, order) => sum + (Number(order.driverPayout) || 0), 0);

    res.json({
      success: true,
      data: {
        ...readFeeSettings(settings),
        totals: { ...totals, deliveryFee, driverPayout },
        sellers: rows,
      },
    });
  } catch (error) {
    console.error("Commission report error:", error);
    res.status(500).json({ success: false, message: "Failed to load commission report" });
  }
});

router.get("/deal-settings", forward(dealSettingsRoutes, "/"));
router.put("/deal-settings", forward(dealSettingsRoutes, "/"));
router.get("/home-section-settings", forward(homeSectionSettingsRoutes, "/"));
router.put("/home-section-settings", forward(homeSectionSettingsRoutes, "/"));
router.get("/app-theme", forward(appThemeRoutes, "/"));
router.put("/app-theme", forward(appThemeRoutes, "/"));
router.use("/coupons", require("./couponRoutes").admin);

router.get("/returns", async (req, res) => {
  try {
    const orders = await Order.find({ "returnRequest.status": { $exists: true, $ne: null } })
      .populate("user", "name phone email")
      .sort({ "returnRequest.requestedAt": -1 })
      .limit(100)
      .lean();
    const data = await Promise.all(orders.map(async (order) => {
      try {
        const plan = quoteReturn(order);
        const payment = await Payment.findOne({ order: order._id }).select("status").lean();
        const paid = order.payment?.status === "paid" || payment?.status === "success";
        return { ...order, refundPreview: { amount: paid ? plan.amount : 0, destination: paid && plan.amount > 0 ? (["upi", "card", "wallet"].includes(order.payment?.method) ? "original" : "wallet") : "none", fullRefund: plan.fullRefund } };
      } catch (error) { return { ...order, refundPreview: { error: error.message } }; }
    }));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load returns" });
  }
});

router.put("/returns/:id", async (req, res) => {
  try {
    const result = await resolveOrderReturn({ ...req.body, id: req.params.id, adminId: req.auth?.id || req.admin?.id });
    try { if (!result.processing) await notifyOrderStatus(result.order, "returned"); }
    catch (error) { console.error("Return notification failed:", error.message); }
    res.json({ success: true, message: result.processing ? "Original-payment refund is pending at Razorpay. Use Resume refund to check its status; no wallet credit was issued." : result.action === "reject" ? "Return rejected. No refund or stock change was made."
      : result.refundedTo === "original" ? `Return approved. ₹${result.refundAmount.toFixed(2)} refunded to the original payment method.`
      : result.refundedTo === "wallet" ? `Return approved. ₹${result.refundAmount.toFixed(2)} credited to the customer VADI wallet.`
      : "Return approved. No refund was due; arrange any approved replacement with the customer.", data: result.order });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || "Could not resolve return" });
  }
});

router.get("/payouts", async (req, res) => {
  try {
    const data = await SellerPayout.find()
      .populate("seller", "name phone bank")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load payouts" });
  }
});

router.put("/payouts/:id", async (req, res) => {
  try {
    const payout = await SellerPayout.findById(req.params.id);
    if (!payout || payout.status !== "pending") {
      return res.status(404).json({ success: false, message: "Pending payout not found" });
    }
    const action = req.body?.action;
    if (!["paid", "rejected"].includes(action)) {
      return res.status(400).json({ success: false, message: "Action must be paid or rejected" });
    }
    payout.status = action;
    payout.note = String(req.body?.note || "").trim();
    payout.paidAt = action === "paid" ? new Date() : null;
    await payout.save();
    res.json({ success: true, message: action === "paid" ? "Marked as paid" : "Payout rejected" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update payout" });
  }
});

router.get("/support", async (req, res) => {
  try {
    const data = await SupportMessage.find()
      .populate("user", "name phone")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load support messages" });
  }
});

router.post("/support/:userId", async (req, res) => {
  try {
    const text = String(req.body?.body || "").trim();
    if (!mongoose.Types.ObjectId.isValid(req.params.userId) || text.length < 2) {
      return res.status(400).json({ success: false, message: "Write a reply" });
    }
    const message = await SupportMessage.create({
      user: req.params.userId,
      body: text.slice(0, 1000),
      from: "admin",
    });
    const { notifyUser } = require("../utils/orderNotify");
    await notifyUser({
      userId: req.params.userId,
      title: "Support replied",
      body: text.slice(0, 140),
      kind: "support",
    });
    res.status(201).json({ success: true, data: message });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to reply" });
  }
});

module.exports = router;
