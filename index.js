const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const connectDB = require("./config/db");
connectDB();

const productRoutes = require("./routes/productRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const bannerRoutes = require("./routes/bannerRoutes");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const addressRoute = require("./routes/addressRoute");
const orderRoute = require("./routes/orderRoute");
const paymentRoute = require("./routes/paymentRoute");
const cartRoute = require("./routes/cartRoute");
const reviewRoute = require("./routes/reviewRoute");
const adminAuthRoutes = require("./routes/adminAuthRoutes");
const adminRoutes = require("./routes/adminRoutes");
const sellerRoutes = require("./routes/sellerRoutes");
const dealSettingsRoutes = require("./routes/dealSettingsRoutes");
const homeSectionSettingsRoutes = require("./routes/homeSectionSettingsRoutes");
const appThemeRoutes = require("./routes/appThemeRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const appConfigRoutes = require("./routes/appConfigRoutes");
const driverAuthRoutes = require("./routes/driverAuthRoutes");
const adminPanelRoutes = require("./routes/adminPanelRoutes");
const walletRoutes = require("./routes/walletRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const feeRoutes = require("./routes/feeRoutes");
const couponRoutes = require("./routes/couponRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");

const app = express();
app.set("trust proxy", 1);

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3002",
      "http://localhost:5173",
      "http://localhost:4173",
    ],
    credentials: true,
  }),
);

app.use("/payments/webhook/razorpay", express.raw({ type: "application/json" }));
app.use(express.json());

// Bootstrap: app reads Remote Config via Admin (RN cannot use Firebase JS Remote Config)
app.use(appConfigRoutes);

// 🔥 serve uploads FIRST
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/uploads", uploadRoutes);
app.use("/products", productRoutes);
app.use("/categories", categoryRoutes);
app.use("/banners", bannerRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/addresses", addressRoute);
app.use("/orders", orderRoute);
app.use("/payments", paymentRoute);
app.use("/wallet", walletRoutes);
app.use("/cart", cartRoute);
app.use("/fees", feeRoutes);
app.use("/coupons", couponRoutes);
app.use("/wishlist", wishlistRoutes);
app.use("/reviews", reviewRoute);
app.use("/sellers", sellerRoutes);
app.use("/api/admin", adminAuthRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin", adminPanelRoutes);
app.use("/deal-settings", dealSettingsRoutes);
app.use("/home-section-settings", homeSectionSettingsRoutes);
// Public colour theme — read-only from any origin (website, app). Changes go through /api/admin/app-theme.
app.use(
  "/app-theme",
  cors(),
  (req, res, next) =>
    req.method === "GET" || req.method === "OPTIONS"
      ? next()
      : res.status(405).json({ success: false, message: "Method not allowed" }),
  appThemeRoutes
);
app.use("/notifications", notificationRoutes);
app.use("/api/driver", driverAuthRoutes);

app.get("/", (req, res) => {
  res.send("VADI Backend running 🚀");
});

const PORT = process.env.PORT || 5000;
const razorpayKey = process.env.RAZORPAY_KEY_ID || "";
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(
    razorpayKey
      ? `Razorpay key loaded: ${razorpayKey.slice(0, 12)}…`
      : "Razorpay key missing",
  );
});
