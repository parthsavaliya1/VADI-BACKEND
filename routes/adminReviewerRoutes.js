const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { adminOnly } = require('../middleware/sessionAuth');
const { normalizePhone } = require('../utils/twoFactorSms');
const { isReviewEnabled } = require('../utils/reviewAccess');
const router = express.Router();
router.use(adminOnly);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const fields = '_id name phone status reviewEnabled reviewOtpHash';
const publicAccount = account => ({
  _id: String(account._id), name: account.name, phone: account.phone,
  enabled: isReviewEnabled(account), hasCode: Boolean(account.reviewOtpHash), status: account.status,
});
const validName = name => typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 100;
const validCode = code => typeof code === 'string' && /^\d{6}$/.test(code);
function failure(res, error) {
  if (error.code === 11000) return res.status(409).json({ message: 'This phone number already has an account. Use a separate reviewer number.' });
  return res.status(503).json({ message: 'Reviewer accounts are temporarily unavailable. Please try again.' });
}
router.get('/', async (_req, res) => {
  try {
    const accounts = await User.find({ isDemo: true }).select(fields).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: accounts.map(publicAccount) });
  } catch (error) { return failure(res, error); }
});
router.post('/', async (req, res) => {
  const { name, phone, code, enabled } = req.body || {};
  if (!validName(name) || typeof phone !== 'string' || !validCode(code) || typeof enabled !== 'boolean') {
    return res.status(400).json({ message: 'Enter a name, Indian mobile number, six-digit code and access status.' });
  }
  const normalized = normalizePhone(phone);
  if (!/^\+91[6-9]\d{9}$/.test(normalized)) return res.status(400).json({ message: 'Enter a valid Indian mobile number.' });
  try {
    // A reviewer is always a new, isolated demo customer. Never convert a real account.
    if (await User.exists({ phone: normalized })) return res.status(409).json({ message: 'This phone number already has an account. Edit the existing reviewer or use a separate number.' });
    const account = await User.create({ name: name.trim(), phone: normalized, role: 'user', status: 'active', isDemo: true, isPhoneVerified: true, reviewEnabled: enabled, reviewOtpHash: await bcrypt.hash(code, 12) });
    return res.status(201).json({ success: true, data: publicAccount(account) });
  } catch (error) { return failure(res, error); }
});
router.put('/:id', async (req, res) => {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ message: 'Invalid reviewer account.' });
  const { name, code, enabled } = req.body || {};
  if ((name !== undefined && !validName(name)) || (code !== undefined && !validCode(code)) || (enabled !== undefined && typeof enabled !== 'boolean')) {
    return res.status(400).json({ message: 'Use a valid name, six-digit code and access status.' });
  }
  if (name === undefined && code === undefined && enabled === undefined) return res.status(400).json({ message: 'No changes supplied.' });
  try {
    const current = await User.findOne({ _id: req.params.id, isDemo: true }).select(fields);
    if (!current) return res.status(404).json({ message: 'Reviewer account not found.' });
    if (enabled === true && current.status === 'blocked') return res.status(409).json({ message: 'Unblock this account in Users before enabling reviewer access.' });
    if (enabled === true && !current.reviewOtpHash && !code) return res.status(400).json({ message: 'Set a six-digit review code before enabling this account.' });
    const changes = {};
    if (name !== undefined) changes.name = name.trim();
    if (enabled !== undefined) changes.reviewEnabled = enabled;
    if (code !== undefined) changes.reviewOtpHash = await bcrypt.hash(code, 12);
    // Cancel pending challenges when credentials or access change.
    if (code !== undefined || enabled !== undefined) Object.assign(changes, { otp: null, otpSessionId: null, otpExpiresAt: null, otpAttempts: 0 });
    const account = await User.findOneAndUpdate({ _id: current._id, isDemo: true }, { $set: changes }, { new: true, runValidators: true }).select(fields);
    if (!account) return res.status(404).json({ message: 'Reviewer account not found.' });
    return res.json({ success: true, data: publicAccount(account) });
  } catch (error) { return failure(res, error); }
});
module.exports = router;
