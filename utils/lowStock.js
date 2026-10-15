const Product = require("../models/Product");
const Seller = require("../models/Seller");
const { notifyUser } = require("./orderNotify");

async function notifyLowStock(items) {
  for (const item of items || []) {
    try {
      const product = await Product.findById(item.product).select("name seller variants").lean();
      if (!product) continue;
      const variant = (product.variants || []).find(
        (v) => String(v._id) === String(item.variantId),
      );
      if (!variant) continue;
      const threshold = Number(variant.lowStockThreshold ?? 5);
      if (Number(variant.stock) > threshold) continue;
      const seller = await Seller.findById(product.seller?.sellerId).select("user name").lean();
      if (!seller?.user) continue;
      await notifyUser({
        userId: seller.user,
        title: "Low stock",
        body: `${product.name} (${variant.packSize}${variant.packUnit}) has ${variant.stock} left.`,
        kind: "stock",
      });
    } catch (error) {
      console.error("[lowStock] failed:", error.message);
    }
  }
}

module.exports = { notifyLowStock };
