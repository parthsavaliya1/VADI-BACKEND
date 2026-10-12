const mongoose = require("mongoose");

const CommissionSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "global",
      unique: true,
      index: true,
    },
    defaultCommissionPercent: {
      type: Number,
      default: 10,
      min: 0,
      max: 100,
    },
    /** Amount charged to the customer, unless the order qualifies for free delivery. */
    deliveryFee: {
      type: Number,
      default: 40,
      min: 0,
    },
    /** Orders above this product total get free delivery. 0 turns free delivery off. */
    freeDeliveryAbove: {
      type: Number,
      default: 500,
      min: 0,
    },
    /**
     * How the driver is paid for a delivered order.
     * flat: a fixed rupee amount (paid even when the customer delivery fee is 0)
     * percent_of_delivery: a percent of the delivery fee the customer paid
     * percent_of_order: a percent of the product total
     */
    driverFeeMode: {
      type: String,
      enum: ["flat", "percent_of_delivery", "percent_of_order"],
      default: "flat",
    },
    driverFeeValue: {
      type: Number,
      default: 30,
      min: 0,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("CommissionSettings", CommissionSettingsSchema);
