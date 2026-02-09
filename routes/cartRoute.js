const express = require("express");
const router = express.Router();
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const mongoose = require("mongoose");

/* ================= HELPER FUNCTIONS ================= */

/**
 * Calculate cart totals - FIXED VERSION
 */
const calculateCartTotals = (items) => {
  let totalItems = 0;
  let totalQuantity = 0;
  let subtotal = 0;
  let totalDiscount = 0;
  let taxAmount = 0;

  items.forEach((item) => {
    if (item.isActive) {
      totalItems++;
      totalQuantity += item.quantity;

      const itemSubtotal = item.unitPrice * item.quantity;
      subtotal += itemSubtotal;

      // Calculate discount
      if (item.discount > 0 && item.mrp) {
        const discountPerUnit = item.mrp - item.unitPrice;
        totalDiscount += discountPerUnit * item.quantity;
      }

      // Calculate tax
      if (item.tax && item.tax.gstPercent > 0) {
        if (item.tax.inclusive) {
          // Tax is already included in unitPrice
          const taxPerUnit =
            item.unitPrice - item.unitPrice / (1 + item.tax.gstPercent / 100);
          taxAmount += taxPerUnit * item.quantity;
        } else {
          // Tax needs to be added
          const taxPerUnit = (item.unitPrice * item.tax.gstPercent) / 100;
          taxAmount += taxPerUnit * item.quantity;
        }
      }
    }
  });

  // FIX: Check if ANY item has non-inclusive tax
  const hasNonInclusiveTax = items.some(
    (item) => item.tax && !item.tax.inclusive,
  );
  const grandTotal = hasNonInclusiveTax ? subtotal + taxAmount : subtotal;

  return {
    totalItems,
    totalQuantity,
    subtotal: Math.round(subtotal * 100) / 100,
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
  };
};

/**
 * Find variant in product
 */
const findVariant = (product, variantId) => {
  return product.variants.find(
    (v) => v._id.toString() === variantId.toString(),
  );
};

/**
 * Create cart item from product and variant
 */
const createCartItem = (product, variant, quantity) => {
  const itemSubtotal = variant.price * quantity;

  return {
    product: product._id,
    variantId: variant._id,
    productName: product.name,
    image: product.image,
    packSize: variant.packSize,
    packUnit: variant.packUnit,
    unitPrice: variant.price,
    mrp: variant.mrp,
    discount: product.discount || 0,
    tax: product.tax || { gstPercent: 0, inclusive: true },
    quantity,
    subtotal: Math.round(itemSubtotal * 100) / 100,
    seller: {
      sellerId: product.seller.sellerId,
      sellerName: product.seller.sellerName,
    },
    isActive: true,
  };
};

/* ================= GET CART ================= */

/**
 * @route   GET /api/cart
 * @desc    Get user's cart
 * @access  Private
 */
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    let cart = await Cart.findOne({ user: userId, status: "active" })
      .populate("items.product", "name image isActive")
      .lean();

    // Create empty cart response if none exists
    if (!cart) {
      return res.json({
        success: true,
        data: {
          user: userId,
          items: [],
          totalItems: 0,
          totalQuantity: 0,
          subtotal: 0,
          totalDiscount: 0,
          taxAmount: 0,
          grandTotal: 0,
          status: "active",
        },
      });
    }

    res.json({
      success: true,
      data: cart,
    });
  } catch (error) {
    console.error("Get cart error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch cart",
      error: error.message,
    });
  }
});

/* ================= ADD ITEM TO CART ================= */

/**
 * @route   POST /api/cart/add
 * @desc    Add item to cart or update quantity if exists
 * @access  Private
 */
