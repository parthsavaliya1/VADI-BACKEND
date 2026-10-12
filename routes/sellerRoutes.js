const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const router = express.Router();
const Seller = require("../models/Seller");
const User = require("../models/User");
const Product = require("../models/Product");

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
    const { userId } = req.query;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Valid userId is required" });
    }
    const seller = await Seller.findOne({ user: userId }).select("+passwordHash").lean();
    if (seller) {
      seller.hasPassword = Boolean(seller.passwordHash);
      delete seller.passwordHash;
    }
    res.json({ success: true, data: seller });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch seller" });
  }
});

router.get("/me/products", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Valid userId is required" });
    }
    const seller = await Seller.findOne({ user: userId }).lean();
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
    const { userId, name, email, city, area, phone } = req.body;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Valid user is required" });
    }
    const seller = await Seller.findOne({ user: userId, status: "approved" });
    if (!seller) {
      return res.status(403).json({ success: false, message: "Approved seller only" });
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
