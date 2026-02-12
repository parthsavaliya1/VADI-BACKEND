const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const Admin = require("./models/Admin"); // make sure path is correct

async function createAdmin() {
  try {
    console.log("Connecting to DB...");
    await mongoose.connect(process.env.MONGO_URI);

    console.log("Connected to:", mongoose.connection.name);

    const existing = await Admin.findOne({ email: "admin@vadi.com" });

    if (existing) {
      console.log("Admin already exists");
      process.exit();
    }

    const hashedPassword = await bcrypt.hash("12345678", 10);

    const newAdmin = await Admin.create({
      name: "Super Admin",
      email: "admin@vadi.com",
      password: hashedPassword,
    });

    console.log("Admin created:", newAdmin);
    process.exit();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

createAdmin();
