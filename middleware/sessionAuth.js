const jwt = require('jsonwebtoken');
const { isReviewEnabled } = require('../utils/reviewAccess');
const User = require('../models/User');
const Admin = require('../models/Admin');
const Driver = require('../models/Driver');
const Seller = require('../models/Seller');

function publicUser(user) {
  const value = user.toObject ? user.toObject() : { ...user };
  for (const field of ['otp','otpSessionId','otpExpiresAt','otpAttempts','reviewPasswordHash','reviewOtpHash']) delete value[field];
  return value;
}
function customerToken(user) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  return jwt.sign({ id: String(user._id), role: 'customer', demo: Boolean(user.isDemo) },
    process.env.JWT_SECRET, { expiresIn: '30d', issuer: 'vadi-backend', audience: 'vadi-mobile' });
}
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ message: 'Please sign in again' });
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!/^[a-f0-9]{24}$/i.test(String(decoded.id))) return res.status(401).json({ message: 'Invalid session' });
    let record;
    if (decoded.role === 'customer') {
      if (decoded.aud !== 'vadi-mobile' || decoded.iss !== 'vadi-backend') return res.status(401).json({ message: 'Invalid session' });
      record = await User.findById(decoded.id).select('_id role status isDemo phone reviewEnabled');
      if (!record || record.status === 'blocked') return res.status(401).json({ message: 'Account unavailable' });
    } else if (decoded.role === 'driver') {
      record = await Driver.findById(decoded.id).select('_id isActive isDemo');
      if (!record?.isActive) return res.status(401).json({ message: 'Driver account unavailable' });
    } else if (decoded.role === 'seller') {
      record = await Seller.findById(decoded.id).select('_id user status isActive isDemo');
      if (!record?.isActive || record.status !== 'approved') return res.status(401).json({ message: 'Seller account unavailable' });
    } else if (decoded.role === 'admin' || !decoded.role) {
      record = await Admin.findById(decoded.id).select('_id');
      if (!record) return res.status(401).json({ message: 'Admin account unavailable' });
      decoded.role = 'admin';
    } else return res.status(403).json({ message: 'Invalid account role' });
    if (record.isDemo && (decoded.role === 'customer' ? !isReviewEnabled(record) : process.env.ENABLE_REVIEW_ACCOUNTS !== 'true')) return res.status(403).json({ message: 'Review access is disabled' });
    req.auth = { id: String(record._id), role: decoded.role, demo: Boolean(record.isDemo), userId: record.user ? String(record.user) : String(record._id) };
    return next();
  } catch (error) {
    const invalid = error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' || error.name === 'NotBeforeError';
    return res.status(invalid ? 401 : 503).json({ message: invalid ? 'Invalid or expired session' : 'Authentication temporarily unavailable' });
  }
}
async function adminOnly(req, res, next) {
  return authenticate(req, res, () => req.auth.role === 'admin'
    ? (req.admin = { id: req.auth.id, role: 'admin' }, next())
    : res.status(403).json({ message: 'Admin access required' }));
}
module.exports = { authenticate, adminOnly, customerToken, publicUser };
