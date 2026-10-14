const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const router = express.Router();
const Seller = require("../models/Seller");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Orders");
const Driver = require("../models/Driver");
const Category = require("../models/Category");
const SellerLedger = require("../models/SellerLedger");
const {
  settleUnsettledPaidOrders,
  getCommissionSettings,
  rateForSeller,
  splitGross,
  reverseOrderCommission,
} = require("../utils/commission");
const {
  generateHandoverCode,
  encryptHandoverCode,
} = require("../utils/deliveryHandover");

async function findSellerAccount(query) {
  const sellerId = query.sellerId || query.id;
  const userId = query.userId;
  if (sellerId && mongoose.Types.ObjectId.isValid(sellerId)) {
    return Seller.findOne({ _id: sellerId });
  }
  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    return Seller.findOne({ user: userId });
  }
  return null;
}

function phoneVariants(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (last10.length !== 10) return [];
  return [last10, `+91${last10}`, `91${last10}`];
}

router.post("/register", async (req, res) => {
  try {
    const { userId, name, phone, email, city, area, password } = req.body;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Valid user is required" });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Shop name is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!password || String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters. You will use it after admin approval.",
      });
    }
    const passwordHash = await bcrypt.hash(String(password), 10);

    const existing = await Seller.findOne({ user: userId }).select("+passwordHash");
    if (existing) {
      if (!existing.passwordHash) {
        existing.passwordHash = passwordHash;
        await existing.save();
      }
      const data = existing.toObject();
      delete data.passwordHash;
      return res.json({ success: true, data, message: "Seller profile already exists" });
    }

    const seller = await Seller.create({
      user: userId,
      name: String(name).trim(),
      phone: phone || user.phone,
      email,
      location: { city, area },
      status: "pending",
      isActive: false,
      passwordHash,
    });

    const data = seller.toObject();
    delete data.passwordHash;

    res.status(201).json({
      success: true,
      message: "Seller request sent. An admin will approve it. You can sign in to the seller panel only after approval.",
      data,
    });
  } catch (error) {
    console.error("Register seller error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to register seller",
      error: error.message,
    });
  }
});

router.get("/me", async (req, res) => {
  try {
    const seller = await findSellerAccount(req.query);
    if (!seller) {
      return res.status(400).json({ success: false, message: "Seller account is required" });
    }
    const fresh = await Seller.findById(seller._id).select("+passwordHash").lean();
    if (fresh) {
      fresh.hasPassword = Boolean(fresh.passwordHash);
      delete fresh.passwordHash;
    }
    res.json({ success: true, data: fresh });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch seller" });
  }
});

router.get("/me/products", async (req, res) => {
  try {
    const seller = await findSellerAccount(req.query);
    if (!seller) {
      return res.json({ success: true, data: [] });
    }
    const products = await Product.find({ "seller.sellerId": seller._id })
      .populate("category", "name")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: products });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch seller products" });
  }
});

router.put("/me/products/:id", async (req, res) => {
  try {
    const seller = await findSellerAccount(req.body);
    if (!seller || seller.status !== "approved") {
      return res.status(403).json({ success: false, message: "Approved seller only" });
    }
    const product = await Product.findOne({
      _id: req.params.id,
      "seller.sellerId": seller._id,
    });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const editingDetails = req.body.name !== undefined || Array.isArray(req.body.variants);
    if (!editingDetails) {
      if (typeof req.body.isActive === "boolean") product.isActive = req.body.isActive;
      if (req.body.stock !== undefined && product.variants?.[0]) {
        product.variants[0].stock = Number(req.body.stock);
      }
      await product.save();
      return res.json({ success: true, data: product, message: "Product updated" });
    }

    if (!String(req.body.name || "").trim()) {
      return res.status(400).json({ success: false, message: "Product name is required" });
    }
    if (!req.body.category || !mongoose.Types.ObjectId.isValid(req.body.category)) {
      return res.status(400).json({ success: false, message: "Category is required" });
    }
    if (!Array.isArray(req.body.variants) || req.body.variants.length === 0) {
      return res.status(400).json({ success: false, message: "At least one variant is required" });
    }

    const variants = req.body.variants.map((variant) => ({
      ...variant,
      image: typeof variant.image === "string" ? variant.image.trim() : "",
    }));
    const defaults = variants.filter((variant) => variant.isDefault);
    if (defaults.length > 1) {
      return res.status(400).json({ success: false, message: "Only one variant can be set as default" });
    }
    if (defaults.length === 0) variants[0].isDefault = true;

    if (req.body.name !== product.name) {
      let slug = String(req.body.name)
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const conflict = await Product.findOne({ slug, _id: { $ne: product._id } });
      product.slug = conflict ? `${slug}-${Date.now()}` : slug;
    }

    let offerEndsAt = product.offerEndsAt;
    if (Object.prototype.hasOwnProperty.call(req.body, "offerEndsAt")) {
      if (req.body.offerEndsAt === null || req.body.offerEndsAt === "") {
        offerEndsAt = null;
      } else {
        const parsed = new Date(req.body.offerEndsAt);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ success: false, message: "Invalid offer end date" });
        }
        offerEndsAt = parsed;
      }
    }

    product.name = String(req.body.name).trim();
    product.description = req.body.description ?? product.description;
    product.brand = req.body.brand ?? product.brand;
    product.category = req.body.category;
    product.unit = req.body.unit || product.unit;
    product.image = req.body.image || variants.find((variant) => variant.image)?.image || "";
    product.images = Array.isArray(req.body.images) ? req.body.images : product.images;
    product.isOrganic = Boolean(req.body.isOrganic);
    if (typeof req.body.isActive === "boolean") product.isActive = req.body.isActive;
    product.offerEndsAt = offerEndsAt;
    product.discount = Number(req.body.discount) || 0;
    if (req.body.tax) product.tax = req.body.tax;
    product.tags = Array.isArray(req.body.tags) ? req.body.tags : product.tags;
    product.searchKeywords = Array.isArray(req.body.searchKeywords)
      ? req.body.searchKeywords
      : product.searchKeywords;
    if (req.body.shelfLife) product.shelfLife = req.body.shelfLife;
    if (typeof req.body.expiryRequired === "boolean") product.expiryRequired = req.body.expiryRequired;
    product.storageInstructions = req.body.storageInstructions ?? product.storageInstructions;
    product.variants = variants;
    product.seller.sellerId = seller._id;
    product.seller.sellerName = seller.name;

    await product.save();
    res.json({ success: true, data: product, message: "Product updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "Failed to update product" });
  }
});

