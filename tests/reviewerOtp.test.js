const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'isolated-review-otp-test-secret-0123456789';
const User = require('../models/User');
const sms = require('../utils/twoFactorSms');
const { identities } = require('../utils/reviewAccess');
const originals = [User.findOne, sms.dispatch2FactorOtpSms, sms.verify2factorSession];
const phone = identities.user.phone;
let account, sends = 0, ip = 0;
User.findOne = ({ phone: requested }) => ({ select: async () => requested === account.phone ? account : null });
sms.dispatch2FactorOtpSms = async () => { sends++; return { kind: 'session', sessionId: 'real-sms-session' }; };
sms.verify2factorSession = async (session, code) => session === 'real-sms-session' && code === '654321';
const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/api/auth', require('../routes/authRoutes'));
const server = app.listen(0, '127.0.0.1');
const ready = new Promise(resolve => server.on('listening', resolve));
async function post(route, body) {
  await ready;
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `127.0.0.${ip}` }, body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text };
}
const start = (extra = {}) => post('send-otp', { phone, mode: 'login', ...extra });
const verify = (extra = {}) => post('verify-otp', { phone, otp: '482619', privacyPolicyAccepted: true, ...extra });
beforeEach(async () => {
  ip++; sends = 0; process.env.ENABLE_REVIEW_ACCOUNTS = 'true';
  account = { _id: '111111111111111111111111', name: 'Review Customer', phone, status: 'active', isDemo: true, isPhoneVerified: true, reviewOtpHash: await bcrypt.hash('482619', 4), async save() {} };
});
test('reviewer uses normal phone/code routes, receives a sandbox session, and can sign in again', async () => {
  assert.equal((await start()).status, 200);
  assert.equal(sends, 0);
  const result = await verify();
  assert.equal(result.status, 200);
  const claims = jwt.verify(result.data.token, process.env.JWT_SECRET);
  assert.equal(claims.role, 'customer'); assert.equal(claims.demo, true);
  assert.equal(result.data.user.reviewOtpHash, undefined); assert.equal(result.data.user.otpExpiresAt, undefined);
  assert.equal(account.privacyPolicyAccepted, true);
  assert.equal((await verify()).status, 400); // A consumed challenge cannot be replayed.
  assert.equal((await start()).status, 200);
  assert.equal((await verify()).status, 200);
  assert.equal(sends, 0);
});
test('reviewer requires a challenge, consent, a valid code and an unexpired challenge', async () => {
  assert.equal((await verify()).status, 400);
  await start();
  assert.equal((await verify({ privacyPolicyAccepted: false })).status, 400);
  assert.equal((await verify({ otp: '000000' })).status, 400);
  assert.equal((await verify({ otp: 'invalid' })).status, 400);
  account.otpExpiresAt = new Date(Date.now() - 1000);
  assert.equal((await verify()).status, 400);
});
test('reviewer is locked after five wrong codes and resend does not reset the limit', async () => {
  await start();
  for (let i = 0; i < 5; i++) assert.equal((await verify({ otp: '000000' })).status, 400);
  assert.equal((await start({ forceResend: true })).status, 200);
  assert.equal(account.otpAttempts, 5);
  assert.equal((await verify()).status, 429);
  account.otpExpiresAt = new Date(Date.now() - 1000);
  await start();
  assert.equal(account.otpAttempts, 0);
  assert.equal((await verify()).status, 200);
});
test('disabled, blocked, unconfigured and non-reserved demo accounts cannot use the code', async () => {
  process.env.ENABLE_REVIEW_ACCOUNTS = 'false';
  assert.equal((await start()).status, 403);
  process.env.ENABLE_REVIEW_ACCOUNTS = 'true';
  await start();
  process.env.ENABLE_REVIEW_ACCOUNTS = 'false';
  assert.equal((await verify()).status, 403);
  process.env.ENABLE_REVIEW_ACCOUNTS = 'true'; account.status = 'blocked';
  assert.equal((await start()).status, 403); assert.equal((await verify()).status, 403);
  account.status = 'active'; account.phone = '+919990000102';
  assert.equal((await start({ phone: account.phone })).status, 403);
  account.phone = phone; account.reviewOtpHash = undefined;
  assert.equal((await start()).status, 403);
  assert.equal(sends, 0);
});
test('a normal customer cannot use the review code even at the reserved phone number', async () => {
  account.isDemo = false;
  assert.equal((await start()).status, 200); assert.equal(sends, 1);
  assert.equal((await verify()).status, 400);
  assert.equal((await verify({ otp: '654321' })).status, 200);
});
test('review sign-in cannot use signup or the removed separate endpoint', async () => {
  assert.equal((await start({ mode: 'signup' })).status, 409);
  assert.equal((await post('review-login', { role: 'user', login: 'review-user', password: 'old' })).status, 404);
  assert.equal(sends, 0);
});
test('shared authentication routes still enforce the IP attempt limit', async () => {
  for (let i = 0; i < 30; i++) assert.equal((await start()).status, 200);
  assert.equal((await start()).status, 429);
});
after(async () => {
  [User.findOne, sms.dispatch2FactorOtpSms, sms.verify2factorSession] = originals;
  await new Promise(resolve => server.close(resolve));
});
