const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'search-history-isolated-test-secret';
const User = require('../models/User');
const Product = require('../models/Product');
const Notification = require('../models/Notification');
const push = require('../utils/expoPushSend');
const { normalizeSearch, eligibleSearch, productMatch, DAY } = require('../utils/searchHistory');
const uid = '111111111111111111111111';
let account = { _id: uid, status: 'active', searchHistory: [] };
let updates = [], notices = [], sends = [], matches = [], claim = true, failSave = false;
User.findById = () => ({ select: () => Object.assign(Promise.resolve(account), { lean: async () => account }) });
User.updateOne = async (...args) => { updates.push(args); return { modifiedCount: claim ? 1 : 0 }; };
User.find = (filter) => { matches.push(filter); return { select: () => ({ lean: () => ({ cursor: async function* () { yield account; } }) }) }; };
Product.findOne = (filter) => { matches.push(filter); return { select: () => ({ lean: async () => ({ name: 'Fresh apples' }) }) }; };
Notification.create = async (value) => { if (failSave) throw new Error('test database failure'); notices.push(value); return { _id: 'note' }; };
push.sendExpoPush = async (...args) => { sends.push(args); };
const { runSearchNotifications } = require('../utils/searchNotifications');
const app = express(); app.use(express.json()); app.use('/search-history', require('../routes/searchHistoryRoutes'));
const server = app.listen(0, '127.0.0.1');
after(() => server.close());
async function request(method, path = '', body, token = jwt.sign({ id: uid, role: 'customer' }, process.env.JWT_SECRET, { issuer: 'vadi-backend', audience: 'vadi-mobile' })) {
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const result = await fetch(`http://127.0.0.1:${server.address().port}/search-history${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: result.status, body: await result.json() };
}
test('normalizes and bounds queries; matching treats regex characters literally and excludes unavailable packs', () => {
  assert.equal(normalizeSearch('  red   apple  '), 'red apple');
  assert.equal(normalizeSearch({}), '');
  assert.equal(normalizeSearch('a'.repeat(101)).length, 100);
  const filter = productMatch('a.*[b]');
  assert.equal(filter.$or[0].name.$regex, 'a\\.\\*\\[b\\]');
  assert.equal(filter.isActive, true); assert.equal(filter.approvalStatus, 'approved');
  assert.equal(filter.variants.$elemMatch.stock.$gt, 0);
  assert.equal(filter.variants.$elemMatch.isActive.$ne, false);
  assert.ok(filter.variants.$elemMatch.$or[1].expiresAt.$gt instanceof Date);
});
test('requires customer authentication and always uses session owner, ignoring spoofed IDs', async () => {
  assert.equal((await request('GET', '', null, '')).status, 401);
  updates = [];
  assert.equal((await request('POST', '', { query: '  APPLE  ', userId: '222222222222222222222222' })).status, 200);
  assert.deepEqual(updates[0][0], { _id: uid });
  const pipeline = updates[0][1][0].$set.searchHistory.$slice;
  assert.equal(pipeline[1], 20);
  const saved = pipeline[0].$concatArrays[0][0].$mergeObjects[1].$literal;
  assert.equal(saved.query, 'APPLE'); assert.equal(saved.key, 'apple');
  assert.equal((await request('POST', '', { query: ' ' })).status, 400);
  assert.equal((await request('PATCH', '/preferences', { enabled: 'false' })).status, 400);
  assert.equal((await request('PATCH', '/preferences', { enabled: false })).status, 200);
  assert.deepEqual(updates.at(-1)[1], { $set: { searchNotificationsEnabled: false } });
  await request('DELETE', '', { query: 'APPLE' });
  assert.deepEqual(updates.at(-1)[1], { $pull: { searchHistory: { key: 'apple' } } });
  await request('DELETE'); assert.deepEqual(updates.at(-1)[1], { $set: { searchHistory: [] } });
});
test('search eligibility enforces delay, retention window and seven-day per-term cooldown', () => {
  const now = new Date(); const entry = { query: 'apple', searchedAt: new Date(+now - DAY) };
  assert.equal(eligibleSearch(entry, now), true);
  assert.equal(eligibleSearch({ ...entry, searchedAt: now }, now), false);
  assert.equal(eligibleSearch({ ...entry, searchedAt: new Date(+now - 31 * DAY) }, now), false);
  assert.equal(eligibleSearch({ ...entry, lastNotifiedAt: new Date(+now - DAY) }, now), false);
});
test('worker persists personal inbox notice with no push token and uses an atomic daily claim', async () => {
  const now = new Date();
  account = { _id: uid, searchHistory: [{ key: 'apple', query: 'Apple', searchedAt: new Date(+now - DAY) }, { key: 'milk', query: 'Milk', searchedAt: new Date(+now - DAY) }] };
  notices = []; sends = []; updates = []; matches = [];
  await runSearchNotifications(now);
  assert.equal(notices.length, 1); assert.equal(sends.length, 0);
  assert.equal(notices[0].user, uid); assert.equal(notices[0].kind, 'search'); assert.equal(notices[0].searchQuery, 'Apple');
  assert.equal(matches[0].searchNotificationsEnabled.$ne, false);
  assert.equal(matches[0].isDemo.$ne, true);
  assert.equal(+matches[0].$or[1].lastSearchNotificationAt.$lte, +now - DAY);
  assert.equal(updates[0][0].searchHistory.$elemMatch.key, 'apple');
  claim = false; notices = []; await runSearchNotifications(now); assert.equal(notices.length, 0);
  claim = true; account.pushToken = 'ExpoPushToken[test]'; await runSearchNotifications(now);
  assert.equal(sends[0][1].data.searchQuery, 'Apple');
  failSave = true; updates = []; await runSearchNotifications(now);
  assert.equal(updates.length, 2); assert.equal(updates[1][1].$set.lastSearchNotificationAt, null);
});
