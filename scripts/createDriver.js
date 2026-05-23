/**
 * Create a delivery driver (same as POST /api/admin/drivers).
 * Usage: node scripts/createDriver.js +919876543210 "Ravi Kumar"
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Driver = require("../models/Driver");
const { normalizePhone } = require("../utils/twoFactorSms");

async function main() {
  const [, , rawPhone, nameArg] = process.argv;
  if (!rawPhone) {
    console.error('Usage: node scripts/createDriver.js <phone> ["Driver name"]');
    process.exit(1);
  }
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("Set MONGO_URI or MONGODB_URI in .env");
    process.exit(1);
  }
  await mongoose.connect(uri);
  const phone = normalizePhone(rawPhone);
  const existing = await Driver.findOne({ phone });
  if (existing) {
    console.log("Driver already exists:", existing._id.toString(), existing.phone);
    process.exit(0);
  }
  const driver = await Driver.create({
    phone,
    name: nameArg ? String(nameArg).trim() : "",
    isActive: true,
  });
  console.log("Created driver:", driver._id.toString(), driver.phone, driver.name);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
