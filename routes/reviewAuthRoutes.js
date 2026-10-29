const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { customerToken, publicUser } = require('../middleware/sessionAuth');
const router = express.Router();
const identities = {
  user: { login: 'review-user', phone: '+919990000101' },
};
const attempts = new Map();
function loginLimit(req, res, next) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  const key = req.ip || req.socket.remoteAddress;
  const value = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  value.count += 1;
  attempts.set(key, value);
  if (value.count > 30) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  return next();
}
router.post('/review-login', loginLimit, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (process.env.ENABLE_REVIEW_ACCOUNTS !== 'true') return res.status(403).json({ error: 'Review access is disabled' });
  const { role, login, password, privacyPolicyAccepted } = req.body || {};
  const identity = role === 'user' ? identities.user : null;
  if (!identity || login !== identity.login || typeof password !== 'string' || password.length > 200) return res.status(401).json({ error: 'Invalid review credentials' });
  if (privacyPolicyAccepted !== true) return res.status(400).json({ error: 'Please read and accept the privacy policy' });
  try {
    const account = await User.findOne({ phone: identity.phone, isDemo: true }).select('+reviewPasswordHash');
    if (!account?.reviewPasswordHash || !(await bcrypt.compare(password, account.reviewPasswordHash))) return res.status(401).json({ error: 'Invalid review credentials' });
    if (account.status === 'blocked' || account.isActive === false) return res.status(403).json({ error: 'Account unavailable' });
    account.lastLoginAt = new Date();
    account.privacyPolicyAccepted = true;
    account.privacyPolicyAcceptedAt ||= new Date();
    await account.save();
    return res.json({ success: true, user: publicUser(account), token: customerToken(account), demo: true });
  } catch {
    return res.status(503).json({ error: 'Review sign-in is temporarily unavailable' });
  }
});
module.exports = router;
module.exports.identities = identities;
