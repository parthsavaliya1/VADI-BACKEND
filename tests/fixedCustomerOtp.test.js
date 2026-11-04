const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'isolated-fixed-customer-otp-test-secret';
const User = require('../models/User');
const sms = require('../utils/twoFactorSms');
const originals = [User.findOne, User.create, sms.dispatch2FactorOtpSms, sms.verify2factorSession];
const phone = '+919909049699';
let account, sends, verifies, ip = 0;
User.findOne = ({ phone: requested }) => ({ select: async () => account?.phone === requested ? account : null });
User.create = async data => {
  account = { _id: '111111111111111111111111', status: 'active', isDemo: false, ...data, async save() {} };
  return account;
};
sms.dispatch2FactorOtpSms = async () => { sends++; return { kind: 'session', sessionId: 'normal-sms-session' }; };
sms.verify2factorSession = async (_, otp) => { verifies++; return otp === '654321'; };
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
  return { status: response.status, data: await response.json() };
}
const send = (extra = {}) => post('send-otp', { phone, mode: 'login', ...extra });
const verify = (extra = {}) => post('verify-otp', { phone, otp: '111298', ...extra });
beforeEach(() => {
  ip++; sends = 0; verifies = 0;
  account = { _id: '111111111111111111111111', phone, name: 'Customer', status: 'active', isPhoneVerified: true, isDemo: false, async save() {} };
});

test('designated phone uses the fixed code without SMS, receives a customer session, and cannot replay it', async () => {
  assert.equal((await verify()).status, 400);
  assert.equal((await send({ phone: '9909049699' })).status, 200);
  assert.equal(sends, 0);
  assert.equal((await verify({ otp: '000000' })).status, 400);
  const result = await verify();
  assert.equal(result.status, 200);
  const claims = jwt.verify(result.data.token, process.env.JWT_SECRET);
  assert.equal(claims.id, account._id);
  assert.equal(claims.role, 'customer');
  assert.equal(claims.aud, 'vadi-mobile');
  assert.equal(result.data.user.otp, undefined);
  assert.equal(result.data.user.otpSessionId, undefined);
  assert.equal(sends, 0); assert.equal(verifies, 0);
  assert.equal((await verify()).status, 400);
  assert.equal((await send()).status, 200);
  assert.equal((await verify()).status, 200);
});

test('fixed challenge expires and resend cannot reset five wrong attempts', async () => {
  await send();
  for (let n = 0; n < 5; n++) assert.equal((await verify({ otp: '000000' })).status, 400);
  const expiry = account.otpExpiresAt.getTime();
  await send({ forceResend: true });
  assert.equal(account.otpAttempts, 5);
  assert.equal(account.otpExpiresAt.getTime(), expiry);
  assert.equal((await verify()).status, 429);
  account.otpExpiresAt = new Date(Date.now() - 1000);
  assert.equal((await verify()).status, 400);
  await send();
  assert.equal(account.otpAttempts, 0);
  assert.equal((await verify()).status, 200);
});

test('fixed code requires an exact six-digit string', async () => {
  await send();
  for (const otp of ['1112980', 'x111298', 111298]) assert.equal((await verify({ otp })).status, 400);
  assert.equal((await verify()).status, 200);
});

test('other phone numbers continue using SMS and reject the designated fixed code', async () => {
  account.phone = '+919876543210';
  assert.equal((await send({ phone: account.phone })).status, 200);
  assert.equal(sends, 1);
  assert.equal((await verify({ phone: account.phone })).status, 400);
  assert.equal((await verify({ phone: account.phone, otp: '654321' })).status, 200);
});

test('blocked accounts remain blocked and login does not create an account', async () => {
  account.status = 'blocked';
  assert.equal((await send()).status, 403);
  account.status = 'active';
  await send();
  account.status = 'blocked';
  assert.equal((await verify()).status, 403);
  account = null;
  assert.equal((await send()).status, 404);
  assert.equal(account, null);
  assert.equal(sends, 0);
});

test('new designated phone can obtain a verified signup session without SMS', async () => {
  account = null;
  assert.equal((await send({ mode: 'signup' })).status, 200);
  const result = await verify();
  assert.equal(result.status, 200);
  assert.equal(result.data.isNewUser, true);
  assert.equal(account.isPhoneVerified, true);
  assert.equal(jwt.verify(result.data.token, process.env.JWT_SECRET).role, 'customer');
  assert.equal(sends, 0);
});

after(async () => {
  [User.findOne, User.create, sms.dispatch2FactorOtpSms, sms.verify2factorSession] = originals;
  await new Promise(resolve => server.close(resolve));
});
