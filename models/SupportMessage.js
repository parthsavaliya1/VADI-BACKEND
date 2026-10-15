const mongoose = require("mongoose");

const SupportMessageSchema = new mongoose.Schema(
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
      default: null,
    },
    body: { type: String, required: true, trim: true },
    from: { type: String, enum: ["customer", "admin"], default: "customer" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("SupportMessage", SupportMessageSchema);
