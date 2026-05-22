const mongoose = require("mongoose");

const HomeSectionSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "default",
      unique: true,
      index: true,
    },
    /** When false, the whole block is hidden on the app home screen. */
    showTrendingSection: { type: Boolean, default: true },
    showFeaturedSection: { type: Boolean, default: true },
    showBestDealsSection: { type: Boolean, default: true },
    showShopByCategorySection: { type: Boolean, default: true },
    showFeatureBadgesRow: { type: Boolean, default: true },
    showHeroBanner: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("HomeSectionSettings", HomeSectionSettingsSchema);
