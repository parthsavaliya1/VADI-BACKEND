const mongoose = require("mongoose");

const RepeatReminderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Orders",
      required: true,
    },
    cadence: { type: String, enum: ["weekly"], default: "weekly" },
    nextAt: { type: Date, required: true, index: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("RepeatReminder", RepeatReminderSchema);
