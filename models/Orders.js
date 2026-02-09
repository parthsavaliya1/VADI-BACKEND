const mongoose = require("mongoose");

/* ================= ORDER ITEM ================= */

const OrderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    /* ===== SNAPSHOT ===== */

    productName: {
      type: String,
      required: true,
    },

    image: String,

    packSize: Number,
    packUnit: String,

    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    mrp: {
      type: Number,
      min: 0,
    },

    discount: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    tax: {
      gstPercent: Number,
      inclusive: Boolean,
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    /* ===== SELLER SNAPSHOT ===== */

    seller: {
      sellerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Seller",
        required: true,
      },
      sellerName: String,
    },
  },
  { _id: false },
);

/* ================= ORDER ================= */

const OrderSchema = new mongoose.Schema(
  {
    /* ================= USER ================= */

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* ================= ITEMS ================= */

    items: {
      type: [OrderItemSchema],
      validate: {
        validator: (v) => v.length > 0,
        message: "Order must contain at least one item",
      },
    },

    /* ================= TOTALS ================= */

    totalItems: {
      type: Number,
      required: true,
      min: 1,
    },

    totalQuantity: {
      type: Number,
      required: true,
      min: 1,
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    totalDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },

    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    deliveryFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    grandTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    /* ================= PAYMENT (COD READY) ================= */

    payment: {
      method: {
        type: String,
        enum: ["cod", "upi", "card", "wallet"],
        required: true,
      },

      status: {
        type: String,
        enum: ["pending", "paid", "failed", "refunded"],
        default: "pending",
      },

      isCod: {
        type: Boolean,
        default: false,
      },

      codCollected: {
        type: Boolean,
        default: false,
      },

      transactionId: String,
      paidAt: Date,
    },

    /* ================= ADDRESS ================= */

    address: {
      addressId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Address",
        required: true,
      },

      snapshot: {
        name: String,
        phone: String,
        addressLine: String,
        city: String,
        state: String,
        pincode: String,
        landmark: String,
      },
    },

    /* ================= DELIVERY ================= */

    deliverySlot: {
      date: Date,
      slot: String,
    },

    /* ================= STATUS ================= */

    status: {
      type: String,
      enum: [
        "placed",
        "confirmed",
        "packed",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "returned",
      ],
      default: "placed",
      index: true,
    },

    cancelledAt: Date,
    cancelReason: String,

    deliveredAt: Date,

    /* ================= META ================= */

    orderNumber: {
      type: String,
      unique: true,
      index: true,
    },

    notes: String,
  },
  { timestamps: true },
);

/* ================= INDEXES ================= */

OrderSchema.index({ user: 1, createdAt: -1 });
OrderSchema.index({ status: 1 });

/* ================= COD AUTO HANDLING ================= */

OrderSchema.pre("save", async function () {
  if (this.payment.method === "cod") {
    this.payment.isCod = true;
    this.payment.status = "pending";
  }
});

module.exports = mongoose.model("Order", OrderSchema);
