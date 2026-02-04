const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./config/db");
connectDB();

const productRoutes = require("./routes/productRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const authRoutes = require("./routes/authRoutes");
const addressRoute = require("./routes/addressRoute");
const orderRoute = require("./routes/orderRoute");
const paymentRoute = require("./routes/paymentRoute");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/products", productRoutes);
app.use("/categories", categoryRoutes);
app.use("/api/auth", authRoutes);
app.use("/addresses", addressRoute);
app.use("/orders", orderRoute);
app.use("/payments", paymentRoute);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.send("VADI Backend running 🚀");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
