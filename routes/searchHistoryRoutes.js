const router = require('express').Router();
const User = require('../models/User');
const { authenticate } = require('../middleware/sessionAuth');
const { HISTORY_LIMIT, normalizeSearch } = require('../utils/searchHistory');
router.use(authenticate, (req, res, next) => req.auth.role === 'customer'
  ? next() : res.status(403).json({ message: 'Customer sign-in required' }));

router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.auth.userId).select('searchHistory searchNotificationsEnabled').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ success: true, data: user.searchHistory || [], notificationsEnabled: user.searchNotificationsEnabled !== false });
  } catch { res.status(500).json({ message: 'Could not load search history' }); }
});
router.post('/', async (req, res) => {
  const query = normalizeSearch(req.body?.query);
  if (!query) return res.status(400).json({ message: 'A search term is required' });
  const key = query.toLowerCase();
  try {
    // One atomic update preserves alert cooldowns and prevents duplicate terms.
    await User.updateOne({ _id: req.auth.userId }, [{ $set: { searchHistory: { $slice: [
      { $concatArrays: [[{ $mergeObjects: [
        { $ifNull: [{ $arrayElemAt: [{ $filter: { input: { $ifNull: ['$searchHistory', []] }, as: 'h', cond: { $eq: ['$$h.key', { $literal: key }] } } }, 0] }, {}] },
        { $literal: { query, key, searchedAt: new Date() } },
      ] }], { $filter: { input: { $ifNull: ['$searchHistory', []] }, as: 'h', cond: { $ne: ['$$h.key', { $literal: key }] } } }] }, HISTORY_LIMIT,
    ] } } }], { updatePipeline: true });
    res.json({ success: true });
  } catch { res.status(500).json({ message: 'Could not save search history' }); }
});
router.delete('/', async (req, res) => {
  try {
    const key = normalizeSearch(req.body?.query).toLowerCase();
    await User.updateOne({ _id: req.auth.userId }, key
      ? { $pull: { searchHistory: { key } } } : { $set: { searchHistory: [] } });
    res.json({ success: true });
  } catch { res.status(500).json({ message: 'Could not delete search history' }); }
});
router.patch('/preferences', async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ message: 'enabled must be a boolean' });
  try {
    await User.updateOne({ _id: req.auth.userId }, { $set: { searchNotificationsEnabled: req.body.enabled } });
    res.json({ success: true });
  } catch { res.status(500).json({ message: 'Could not update search notifications' }); }
});
module.exports = router;
