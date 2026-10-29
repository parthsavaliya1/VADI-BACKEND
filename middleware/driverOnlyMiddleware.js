const { handleReviewRequest } = require('../utils/reviewSandbox');
const { authenticate } = require('./sessionAuth');
module.exports = (req, res, next) => authenticate(req, res, async () => {
  if (req.auth.role !== 'driver') return res.status(403).json({ message: 'Driver access required' });
  req.driver = { id: req.auth.id };
  // Demo drivers may view their own screen but cannot update real tracking or handovers.
  if (req.auth.demo) {
    try { if (await handleReviewRequest('driver', req, res)) return; }
    catch { return res.status(503).json({ message: 'Demo sandbox temporarily unavailable' }); }
  }
  if (req.auth.demo && req.method !== 'GET') return res.status(403).json({ message: 'Live delivery changes are disabled for review accounts' });
  return next();
});
