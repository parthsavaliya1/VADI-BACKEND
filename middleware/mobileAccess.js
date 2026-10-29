const { handleReviewRequest } = require('../utils/reviewSandbox');
const { authenticate } = require('./sessionAuth');
const Address = require('../models/Address');
const Order = require('../models/Orders');
const Payment = require('../models/Payment');
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const Review = require('../models/Review');
const oid = value => /^[a-f0-9]{24}$/i.test(String(value || ''));
const deny = (res, message = 'You cannot access another account') => res.status(403).json({ success: false, message });

/** Authentication and ownership are checked before existing route handlers run. */
function access(kind) {
  return (req, res, next) => {
    const parts = req.path.split('/').filter(Boolean);
    const method = req.method;
    // Public browsing and gateway-verified webhook remain available without a customer session.
    if (kind === 'payments' && req.path === '/webhook/razorpay' && method === 'POST') return next();
    if (kind === 'sellers' && req.path === '/login' && method === 'POST') return next();
    if (kind === 'products' && !req.headers.authorization && method === 'GET' && !req.query.includeInactive && !req.query.includePending && (!req.query.isActive || req.query.isActive === 'true')) return next();
    if (kind === 'reviews' && (!req.query.isActive || req.query.isActive === 'true') && method === 'GET' && (parts.length === 0 || parts[0] === 'product') && !req.query.userId) return next();
    return authenticate(req, res, async () => {
      try {
        const a = req.auth;
        if (a.demo && await handleReviewRequest(kind, req, res)) return;
        if (a.role === 'admin') return next();
        const uid = a.userId;
        if (kind === 'uploads') {
          return ['customer', 'seller'].includes(a.role) && !a.demo ? next() : deny(res, 'Uploads are unavailable in review accounts');
        }
        if (kind === 'products') {
          if (method === 'GET' && !req.query.includeInactive && !req.query.includePending && (!req.query.isActive || req.query.isActive === 'true')) return next();
          if (method !== 'POST' || req.path !== '/mine') return deny(res, 'Use the seller product editor');
          if (a.demo) return deny(res, 'Review accounts cannot publish to the live catalog');
          const seller = await Seller.findOne({ user: uid, status: 'approved', isActive: true });
          if (!seller || (req.body.sellerId && String(req.body.sellerId) !== String(seller._id))) return deny(res);
          req.body.userId = uid;
          req.body.sellerId = String(seller._id);
          return next();
        }
        if (kind === 'sellers') {
          if (!['customer', 'seller'].includes(a.role)) return deny(res);
          const seller = await Seller.findOne(a.role === 'seller' ? { _id: a.id } : { user: uid });
          for (const source of [req.query, req.body || {}]) {
            if (source.userId && String(source.userId) !== uid) return deny(res);
            if ((source.sellerId || source.id) && String(source.sellerId || source.id) !== String(seller?._id)) return deny(res);
          }
          if (parts[0] !== 'me' && parts[0] !== 'register') return deny(res, 'Admin access required');
          if (a.demo && method !== 'GET') return deny(res, 'Review accounts cannot change the live seller catalog, banking or payouts');
          if (req.path === '/me/staff') return deny(res, 'Delivery staff details are available to administrators');
          req.body = { ...req.body, userId: uid, ...(seller ? { sellerId: String(seller._id) } : {}) };
          Object.defineProperty(req, 'query', { configurable: true, value: { ...req.query, userId: uid, ...(seller ? { sellerId: String(seller._id) } : {}) } });
          return next();
        }
        if (a.role === 'driver' && kind === 'orders' && parts[1] === 'verify-delivery-handover') {
          const order = oid(parts[0]) ? await Order.findById(parts[0]).select('assignedDriver')
            : await Order.findOne({ orderNumber: parts[0].replace(/^#/, '') }).select('assignedDriver');
          if (!order || String(order.assignedDriver) !== a.id || a.demo) return deny(res);
          return next();
        }
        if (a.role !== 'customer') return deny(res, 'Customer sign-in required');
        for (const source of [req.query, req.body || {}]) {
          if (source.isAdmin && String(source.isAdmin) !== 'false') return deny(res, 'Admin access required');
          if (source.userId && String(source.userId) !== uid) return deny(res);
          if (kind === 'addresses' && source.user && String(source.user) !== uid) return deny(res);
        }
        // A server-side restriction prevents public reviewer credentials from moving real money or fulfilling real orders.
        if (a.demo && method !== 'GET' && ['orders','payments','wallet','reviews','support'].includes(kind)) {
          return deny(res, 'Review account: live purchases, payments and public submissions are disabled');
        }
        req.body = { ...req.body, userId: uid };
        Object.defineProperty(req, 'query', { configurable: true, value: { ...req.query, userId: uid } });
        if (kind === 'users') {
          if (!oid(parts[0]) || parts[0] !== uid) return deny(res);
        } else if (kind === 'addresses') {
          if (req.path === '/nearby') return deny(res, 'Admin access required');
          if (method === 'POST' && parts.length === 0) req.body.user = uid;
          else if (parts[0] === 'single' || method !== 'GET') {
            const id = parts[0] === 'single' ? parts[1] : parts[0];
            const record = oid(id) ? await Address.findById(id).select('user') : null;
            if (!record || String(record.user) !== uid) return deny(res);
          } else if (parts[0] !== uid) return deny(res);
        } else if (kind === 'orders') {
          if (parts[0] === 'stats') { if (parts[1] !== uid) return deny(res); }
          else if (parts.length) {
            if (parts[1] === 'status' || parts[1] === 'verify-delivery-handover' || parts[1] === 'verify-payment') return deny(res, 'Staff access required; use verified checkout');
            const record = parts[0] === 'number' ? await Order.findOne({ orderNumber: parts[1] }).select('user')
              : oid(parts[0]) ? await Order.findById(parts[0]).select('user') : null;
            if (!record || String(record.user) !== uid) return deny(res);
          }
          if (method === 'POST' && !parts.length && req.body.addressId) {
            const address = oid(req.body.addressId) ? await Address.findById(req.body.addressId).select('user') : null;
            if (!address || String(address.user) !== uid) return deny(res);
          }
        } else if (kind === 'payments') {
          if (['refund','collect-cod'].includes(parts[1])) return deny(res, 'Admin access required');
          if (parts[0] === 'stats') { if (parts[1] !== uid) return deny(res); }
          if (parts[0] === 'order' || req.body.orderId) {
            const id = parts[0] === 'order' ? parts[1] : req.body.orderId;
            const record = oid(id) ? await Order.findById(id).select('user') : null;
            if (!record || String(record.user) !== uid) return deny(res);
          }
          if (oid(parts[0])) {
            const record = await Payment.findById(parts[0]).select('user');
            if (!record || String(record.user) !== uid) return deny(res);
          }
          // The legacy manual verification endpoint trusts client payment status. Only the signature-verified flow is public.
          if (['verify','initiate'].includes(parts[0])) return deny(res, 'Use verified checkout');
        } else if (kind === 'reviews') {
          if (['bulk','stats'].includes(parts[0]) || ['permanent','toggle-active'].includes(parts[1])) return deny(res, 'Admin access required');
          if (parts[0] === 'user' && parts[1] !== uid) return deny(res);
          if (oid(parts[0]) && method !== 'GET') {
            const record = await Review.findById(parts[0]).select('user');
            if (!record || String(record.user) !== uid) return deny(res);
          }
        }
        return next();
      } catch {
        return res.status(503).json({ message: 'Could not verify account access' });
      }
    });
  };
}
module.exports = access;
