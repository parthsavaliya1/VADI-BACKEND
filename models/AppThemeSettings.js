const mongoose = require("mongoose");

/** Theme keys must match the palettes defined in the app, admin and website. */
const THEME_KEYS = [
  "fresh-green",
  "cream-mango",
  "terracotta",
  "classic-green",
  "olive-ivory",
  "teal-pistachio",
  "winter",
  "summer",
  "monsoon",
];

const AppThemeSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "default",
      unique: true,
      index: true,
    },
    /** Active colour theme shown in the mobile app, admin panel and website. */
    theme: { type: String, enum: THEME_KEYS, default: "fresh-green" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("AppThemeSettings", AppThemeSettingsSchema);
module.exports.THEME_KEYS = THEME_KEYS;
