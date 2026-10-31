const DAY = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 20;
function normalizeSearch(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
}
function eligibleSearch(entry, now = new Date()) {
  return entry.query.length >= 2 && new Date(entry.searchedAt) <= new Date(+now - 60 * 60 * 1000)
    && new Date(entry.searchedAt) > new Date(+now - 30 * DAY)
    && (!entry.lastNotifiedAt || new Date(entry.lastNotifiedAt) <= new Date(+now - 7 * DAY));
}
function productMatch(query, now = new Date()) {
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    isActive: true, approvalStatus: 'approved',
    variants: { $elemMatch: { isActive: { $ne: false }, stock: { $gt: 0 },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] } },
    $or: ['name', 'description', 'brand', 'tags', 'searchKeywords'].map(field => ({ [field]: { $regex: pattern, $options: 'i' } })),
  };
}
module.exports = { DAY, HISTORY_LIMIT, normalizeSearch, eligibleSearch, productMatch };