router.post("/add", async (req, res) => {
  try {
    const { userId, productId, variantId, quantity = 1 } = req.body;

    console.log("Add to cart request:", {
      userId,
      productId,
      variantId,
      quantity,
    });

    // Validation
    if (!userId || !productId || !variantId) {
      return res.status(400).json({
        success: false,
        message: "User ID, Product ID, and Variant ID are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(variantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid variant ID format",
      });
    }

    if (quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be at least 1",
      });
    }

    // Get product with variant
    const product = await Product.findById(productId);

    if (!product || !product.isActive) {
      return res.status(404).json({
        success: false,
        message: "Product not found or inactive",
      });
    }

    // Find variant
    const variant = findVariant(product, variantId);

    if (!variant || !variant.isActive) {
      return res.status(404).json({
        success: false,
        message: "Variant not found or inactive",
      });
    }

    // Check stock
    if (variant.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Only ${variant.stock} available`,
      });
    }

    // Find or create cart
    let cart = await Cart.findOne({ user: userId, status: "active" });

    if (!cart) {
      cart = new Cart({
        user: userId,
        items: [],
        status: "active",
      });
    }

    // Check if item already exists in cart
    const existingItemIndex = cart.items.findIndex(
      (item) =>
        item.product.toString() === productId &&
        item.variantId.toString() === variantId.toString(),
    );

    if (existingItemIndex > -1) {
      // Update existing item quantity
      const newQuantity = cart.items[existingItemIndex].quantity + quantity;

      // Check stock for new quantity
      if (variant.stock < newQuantity) {
        return res.status(400).json({
          success: false,
          message: `Cannot add ${quantity} more. Only ${variant.stock} available in stock`,
        });
      }

      cart.items[existingItemIndex].quantity = newQuantity;
      cart.items[existingItemIndex].subtotal =
        Math.round(
          cart.items[existingItemIndex].unitPrice * newQuantity * 100,
        ) / 100;
    } else {
      // Add new item
      const newItem = createCartItem(product, variant, quantity);
      cart.items.push(newItem);
    }

    // Recalculate totals
    const totals = calculateCartTotals(cart.items);
    Object.assign(cart, totals);

    cart.lastValidatedAt = new Date();

    await cart.save();

    // Populate product details
    await cart.populate("items.product", "name image isActive");

    res.json({
      success: true,
      message: "Item added to cart successfully",
      data: cart,
    });
  } catch (error) {
    console.error("Add to cart error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add item to cart",
      error: error.message,
    });
  }
});

/* ================= UPDATE CART ITEM QUANTITY ================= */

/**
 * @route   PUT /api/cart/update
 * @desc    Update item quantity in cart
 * @access  Private
 */
router.put("/update", async (req, res) => {
  try {
    const { userId, productId, variantId, quantity } = req.body;

    // Validation
    if (!userId || !productId || !variantId || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: "User ID, Product ID, Variant ID, and Quantity are required",
      });
    }

    if (quantity < 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity cannot be negative",
      });
    }

    // Find cart
    const cart = await Cart.findOne({ user: userId, status: "active" });
    console.log("BABABBA", cart);
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    if (
      !mongoose.Types.ObjectId.isValid(productId) ||
      !mongoose.Types.ObjectId.isValid(variantId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid productId or variantId",
      });
    }

    const itemIndex = cart.items.findIndex((item) => {
      return (
        item.product.toString() === productId.toString() &&
        item.variantId.toString() === variantId.toString()
      );
    });

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart",
      });
    }

    // If quantity is 0, remove item
    if (quantity === 0) {
      cart.items.splice(itemIndex, 1);
    } else {
      // Verify stock availability
      const product = await Product.findById(productId);
      const variant = findVariant(product, variantId);

      if (!variant || variant.stock < quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock. Only ${variant?.stock || 0} available`,
        });
      }

      // Update quantity
      cart.items[itemIndex].quantity = quantity;
      cart.items[itemIndex].subtotal =
        Math.round(cart.items[itemIndex].unitPrice * quantity * 100) / 100;
    }

    // If cart is empty after update, delete it
    if (cart.items.length === 0) {
      await Cart.findByIdAndDelete(cart._id);
      return res.json({
        success: true,
        message: "Cart is now empty",
        data: {
          user: userId,
          items: [],
          totalItems: 0,
          totalQuantity: 0,
          subtotal: 0,
          totalDiscount: 0,
          taxAmount: 0,
          grandTotal: 0,
        },
      });
    }

    // Recalculate totals
    const totals = calculateCartTotals(cart.items);
    Object.assign(cart, totals);

    cart.lastValidatedAt = new Date();

    await cart.save();
    await cart.populate("items.product", "name image isActive");

    res.json({
      success: true,
      message: "Cart updated successfully",
      data: cart,
    });
  } catch (error) {
    console.error("Update cart error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update cart",
      error: error.message,
    });
  }
});

/* ================= REMOVE ITEM FROM CART ================= */

/**
 * @route   DELETE /api/cart/remove
 * @desc    Remove item from cart
 * @access  Private
 */
router.delete("/remove", async (req, res) => {
  try {
    const { userId, productId, variantId } = req.body;

    // Basic validation
    if (!userId || !productId || !variantId) {
      return res.status(400).json({
        success: false,
        message: "User ID, Product ID, and Variant ID are required",
      });
    }

    // ObjectId validation (important)
    if (
      !mongoose.Types.ObjectId.isValid(productId) ||
      !mongoose.Types.ObjectId.isValid(variantId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid productId or variantId",
      });
    }

    const cart = await Cart.findOne({ user: userId, status: "active" });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    const initialLength = cart.items.length;

    // ✅ SAFE FILTER
    cart.items = cart.items.filter((item) => {
      return !(
        item.product.toString() === productId.toString() &&
        item.variantId.toString() === variantId.toString()
      );
    });

    // Item not found
    if (cart.items.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart",
      });
    }

    // Cart empty → delete cart
    if (cart.items.length === 0) {
      await Cart.findByIdAndDelete(cart._id);
      return res.json({
        success: true,
        message: "Item removed. Cart is now empty",
        data: {
          user: userId,
          items: [],
          totalItems: 0,
          totalQuantity: 0,
          subtotal: 0,
          totalDiscount: 0,
          taxAmount: 0,
          grandTotal: 0,
        },
      });
    }

    // Recalculate totals
    const totals = calculateCartTotals(cart.items);
    Object.assign(cart, totals);

    cart.lastValidatedAt = new Date();

    await cart.save();
    await cart.populate("items.product", "name image isActive");

    res.json({
      success: true,
      message: "Item removed from cart",
      data: cart,
    });
  } catch (error) {
    console.error("Remove from cart error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to remove item from cart",
      error: error.message,
    });
  }
});

