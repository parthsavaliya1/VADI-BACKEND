require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Product = require("../models/Product");
const Seller = require("../models/Seller");

const normalizeCode = (value) => String(value || "").trim().toUpperCase();

async function migrateProductSellers() {
  await connectDB();

  const products = await Product.find({}).lean();
  let linkedCount = 0;
  let createdSellers = 0;

  for (const product of products) {
    const rawSellerId = product?.seller?.sellerId;

    if (
      rawSellerId &&
      mongoose.Types.ObjectId.isValid(String(rawSellerId)) &&
      product?.seller?.sellerName
    ) {
      continue;
    }

    const code = normalizeCode(rawSellerId || product?.seller?.sellerName || "UNKNOWN");
    const sellerName = product?.seller?.sellerName || code;

    let seller = await Seller.findOne({
      $or: [{ code }, { name: sellerName }],
    });

    if (!seller) {
      seller = await Seller.create({
        name: sellerName,
        code,
        phone: product?.seller?.contact?.phone || "",
        email: product?.seller?.contact?.email || "",
        location: {
          city: product?.seller?.location?.city || "",
          area: product?.seller?.location?.area || "",
        },
        isActive: true,
      });
      createdSellers += 1;
    }

    await Product.updateOne(
      { _id: product._id },
      {
        $set: {
          "seller.sellerId": seller._id,
          "seller.sellerName": seller.name,
          "seller.contact.phone": seller.phone || "",
          "seller.contact.email": seller.email || "",
          "seller.location.city": seller.location?.city || "",
          "seller.location.area": seller.location?.area || "",
        },
      },
    );

    linkedCount += 1;
  }

  console.log("Seller migration complete");
  console.log("Products updated:", linkedCount);
  console.log("Sellers created:", createdSellers);

  await mongoose.connection.close();
}

migrateProductSellers().catch(async (error) => {
  console.error("Seller migration failed:", error);
  await mongoose.connection.close();
  process.exit(1);
});
