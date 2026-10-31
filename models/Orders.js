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

    commissionPercent: {
      type: Number,
      min: 0,
      max: 100,
    },

    commissionAmount: {
      type: Number,
      min: 0,
    },

    sellerAmount: {
      type: Number,
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

    /** Driver earning locked in when the order is placed, from the fee rules at that time. */
    driverPayout: {
      type: Number,
      default: 0,
      min: 0,
    },

    driverFeeMode: {
      type: String,
      default: "",
    },

    driverFeeValue: {
      type: Number,
      default: 0,
      min: 0,
    },

    grandTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    couponCode: {
      type: String,
      default: "",
    },

    couponDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /* ================= PAYMENT (COD READY) ================= */

    payment: {
      method: {
        type: String,
        enum: ["cod", "upi", "card", "wallet", "balance"],
        required: true,
      },

      status: {
        type: String,
        enum: ["pending", "paid", "failed", "refunded", "cancelled"],
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
      gatewayOrderId: String,
      gatewaySignature: String,
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
        addressLine1: String,
        addressLine2: String,
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
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "returned",
      ],
      default: "placed",
      index: true,
    },

    statusHistory: [{
      from: String, to: String, reason: String,
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      changedAt: { type: Date, default: Date.now },
      previousPaymentStatus: String, previousCodCollected: Boolean, codCollected: Boolean,
      previousReturnRequest: mongoose.Schema.Types.Mixed,
    }],

    cancelledAt: Date,
    cancelReason: String,

    deliveredAt: Date,

    returnRequest: {
      status: {
        type: String,
        enum: ["pending", "processing", "approved", "rejected"],
      },
      reason: String,
      requestedAt: Date,
      resolvedAt: Date,
      adminNote: String,
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      restocked: { type: Boolean, default: false },
      refundStatus: { type: String, enum: ["processing", "pending", "processed", "failed", "none"] },
      refundOperation: {
        receipt: String, amount: Number, paymentId: String, adminNote: String, restock: Boolean,
        gatewayRefundId: String, state: String, error: String,
      },
      items: [
        {
          variantId: mongoose.Schema.Types.ObjectId,
          quantity: { type: Number, min: 1 },
          action: {
            type: String,
            enum: ["refund", "replace"],
            default: "refund",
          },
          productName: String,
        },
      ],
      refundAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
      refundedTo: {
        type: String,
        enum: ["wallet", "original", "none"],
        default: "none",
      },
    },

    /** Latest driver coordinates while the order is out for delivery. */
    driverLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      updatedAt: { type: Date, default: null },
    },

    /**
     * Delivery handover (6-digit code): generated when status → out_for_delivery (in-app only; no SMS).
     * Encrypted at rest; customer sees decrypted value only via GET order as owner.
     * Admin/driver verifies with POST /orders/:id/verify-delivery-handover before marking delivered.
     */
    deliveryHandoverCipher: {
      type: String,
      select: false,
      default: null,
    },

    deliveryHandoverGeneratedAt: {
      type: Date,
      default: null,
    },

    deliveryHandoverWrongAttempts: {
      type: Number,
      default: 0,
    },

    deliveryHandoverVerifiedAt: {
      type: Date,
      default: null,
    },

    /** Set when a driver (not admin) verifies the handover OTP */
    deliveryHandoverVerifiedByDriver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
    },

    /** Filled when order is marked delivered — attribution for driver portal */
    deliveredByDriver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
      index: true,
    },

    /** Staff member the seller assigned to deliver this order */
    assignedDriver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
      index: true,
    },

    /* ================= SELLER COMMISSION ================= */

    commissionSettled: {
      type: Boolean,
      default: false,
      index: true,
    },

    commissionSettledAt: Date,

    commissionReversed: {
      type: Boolean,
      default: false,
    },

    platformCommission: {
      type: Number,
      default: 0,
      min: 0,
    },

    sellerPayoutTotal: {
      type: Number,
      default: 0,
      min: 0,
    },

    settlements: [
      {
        sellerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Seller",
        },
        sellerName: String,
        gross: Number,
        commissionPercent: Number,
        commissionAmount: Number,
        sellerAmount: Number,
      },
    ],

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

/* ================= COD AUTO HANDLING ================= */

OrderSchema.pre("save", async function () {
  if (this.payment.method === "cod") {
    this.payment.isCod = true;

  }
});

module.exports = mongoose.model("Order", OrderSchema);
