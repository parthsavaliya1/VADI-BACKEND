const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");

// Create once; deployments never overwrite an existing admin's password.
async function ensureAdmin(env = process.env) {
  const email = (env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = env.ADMIN_PASSWORD;
  if (!email && !password) {
    console.log("Admin setup skipped: set ADMIN_EMAIL and ADMIN_PASSWORD to enable.");
    return;
  }
  if (!email || !password || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Admin setup requires ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters, maximum 72 UTF-8 bytes).");
  }
  if (await Admin.exists({ email })) return;
  const hash = await bcrypt.hash(password, 12);
  try {
    await Admin.updateOne(
      { email },
      { $setOnInsert: { name: env.ADMIN_NAME || "Super Admin", email, password: hash } },
      { upsert: true, runValidators: true },
    );
  } catch (error) {
    // Another server instance may have created this account concurrently.
    if (error.code !== 11000 || !(await Admin.exists({ email }))) throw error;
  }
  console.log("Admin account setup complete.");
}

module.exports = ensureAdmin;