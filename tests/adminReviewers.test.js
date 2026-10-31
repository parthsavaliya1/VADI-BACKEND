const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'admin-reviewer-regression-secret-0123456789';
process.env.ENABLE_REVIEW_ACCOUNTS = 'false';
const User = require('../models/User');
const Admin = require('../models/Admin');
const Category = require('../models/Category');
const ReviewSandbox = require('../models/ReviewSandbox');
const sms = require('../utils/twoFactorSms');
const { customerToken } = require('../middleware/sessionAuth');
const originals = [];
function stub(object, key, value) { originals.push([object, key, object[key]]); object[key] = value; }
let accounts, states, ip = 0, sequence = 10, sends = 0;
const adminId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const realId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const adminToken = jwt.sign({ id: adminId, role: 'admin' }, process.env.JWT_SECRET);
function query(get) {
  return { select() { return this; }, sort() { return this; }, async lean() { return get(); }, then(resolve, reject) { return Promise.resolve().then(get).then(resolve, reject); } };
}
const matches = (record, filter) => Object.entries(filter).every(([key, value]) => String(record[key]) === String(value));
stub(User, 'find', filter => query(() => [...accounts.values()].filter(record => matches(record, filter))));
stub(User, 'findOne', filter => query(() => [...accounts.values()].find(record => matches(record, filter)) || null));
stub(User, 'findById', id => query(() => accounts.get(String(id)) || null));
stub(User, 'exists', async filter => [...accounts.values()].some(record => matches(record, filter)));
stub(User, 'create', async value => {
  const account = { ...value, _id: (++sequence).toString(16).padStart(24, '0'), async save() {} };
  accounts.set(account._id, account); return account;
});
stub(User, 'findOneAndUpdate', (filter, update) => query(() => {
  const account = [...accounts.values()].find(record => matches(record, filter));
  if (!account) return null;
  Object.assign(account, update.$set); return account;
}));
stub(Admin, 'findById', id => query(() => id === adminId ? { _id: adminId } : null));
stub(Category, 'findOne', () => query(() => null));
stub(ReviewSandbox, 'findById', async id => states.get(id) || null);
stub(ReviewSandbox, 'findOneAndUpdate', async (filter, update) => {
  const value = { ...update.$setOnInsert, markModified() {}, async save() {} };
  states.set(filter._id, value); return value;
});
stub(sms, 'dispatch2FactorOtpSms', async () => { sends++; throw new Error('Reviewer must not send SMS'); });
const app = express(); app.set('trust proxy', true); app.use(express.json());
app.use('/api/admin/reviewers', require('../routes/adminReviewerRoutes'));
app.use('/api/auth', require('../routes/authRoutes'));
app.use('/orders', require('../middleware/mobileAccess')('orders'), (_req, res) => res.json({ live: true }));
const server = app.listen(0, '127.0.0.1');
const ready = new Promise(resolve => server.on('listening', resolve));
async function call(path, { method = 'GET', token = adminToken, body } = {}) {
  await ready;
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'X-Forwarded-For': `127.0.0.${ip}`, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const create = (extra = {}) => call('/api/admin/reviewers', { method: 'POST', body: { name: 'Reviewer', phone: '9990000201', code: '135790', enabled: true, ...extra } });
const update = (id, body) => call(`/api/admin/reviewers/${id}`, { method: 'PUT', body });
async function login(phone = '9990000201', otp = '135790') {
  const challenge = await call('/api/auth/send-otp', { method: 'POST', token: null, body: { phone, mode: 'login' } });
  if (challenge.status !== 200) return challenge;
  return call('/api/auth/verify-otp', { method: 'POST', token: null, body: { phone, otp, privacyPolicyAccepted: true } });
}
beforeEach(() => {
  ip++; sends = 0; states = new Map(); accounts = new Map([[realId, { _id: realId, phone: '+919876543210', status: 'active', isDemo: false }]]);
});
test('reviewer settings require an authenticated administrator', async () => {
  assert.equal((await call('/api/admin/reviewers', { token: null })).status, 401);
  const customer = customerToken(accounts.get(realId));
  assert.equal((await call('/api/admin/reviewers', { token: customer })).status, 403);
  assert.equal((await call('/api/admin/reviewers', { token: customer, method: 'POST', body: {} })).status, 403);
  assert.equal((await call('/api/admin/reviewers', { token: 'forged' })).status, 401);
});
test('admin creates and lists reviewers without returning codes or hashes', async () => {
  const result = await create(); assert.equal(result.status, 201);
  assert.equal(result.data.data.phone, '+919990000201'); assert.equal(result.data.data.enabled, true);
  const saved = accounts.get(result.data.data._id);
  assert.equal(saved.isDemo, true); assert.equal(saved.role, 'user'); assert.notEqual(saved.reviewOtpHash, '135790');
  const list = await call('/api/admin/reviewers'); assert.equal(list.data.data.length, 1);
  assert.equal(list.data.data[0].reviewOtpHash, undefined); assert.equal(list.data.data[0].code, undefined);
  const session = await login(); assert.equal(session.status, 200); assert.equal(sends, 0);
  assert.equal(jwt.verify(session.data.token, process.env.JWT_SECRET).demo, true);
});
test('admin controls override the legacy environment flag and disabling blocks existing sessions', async () => {
  const created = await create(); const id = created.data.data._id;
  const session = await login(); assert.equal(session.status, 200);
  const token = session.data.token;
  assert.equal((await call('/orders', { token })).status, 200);
  assert.equal((await update(id, { enabled: false })).status, 200);
  assert.equal((await login()).status, 403);
  assert.equal((await call('/orders', { token })).status, 403);
  assert.equal((await update(id, { enabled: true })).status, 200);
  assert.equal((await login()).status, 200);
});
test('admin can reset a code and edit a name without changing the phone or customer role', async () => {
  const created = await create(); const id = created.data.data._id;
  await call('/api/auth/send-otp', { method: 'POST', body: { phone: '9990000201', mode: 'login' } });
  const result = await update(id, { name: 'Updated reviewer', code: '024681', phone: '9990000999', role: 'admin', isDemo: false });
  assert.equal(result.status, 200); assert.equal(result.data.data.name, 'Updated reviewer');
  const saved = accounts.get(id); assert.equal(saved.otpExpiresAt, null); assert.equal(saved.phone, '+919990000201'); assert.equal(saved.role, 'user'); assert.equal(saved.isDemo, true);
  assert.equal((await login()).status, 400);
  assert.equal((await login('9990000201', '024681')).status, 200);
});
test('reviewers cannot overwrite real accounts and invalid inputs are rejected', async () => {
  assert.equal((await create({ phone: '9876543210' })).status, 409);
  assert.equal((await update(realId, { enabled: true })).status, 404);
  for (const extra of [{ name: '' }, { phone: '12345' }, { code: '12' }, { code: 135790 }, { enabled: 'true' }]) assert.equal((await create(extra)).status, 400);
  const created = await create(); const id = created.data.data._id;
  assert.equal((await create()).status, 409);
  assert.equal((await update(id, { enabled: 'true' })).status, 400);
  assert.equal((await update(id, { code: 'bad' })).status, 400);
  assert.equal((await update('invalid', { enabled: true })).status, 400);
  accounts.get(id).status = 'blocked'; assert.equal((await update(id, { enabled: true })).status, 409);
});
test('legacy reviewers can be migrated by setting a code in admin without a setup script', async () => {
  const id = 'cccccccccccccccccccccccc';
  accounts.set(id, { _id: id, name: 'Legacy review', phone: '+919990000101', status: 'active', isDemo: true, async save() {} });
  assert.equal((await update(id, { enabled: true })).status, 400);
  assert.equal((await update(id, { code: '123456', enabled: true })).status, 200);
  assert.equal((await login('9990000101', '123456')).status, 200);
});
test('each reviewer receives independent sandbox orders and wallet state', async () => {
  const first = await create(); const second = await create({ phone: '9990000202', name: 'Second review' });
  const firstSession = await login(); const secondSession = await login('9990000202');
  const firstOrders = await call('/orders', { token: firstSession.data.token });
  const secondOrders = await call('/orders', { token: secondSession.data.token });
  assert.equal(firstOrders.status, 200); assert.equal(secondOrders.status, 200);
  assert.equal(firstOrders.data.data[0].user, first.data.data._id);
  assert.equal(secondOrders.data.data[0].user, second.data.data._id);
  assert.notEqual(firstOrders.data.data[0]._id, secondOrders.data.data[0]._id);
  assert.equal(states.size, 2);
  const firstState = states.get(`play-review-${first.data.data._id}`);
  const secondState = states.get(`play-review-${second.data.data._id}`);
  firstState.data.wallet = 1; assert.equal(secondState.data.wallet, 500);
});
after(async () => { for (const [object, key, value] of originals) object[key] = value; await new Promise(resolve => server.close(resolve)); });