router.get("/me/categories", async (req, res) => {
  try {
    const seller = await findSellerAccount(req.query);
    if (!seller) return res.json({ success: true, data: [] });
    const categories = await Category.find({ createdBySeller: seller._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load categories" });
  }
});

router.post("/me/categories", async (req, res) => {
  try {
    const seller = await findSellerAccount(req.body);
    if (!seller || seller.status !== "approved") {
      return res.status(403).json({ success: false, message: "Approved seller only" });
    }
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Category name is required" });
    let slug = name.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
    if (await Category.findOne({ slug })) slug = `${slug}-${Date.now()}`;
    const category = await Category.create({
      name,
      slug,
      image: req.body.image || "",
      sortOrder: 0,
      showOnHome: false,
      isActive: false,
      approvalStatus: "pending",
      createdBySeller: seller._id,
    });
    res.status(201).json({
      success: true,
      message: "Category sent to admin for approval",
      data: category,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "This category name already exists" });
    }
    res.status(500).json({ success: false, message: "Failed to add category" });
  }
});

router.get("/me/staff", async (req, res) => {
  try {
    const seller = await findSellerAccount(req.query);
    if (!seller || seller.status !== "approved") {
      return res.status(403).json({ success: false, message: "Approved seller only" });
    }
    const staff = await Driver.find({ isActive: true }).select("name phone").sort({ name: 1 }).lean();
    res.json({ success: true, data: staff });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load staff" });
  }
});

router.get("/me/dashboard", async (req, res) => {
  try {
    const seller = await findSellerAccount(req.query);
    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found" });
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    await settleUnsettledPaidOrders({ "items.seller.sellerId": seller._id });
    const settings = await getCommissionSettings();
    const commissionPercent = rateForSeller(seller, settings.defaultCommissionPercent);
    const [products, orders, categories, ledger] = await Promise.all([
      Product.find({ "seller.sellerId": seller._id }).select("isActive").lean(),
      Order.find({ "items.seller.sellerId": seller._id })
        .select("status items payment createdAt")
        .lean(),
      Category.countDocuments({ createdBySeller: seller._id, approvalStatus: "pending" }),
      SellerLedger.find({ seller: seller._id, status: "credited" }).lean(),
    ]);
    const openStatuses = ["placed", "confirmed", "packed", "shipped", "out_for_delivery"];
    let todayOrders = 0;
    let pendingOrders = 0;
    for (const order of orders) {
      if (new Date(order.createdAt) >= today) todayOrders += 1;
      if (openStatuses.includes(order.status)) pendingOrders += 1;
    }
    let grossSales = 0;
    let commissionAmount = 0;
    let sellerEarnings = 0;
    let monthlyEarnings = 0;
    for (const row of ledger) {
      grossSales += Number(row.gross) || 0;
      commissionAmount += Number(row.commissionAmount) || 0;
      sellerEarnings += Number(row.sellerAmount) || 0;
      if (new Date(row.paidAt || row.createdAt) >= startOfMonth) {
        monthlyEarnings += Number(row.sellerAmount) || 0;
      }
    }
    res.json({
      success: true,
      data: {
        totalOrders: orders.length,
        totalRevenue: sellerEarnings,
        grossSales,
        commissionAmount,
        sellerEarnings,
        commissionPercent,
        totalProducts: products.filter((item) => item.isActive).length,
        totalCategories: categories,
        todayOrders,
        pendingOrders,
        pendingPayments: 0,
        monthlyRevenue: monthlyEarnings,
        monthlyEarnings,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load dashboard" });
  }
});

router.get("/me/earnings", async (req, res) => {
  try {
    const seller = await findSellerAccount(req.query);
    if (!seller) return res.json({ success: true, data: [] });
    await settleUnsettledPaidOrders({ "items.seller.sellerId": seller._id });
    const rows = await SellerLedger.find({ seller: seller._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load earnings" });
  }
});

router.get("/me/orders", async (req, res) => {
  try {
    const seller = await findSellerAccount(req.query);
    if (!seller) {
      return res.json({ success: true, data: [] });
    }
    const filter = { "items.seller.sellerId": seller._id };
    if (req.query.status) filter.status = req.query.status;
    await settleUnsettledPaidOrders({ "items.seller.sellerId": seller._id });
    const settings = await getCommissionSettings();
    const commissionPercent = rateForSeller(seller, settings.defaultCommissionPercent);
    const orders = await Order.find(filter)
      .populate("user", "name phone")
      .populate("assignedDriver", "name phone")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    const sellerId = String(seller._id);
    const data = orders.map((order) => {
      const settlement = (order.settlements || []).find(
        (row) => String(row.sellerId) === sellerId,
      );
      const ownItems = (order.items || []).filter(
        (item) => String(item.seller?.sellerId) === sellerId,
      );
      const gross = ownItems.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
      const split =
        settlement && order.commissionSettled && !order.commissionReversed
          ? settlement
          : splitGross(gross, commissionPercent);
      return {
        ...order,
        sellerShare: {
          gross: split.gross,
          commissionPercent: split.commissionPercent,
          commissionAmount: split.commissionAmount,
          sellerAmount: split.sellerAmount,
          credited: Boolean(order.commissionSettled && !order.commissionReversed && order.payment?.status === "paid"),
        },
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load orders" });
  }
});

router.put("/me/orders/:id/assign", async (req, res) => {
  try {
    const seller = await findSellerAccount(req.body);
    if (!seller || seller.status !== "approved") {
      return res.status(403).json({ success: false, message: "Approved seller only" });
    }
    const { driverId } = req.body;
    if (!driverId || !mongoose.Types.ObjectId.isValid(driverId)) {
      return res.status(400).json({ success: false, message: "Choose a staff member" });
    }
    const driver = await Driver.findOne({ _id: driverId, isActive: true });
    if (!driver) {
      return res.status(404).json({ success: false, message: "Staff member is not active" });
    }
    const order = await Order.findOne({
      _id: req.params.id,
      "items.seller.sellerId": seller._id,
    });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (["delivered", "cancelled", "returned"].includes(order.status)) {
      return res.status(400).json({ success: false, message: "This order is already closed" });
    }
    order.assignedDriver = driver._id;
    await order.save();
    res.json({ success: true, message: `Assigned to ${driver.name || "staff"}` });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to assign staff" });
  }
});

router.put("/me/orders/:id/status", async (req, res) => {
  try {
    const seller = await findSellerAccount(req.body);
    if (!seller || seller.status !== "approved") {
      return res.status(403).json({ success: false, message: "Approved seller only" });
    }
    const { status } = req.body;
    const validStatuses = ["confirmed", "packed", "shipped", "out_for_delivery", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const order = await Order.findOne({
      _id: req.params.id,
      "items.seller.sellerId": seller._id,
    }).select("+deliveryHandoverCipher");
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (["delivered", "cancelled", "returned"].includes(order.status)) {
      return res.status(400).json({ success: false, message: `Cannot change a ${order.status} order` });
    }
    if (status === "out_for_delivery" && !order.assignedDriver) {
      return res.status(400).json({
        success: false,
        message: "Assign a staff member before sending this order out for delivery",
      });
    }

    const prevStatus = order.status;
    const updateData = { status };
    let handoverPlain = null;
    if (status === "out_for_delivery" && prevStatus !== "out_for_delivery") {
      handoverPlain = generateHandoverCode();
      updateData.deliveryHandoverCipher = encryptHandoverCode(handoverPlain);
      updateData.deliveryHandoverGeneratedAt = new Date();
      updateData.deliveryHandoverWrongAttempts = 0;
      updateData.deliveryHandoverVerifiedAt = null;
      updateData.deliveryHandoverVerifiedByDriver = null;
    }
    if (status === "cancelled") {
      updateData.cancelledAt = new Date();
      updateData.cancelReason = "Cancelled by seller";
    }

    const updated = await Order.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (status === "cancelled" && order.payment?.status === "paid") {
      await reverseOrderCommission(order._id);
    }
    res.json({ success: true, message: `Order marked ${status.replace(/_/g, " ")}`, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update order" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { phone, password } = req.body;
    const variants = phoneVariants(phone);
    if (!variants.length || !password) {
      return res.status(400).json({
        success: false,
        message: "Phone and password are required",
      });
    }

    const seller = await Seller.findOne({ phone: { $in: variants } }).select("+passwordHash");
    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "No seller account for this phone. Apply from the Vadi app first.",
      });
    }
    if (seller.status !== "approved" || !seller.isActive) {
      return res.status(403).json({
        success: false,
        message:
          seller.status === "rejected"
            ? "This seller request was rejected. You cannot sign in."
            : "Admin has not approved your shop yet. You can sign in only after approval.",
      });
    }
    if (!seller.passwordHash) {
      return res.status(400).json({
        success: false,
        message: "Set a password from the Vadi app seller screen, then sign in.",
      });
    }
    const ok = await bcrypt.compare(String(password), seller.passwordHash);
    if (!ok) {
      return res.status(401).json({ success: false, message: "Wrong password" });
    }

    const token = jwt.sign(
      { id: seller._id, userId: seller.user, role: "seller" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      success: true,
      token,
      seller: {
        id: seller._id,
        userId: seller.user,
        name: seller.name,
        phone: seller.phone,
        email: seller.email,
      },
    });
  } catch (error) {
    console.error("Seller login error:", error);
    res.status(500).json({ success: false, message: "Failed to sign in" });
  }
});

router.put("/me", async (req, res) => {
  try {
    const { name, email, city, area, phone } = req.body;
    const seller = await findSellerAccount(req.body);
    if (seller && seller.status !== "approved") {
      return res.status(403).json({ success: false, message: "Approved seller only" });
    }
    if (!seller) {
      return res.status(400).json({ success: false, message: "Seller account is required" });
    }
    if (name) seller.name = String(name).trim();
    if (email !== undefined) seller.email = email;
    if (phone) seller.phone = phone;
    seller.location = {
      city: city ?? seller.location?.city,
      area: area ?? seller.location?.area,
    };
    await seller.save();
    res.json({ success: true, data: seller, message: "Shop details saved" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update shop" });
  }
});

router.get("/", async (req, res) => {
  try {
    const { isActive, search, page, limit, sortBy = "name", sortOrder = "asc" } =
      req.query;

    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }

    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    let query = Seller.find(filter).sort(sort);

    if (page && limit) {
      const skip = (Number(page) - 1) * Number(limit);
      query = query.skip(skip).limit(Number(limit));
    }

    const sellers = await query.lean();
    let pagination = null;

    if (page && limit) {
      const total = await Seller.countDocuments(filter);
      pagination = {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      };
    }

    res.json({
      success: true,
      data: sellers,
      ...(pagination && { pagination }),
    });
  } catch (error) {
    console.error("Get sellers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch sellers",
      error: error.message,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid seller ID format" });
    }

    const seller = await Seller.findById(id).lean();
    if (!seller) {
      return res
        .status(404)
        .json({ success: false, message: "Seller not found" });
    }

    res.json({ success: true, data: seller });
  } catch (error) {
    console.error("Get seller by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch seller",
      error: error.message,
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, code, phone, email, location, isActive, password, city, area } = req.body;

    if (!name || !String(name).trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Seller name is required" });
    }
    if (!phone || phoneVariants(phone).length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "A valid 10-digit phone is required" });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters so the seller can sign in",
      });
    }

    const variants = phoneVariants(phone);
    const taken = await Seller.findOne({ phone: { $in: variants } }).lean();
    if (taken) {
      return res.status(400).json({
        success: false,
        message: "A seller with this phone already exists",
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const seller = new Seller({
      name: String(name).trim(),
      code,
      phone: variants[0],
      email,
      location: location || { city, area },
      isActive: isActive !== false,
      status: "approved",
      passwordHash,
    });
    await seller.save();

    const data = seller.toObject();
    delete data.passwordHash;

    res.status(201).json({
      success: true,
      message: "Seller created successfully",
      data,
    });
  } catch (error) {
    console.error("Create seller error:", error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Seller code already exists",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to create seller",
      error: error.message,
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid seller ID format" });
    }

    const seller = await Seller.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!seller) {
      return res
        .status(404)
        .json({ success: false, message: "Seller not found" });
    }

    res.json({
      success: true,
      message: "Seller updated successfully",
      data: seller,
    });
  } catch (error) {
    console.error("Update seller error:", error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Seller code already exists",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to update seller",
      error: error.message,
    });
  }
});

module.exports = router;
