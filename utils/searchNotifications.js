const User = require('../models/User');
const Product = require('../models/Product');
const Notification = require('../models/Notification');
const { sendExpoPush } = require('./expoPushSend');
const { DAY, eligibleSearch, productMatch } = require('./searchHistory');
let running = false;
async function runSearchNotifications(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const due = { status: 'active', isDemo: { $ne: true }, searchNotificationsEnabled: { $ne: false },
      'searchHistory.0': { $exists: true },
      $or: [{ lastSearchNotificationAt: null }, { lastSearchNotificationAt: { $lte: new Date(+now - DAY) } }] };
    for await (const user of User.find(due).select('searchHistory pushToken lastSearchNotificationAt').lean().cursor()) {
      try {
        for (const entry of user.searchHistory || []) {
          if (!eligibleSearch(entry, now)) continue;
          const product = await Product.findOne(productMatch(entry.query, now)).select('name').lean();
          if (!product) continue;
          // Atomic daily claim also checks for a concurrent clear, opt-out or new search.
          const claim = await User.updateOne({ ...due, _id: user._id, searchHistory: { $elemMatch: {
            key: entry.key, searchedAt: entry.searchedAt,
            $or: [{ lastNotifiedAt: null }, { lastNotifiedAt: { $lte: new Date(+now - 7 * DAY) } }],
          } } }, { $set: { lastSearchNotificationAt: now, 'searchHistory.$[h].lastNotifiedAt': now } },
          { arrayFilters: [{ 'h.key': entry.key }] });
          if (!claim.modifiedCount) break;
          const title = 'Found something you searched for';
          const body = `${product.name} is available. Explore results for “${entry.query}”.`;
          let notice;
          try {
            notice = await Notification.create({ user: user._id, kind: 'search', title, body, searchQuery: entry.query });
          } catch (error) {
            await User.updateOne({ _id: user._id, lastSearchNotificationAt: now }, { $set: {
              lastSearchNotificationAt: user.lastSearchNotificationAt || null,
              'searchHistory.$[h].lastNotifiedAt': entry.lastNotifiedAt || null,
            } }, { arrayFilters: [{ 'h.key': entry.key, 'h.lastNotifiedAt': now }] });
            throw error;
          }
          if (user.pushToken) await sendExpoPush([user.pushToken], { title, body,
            data: { type: 'search', searchQuery: entry.query, notificationId: String(notice._id) } });
          break;
        }
      } catch (error) { console.error('Search notification failed:', error.message); }
    }
  } finally { running = false; }
}
module.exports = { runSearchNotifications };
