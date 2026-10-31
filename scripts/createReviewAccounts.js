const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Address = require('../models/Address');
const { identities } = require('../utils/reviewAccess');

async function main() {
  if (!process.env.MONGO_URI || !process.env.JWT_SECRET) throw new Error('MONGO_URI and JWT_SECRET are required');
  const file = path.join(__dirname, '../.review-credentials.local.json');
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const credentials = {};
  for (const [role, identity] of Object.entries(identities)) {
    const otp = process.env[`REVIEW_${role.toUpperCase()}_OTP`] || saved[role]?.otp || String(crypto.randomInt(100000, 1000000));
    if (!/^\d{6}$/.test(otp)) throw new Error(`REVIEW_${role.toUpperCase()}_OTP must contain exactly six digits`);
    credentials[role] = { phone: identity.phone, otp };
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  try {
    // Preflight every identity before making changes: never convert an existing real account into a demo.
    for (const [role, identity] of Object.entries(identities)) {
      const Model = User;
      const existing = await Model.findOne({ phone: identity.phone });
      if (existing && !existing.isDemo) throw new Error(`Reserved ${role} identity is already in use; no changes made`);
    }
    fs.writeFileSync(file, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600 });
    for (const [role, identity] of Object.entries(identities)) {
      const reviewOtpHash = await bcrypt.hash(credentials[role].otp, 12);
      const Model = User;
      const data = { name: 'VADI Review Customer', role: 'user', status: 'active', isDemo: true, isPhoneVerified: true, reviewOtpHash };
      const account = await Model.findOneAndUpdate({ phone: identity.phone }, { $set: { ...data, otp: null, otpSessionId: null, otpExpiresAt: null, otpAttempts: 0 }, $unset: { reviewPasswordHash: 1 } }, { upsert: true, new: true, runValidators: true });
      if (role === 'user' && !(await Address.exists({ user: account._id }))) {
        await Address.create({ user: account._id, type: 'home', name: 'Demo Customer', phone: '9990000101', addressLine1: 'Demo review address - no delivery', city: 'Rajkot', state: 'Gujarat', pincode: '360001', isDefault: true, location: { type: 'Point', coordinates: [70.8022, 22.3039] } });
      }
      console.log(`Ready: ${identity.phone} (${role})`);
    }
    console.log('Credentials saved locally to .review-credentials.local.json. Do not commit this file.');
    console.log('Enable ENABLE_REVIEW_ACCOUNTS=true on the deployed backend and deploy the matching app/backend changes.');
  } finally { await mongoose.disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