/* ================= CLEAR CART ================= */

/**
 * @route   DELETE /api/cart/clear
 * @desc    Clear all items from cart
 * @access  Private
 */
router.delete("/clear", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // ✅ ObjectId validation
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId",
      });
    }

    const cart = await Cart.findOne({ user: userId, status: "active" });

    // Cart already empty
    if (!cart) {
      return res.json({
        success: true,
        message: "Cart is already empty",
        data: {
          user: userId,
          items: [],
          totalItems: 0,
          totalQuantity: 0,
          subtotal: 0,
          totalDiscount: 0,
          taxAmount: 0,
          grandTotal: 0,
        },
      });
    }

    await Cart.findByIdAndDelete(cart._id);

    res.json({
      success: true,
      message: "Cart cleared successfully",
      data: {
        user: userId,
        items: [],
        totalItems: 0,
        totalQuantity: 0,
        subtotal: 0,
        totalDiscount: 0,
        taxAmount: 0,
        grandTotal: 0,
      },
    });
  } catch (error) {
    console.error("Clear cart error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to clear cart",
      error: error.message,
    });
  }
});

/* ================= VALIDATE CART ================= */

/**
 * @route   POST /api/cart/validate
 * @desc    Validate cart items against current product data
 * @access  Private
 */
router.post("/validate", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const cart = await Cart.findOne({ user: userId, status: "active" });

    if (!cart || cart.items.length === 0) {
      return res.json({
        success: true,
        message: "Cart is empty",
        data: { isValid: true, issues: [] },
      });
    }

    const issues = [];
    const validItems = [];

    // Validate each item
    for (const item of cart.items) {
      const product = await Product.findById(item.product);

      if (!product || !product.isActive) {
        issues.push({
          productId: item.product,
          productName: item.productName,
          issue: "Product no longer available",
        });
        continue;
      }

      const variant = findVariant(product, item.variantId);

      if (!variant || !variant.isActive) {
        issues.push({
          productId: item.product,
          productName: item.productName,
          issue: "Variant no longer available",
        });
        continue;
      }

      // Check stock
      if (variant.stock < item.quantity) {
        issues.push({
          productId: item.product,
          productName: item.productName,
          issue: `Insufficient stock. Only ${variant.stock} available, you have ${item.quantity} in cart`,
          availableStock: variant.stock,
        });
      }

      // Check price changes
      if (variant.price !== item.unitPrice) {
        issues.push({
          productId: item.product,
          productName: item.productName,
          issue: `Price changed from ₹${item.unitPrice} to ₹${variant.price}`,
          oldPrice: item.unitPrice,
          newPrice: variant.price,
        });

        // Update price in cart
        item.unitPrice = variant.price;
        item.mrp = variant.mrp;
        item.subtotal = Math.round(variant.price * item.quantity * 100) / 100;
      }

      validItems.push(item);
    }

    // Update cart with valid items only
    cart.items = validItems;

    if (validItems.length === 0) {
      await Cart.findByIdAndDelete(cart._id);
      return res.json({
        success: true,
        message: "Cart cleared due to validation issues",
        data: {
          isValid: false,
          issues,
        },
      });
    }

    // Recalculate totals
    const totals = calculateCartTotals(cart.items);
    Object.assign(cart, totals);

    cart.lastValidatedAt = new Date();

    await cart.save();
    await cart.populate("items.product", "name image isActive");

    res.json({
      success: true,
      message:
        issues.length > 0 ? "Cart validated with issues" : "Cart is valid",
      data: {
        isValid: issues.length === 0,
        issues,
        cart,
      },
    });
  } catch (error) {
    console.error("Validate cart error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate cart",
      error: error.message,
    });
  }
});

/* ================= GET CART SUMMARY ================= */

/**
 * @route   GET /api/cart/summary
 * @desc    Get cart summary (totals only, no item details)
 * @access  Private
 */
router.get("/summary", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const cart = await Cart.findOne({ user: userId, status: "active" }).select(
      "totalItems totalQuantity subtotal totalDiscount taxAmount grandTotal",
    );

    const summary = cart || {
      totalItems: 0,
      totalQuantity: 0,
      subtotal: 0,
      totalDiscount: 0,
      taxAmount: 0,
      grandTotal: 0,
    };

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error("Get cart summary error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch cart summary",
      error: error.message,
    });
  }
});

module.exports = router;
