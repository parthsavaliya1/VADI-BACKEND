const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'order-lifecycle-regression-tests';
const Order = require('../models/Orders');
const Payment = require('../models/Payment');
const Product = require('../models/Product');
const SellerLedger = require('../models/SellerLedger');
const Admin = require('../models/Admin');
const User = require('../models/User');
const wallet = require('../utils/wallet');
const notify = require('../utils/orderNotify');
const gateway = require('../utils/razorpayRefund');
const ensureOriginalRefundForTest = gateway.ensureOriginalRefund;
const Seller = require('../models/Seller');
const CommissionSettings = require('../models/CommissionSettings');
const uid = '111111111111111111111111', oid = '222222222222222222222222';
const pid = '333333333333333333333333', vid = '444444444444444444444444';
const sid = '555555555555555555555555', aid = 'aaaaaaaaaaaaaaaaaaaaaaaa';
let state;
const originals = [];
function stub(object, key, value) { originals.push([object, key, object[key]]); object[key] = value; }
function query(get) { return { session() { return this; }, select() { return this; }, populate() { return this; },
  lean: async () => get(), then(resolve, reject) { return Promise.resolve().then(get).then(resolve, reject); } }; }
function matches(object, filter) {
  return Object.entries(filter).every(([key, value]) => {
    const actual = key.split('.').reduce((node, part) => node?.[part], object);
    if (value?.$ne !== undefined) return String(actual) !== String(value.$ne);
    if (value?.$exists !== undefined) return value.$exists ? actual !== undefined : actual === undefined;
    return String(actual) === String(value);
  });
}
function patch(object, update) {
  for (const [key, value] of Object.entries(update.$set || {})) {
    const parts = key.split('.'); let cursor = object;
    for (const part of parts.slice(0, -1)) cursor = cursor[part] ||= {};
    cursor[parts.at(-1)] = value;
  }
  for (const [key, value] of Object.entries(update.$push || {})) (object[key] ||= []).push(value);
}
stub(mongoose, 'startSession', async () => ({
  async withTransaction(run) { const snapshot = structuredClone(state); try { return await run(); } catch (error) { state = snapshot; throw error; } },
  async endSession() {},
}));
stub(Order, 'findById', (id) => query(() => id === oid ? state.order : null));
stub(Order, 'findOneAndUpdate', async (filter, update) => {
  if (!matches(state.order, filter)) return null; patch(state.order, update); return state.order;
});
stub(Order, 'updateOne', async (filter, update) => {
  if (!matches(state.order, filter)) return { modifiedCount: 0 };
  patch(state.order, update); return { modifiedCount: 1 };
});
stub(Payment, 'findOne', () => query(() => state.payment));
stub(Payment, 'updateMany', async (_filter, update) => { if (state.payment) patch(state.payment, update); return { modifiedCount: 1 }; });
stub(Payment, 'updateOne', async (_filter, update) => { patch(state.payment, update); return { modifiedCount: 1 }; });
stub(Product, 'updateOne', async (_filter, update) => {
  if (state.productMissing) return { matchedCount: 0 };
  state.stock += update.$inc['variants.$.stock']; return { matchedCount: 1 };
});
stub(SellerLedger, 'find', () => query(() => state.ledgers));
stub(SellerLedger, 'updateMany', async (filter, update) => { for (const row of state.ledgers.filter((row) => matches(row, filter))) patch(row, update); });
stub(SellerLedger, 'updateOne', async (filter, update) => { const row = state.ledgers.find((row) => matches(row, filter)); if (row) patch(row, update); });
stub(Seller, 'find', () => query(() => [{ _id: sid, name: 'Seller', commissionPercent: 25 }]));
stub(CommissionSettings, 'findOne', async () => ({ defaultCommissionPercent: 10 }));
stub(wallet, 'creditWallet', async ({ amount }) => { state.balance += amount; state.walletCredits++; });
stub(notify, 'notifyOrderStatus', async () => {});
stub(gateway, 'ensureOriginalRefund', async ({ amount, paymentId, receipt }) => {
  state.gatewayCalls = (state.gatewayCalls || 0) + 1;
  if (state.gatewayError) throw Object.assign(new Error('Gateway confirmation unavailable'), { statusCode: 502 });
  state.gatewayTransfers ||= 1;
  return { id: 'rfnd_test', amount: Math.round(amount * 100), payment_id: paymentId, receipt, currency: 'INR', status: state.gatewayPending ? 'pending' : 'processed' };
});
stub(Admin, 'findById', (id) => query(() => id === aid ? { _id: aid } : null));
stub(User, 'findById', (id) => query(() => ({ _id: id, status: 'active', isDemo: false })));
const { customerToken } = require('../middleware/sessionAuth');
const { reopenDeliveredOrder } = require('../utils/orderCorrections');
const { validateReturnItems, quoteReturn, resolveOrderReturn } = require('../utils/orderReturns');

function fixture() {
  return { stock: 8, balance: 0, walletCredits: 0,
    order: { _id: oid, user: uid, status: 'delivered', orderNumber: 'ORD-TEST', deliveredAt: new Date(),
      deliveryHandoverGeneratedAt: new Date(), deliveryHandoverVerifiedAt: new Date(), deliveredByDriver: aid,
      items: [{ product: pid, variantId: vid, productName: 'Tomato', quantity: 2, subtotal: 100, seller: { sellerId: sid } }],
      grandTotal: 110, deliveryFee: 20, commissionSettled: true, commissionReversed: false,
      settlements: [{ sellerId: sid, gross: 100, commissionPercent: 10, commissionAmount: 10, sellerAmount: 90 }],
      payment: { method: 'cod', status: 'paid', isCod: true, codCollected: true },
      returnRequest: { status: 'pending', reason: 'Damaged sealed pack', items: [{ variantId: vid, quantity: 2, action: 'refund' }] } },
    payment: { _id: aid, order: oid, status: 'success', amount: 110, codCollected: true },
    ledgers: [{ _id: sid, order: oid, seller: sid, gross: 100, commissionAmount: 10, sellerAmount: 90, status: 'credited' }],
  };
}
beforeEach(() => { state = fixture(); });

test('return selections reject duplicates, fractional quantities, missing items and unknown actions', () => {
  const item = state.order.returnRequest.items[0];
  for (const items of [[], [item, item], [{ ...item, quantity: 0.5 }], [{ ...item, quantity: 3 }], [{ ...item, action: 'cash' }]]) {
    assert.throws(() => validateReturnItems(state.order, items));
  }
});
test('refund quote accounts for coupons and delivery; replacement-only refund is zero', () => {
  state.order.returnRequest.items[0].quantity = 1;
  assert.equal(quoteReturn(state.order).amount, 45); // ₹90 paid merchandise, half returned.
  state.order.returnRequest.items[0].quantity = 2;
  assert.equal(quoteReturn(state.order).amount, 90); // ₹20 delivery is retained, even when all products are returned.
  state.order.returnRequest.items[0].action = 'replace';
  assert.equal(quoteReturn(state.order).amount, 0);
  assert.equal(quoteReturn(state.order).fullRefund, false);
});
test('full paid return credits wallet once, reconciles payment and reverses seller credit', async () => {
  const result = await resolveOrderReturn({ id: oid, action: 'approve', adminId: aid });
  assert.equal(result.refundAmount, 90);
  assert.equal(state.balance, 90);
  assert.equal(state.order.status, 'returned');
  assert.equal(state.order.payment.status, 'paid');
  assert.equal(state.payment.status, 'partial_refund');
  assert.equal(state.ledgers[0].status, 'reversed');
  assert.equal(state.stock, 8);
  await assert.rejects(resolveOrderReturn({ id: oid, action: 'approve', adminId: aid }), /already been resolved|only for delivered/);
  assert.equal(state.walletCredits, 1);
});
test('all-product return with free delivery refunds the full payment', async () => {
  state.order.deliveryFee = 0; state.order.grandTotal = 90; state.payment.amount = 90;
  await resolveOrderReturn({ id: oid, action: 'approve', adminId: aid });
  assert.equal(state.balance, 90);
  assert.equal(state.payment.status, 'refunded');
  assert.equal(state.order.payment.status, 'refunded');
  assert.equal(state.order.status, 'returned');
});
test('partial paid return keeps remaining payment, adjusts seller earnings and restocks only selected quantity', async () => {
  state.order.returnRequest.items[0].quantity = 1;
  await resolveOrderReturn({ id: oid, action: 'approve', restock: true, adminId: aid });
  assert.equal(state.balance, 45);
  assert.equal(state.payment.status, 'partial_refund');
  assert.equal(state.order.payment.status, 'paid');
  assert.equal(state.order.status, 'delivered');
  assert.equal(state.stock, 9);
  assert.equal(state.ledgers[0].sellerAmount, 45);
  assert.equal(state.order.platformCommission, 5);
});
test('online returns refund the original payment without a wallet credit', async () => {
  state.order.payment.method = 'upi'; state.payment.gateway = { paymentId: 'pay_original' };
  await resolveOrderReturn({ id: oid, action: 'approve', adminId: aid });
  assert.equal(state.balance, 0);
  assert.equal(state.payment.refund.destination, 'original');
  assert.equal(state.payment.refund.amount, 90);
  assert.equal(state.payment.status, 'partial_refund');
  assert.equal(state.payment.refund.gatewayRefundId, 'rfnd_test');
  assert.equal(state.order.returnRequest.refundedTo, 'original');
  assert.equal(state.gatewayTransfers, 1);
});
test('pending and uncertain original refunds remain resumable and never fall back to wallet', async () => {
  state.order.payment.method = 'card'; state.payment.gateway = { paymentId: 'pay_original' }; state.gatewayPending = true;
  const result = await resolveOrderReturn({ id: oid, action: 'approve', adminId: aid });
  assert.equal(result.processing, true); assert.equal(state.order.returnRequest.status, 'processing');
  assert.equal(state.balance, 0); assert.equal(state.order.payment.status, 'paid');
  state.gatewayPending = false;
  await resolveOrderReturn({ id: oid, action: 'approve', adminId: aid });
  assert.equal(state.order.returnRequest.status, 'approved'); assert.equal(state.gatewayTransfers, 1);
  state = fixture(); state.order.payment.method = 'upi'; state.payment.gateway = { paymentId: 'pay_original' }; state.gatewayError = true;
  await assert.rejects(resolveOrderReturn({ id: oid, action: 'approve', adminId: aid }), /unavailable/);
  assert.equal(state.balance, 0); assert.equal(state.order.returnRequest.status, 'processing');
});
test('VADI balance payments refund the original internal wallet', async () => {
  state.order.payment.method = 'balance';
  await resolveOrderReturn({ id: oid, action: 'approve', adminId: aid });
  assert.equal(state.balance, 90); assert.equal(state.order.returnRequest.refundedTo, 'wallet');
});
test('rejections and replacements issue no refund', async () => {
  await resolveOrderReturn({ id: oid, action: 'reject', adminId: aid });
  assert.equal(state.balance, 0); assert.equal(state.stock, 8); assert.equal(state.order.returnRequest.status, 'rejected');
  state = fixture(); state.order.returnRequest.items[0].action = 'replace';
  await resolveOrderReturn({ id: oid, action: 'approve', adminId: aid });
  assert.equal(state.balance, 0); assert.equal(state.order.status, 'delivered'); assert.equal(state.payment.status, 'success');
});
test('uncollected COD does not receive a refund and a prior refund cannot be paid twice', async () => {
  state.order.payment.status = 'pending'; state.order.payment.codCollected = false; state.payment.status = 'pending';
  await resolveOrderReturn({ id: oid, action: 'approve', adminId: aid });
  assert.equal(state.balance, 0); assert.equal(state.order.payment.status, 'cancelled');
  state = fixture(); state.payment.refund = { amount: 10 };
  await assert.rejects(resolveOrderReturn({ id: oid, action: 'approve', adminId: aid }), /already recorded/);
  assert.equal(state.balance, 0); assert.equal(state.order.returnRequest.status, 'pending');
});
test('stock failure rolls back wallet, payment and return changes together', async () => {
  state.productMissing = true;
  await assert.rejects(resolveOrderReturn({ id: oid, action: 'approve', restock: true, adminId: aid }), /Cannot restock/);
  assert.equal(state.balance, 0); assert.equal(state.payment.status, 'success'); assert.equal(state.order.returnRequest.status, 'pending');
});
test('reopening unpaid COD resets delivery and payment, preserves stock and records the administrator', async () => {
  delete state.order.returnRequest;
  await reopenDeliveredOrder({ id: oid, adminId: aid, status: 'confirmed', reason: 'Clicked delivered by mistake', codCollected: false });
  assert.equal(state.order.status, 'confirmed'); assert.equal(state.order.deliveredAt, null);
  assert.equal(state.order.deliveryHandoverVerifiedAt, null); assert.equal(state.order.payment.status, 'pending');
  assert.equal(state.payment.codCollected, false); assert.equal(state.stock, 8); assert.equal(state.balance, 0);
  assert.equal(state.ledgers[0].status, 'reversed'); assert.equal(state.order.commissionSettled, false);
  assert.equal(state.order.statusHistory[0].changedBy, aid);
});
test('reopening prepaid or actually collected COD preserves the received payment and commission', async () => {
  delete state.order.returnRequest; state.order.payment.method = 'card';
  await reopenDeliveredOrder({ id: oid, adminId: aid, status: 'confirmed', reason: 'Delivery was selected by mistake' });
  assert.equal(state.order.payment.status, 'paid'); assert.equal(state.ledgers[0].status, 'credited');
  state = fixture(); delete state.order.returnRequest;
  await reopenDeliveredOrder({ id: oid, adminId: aid, status: 'packed', reason: 'Incorrect delivery status', codCollected: true });
  assert.equal(state.order.payment.status, 'paid'); assert.equal(state.payment.codCollected, true);
});
test('reopen validates reason, COD choice and terminal/refunded/return states', async () => {
  const args = { id: oid, adminId: aid, status: 'confirmed', reason: 'Incorrect delivery status', codCollected: false };
  await assert.rejects(reopenDeliveredOrder(args), /Resolve the return/);
  delete state.order.returnRequest;
  await assert.rejects(reopenDeliveredOrder({ ...args, reason: 'x' }), /reason/);
  await assert.rejects(reopenDeliveredOrder({ ...args, codCollected: undefined }), /actually collected/);
  state.payment.status = 'partial_refund';
  await assert.rejects(reopenDeliveredOrder(args), /refunded order/);
  state.payment.status = 'success'; state.order.status = 'cancelled';
  await assert.rejects(reopenDeliveredOrder(args), /Only a delivered/);
});
test('a rejected request is preserved in correction history and cleared for a future delivery return', async () => {
  state.order.returnRequest.status = 'rejected';
  await reopenDeliveredOrder({ id: oid, adminId: aid, status: 'confirmed', reason: 'Wrong delivery date', codCollected: true });
  assert.equal(state.order.returnRequest, null);
  assert.equal(state.order.statusHistory[0].previousReturnRequest.status, 'rejected');
});

test('COD document saves preserve collected and refunded states', async () => {
  stub(Order.collection, 'insertOne', async () => ({ acknowledged: true }));
  stub(Order.collection, 'updateOne', async () => ({ acknowledged: true, matchedCount: 1 }));
  stub(Payment.collection, 'insertOne', async () => ({ acknowledged: true }));
  stub(Payment.collection, 'updateOne', async () => ({ acknowledged: true, matchedCount: 1 }));
  const doc = new Order({ user: uid, items: [{ product: pid, variantId: vid, productName: 'Tomato', unitPrice: 50, quantity: 2, subtotal: 100, seller: { sellerId: sid } }], totalItems: 1, totalQuantity: 2, subtotal: 100, grandTotal: 110,
    payment: { method: 'cod', status: 'paid', codCollected: true }, address: { addressId: aid } });
  await doc.save(); assert.equal(doc.payment.status, 'paid');
  doc.payment.status = 'refunded'; await doc.save(); assert.equal(doc.payment.status, 'refunded');
  const payment = new Payment({ user: uid, order: oid, amount: 110, method: 'cod', status: 'success', codCollected: true });
  await payment.save(); assert.equal(payment.status, 'success');
  payment.status = 'refunded'; await payment.save(); assert.equal(payment.status, 'refunded');
});
test('COD settlement is credited again once after an unpaid delivery correction, using its locked rate', async () => {
  delete state.order.returnRequest;
  await reopenDeliveredOrder({ id: oid, adminId: aid, status: 'confirmed', reason: 'Wrong delivered status', codCollected: false });
  state.order.payment.status = 'paid'; state.order.payment.codCollected = true;
  const { settleOrderCommission } = require('../utils/commission');
  await settleOrderCommission(oid);
  assert.equal(state.ledgers[0].status, 'credited'); assert.equal(state.order.commissionSettled, true);
  assert.equal(state.ledgers[0].commissionAmount, 10);
  await settleOrderCommission(oid); assert.equal(state.ledgers.length, 1);
});
test('gateway retries reconcile the same receipt after a lost response', async () => {
  const receipts = []; let creates = 0;
  const client = { payments: {
    fetchMultipleRefund: async () => ({ items: receipts }),
    refund: async (_id, body) => { creates++; receipts.push({ id: 'rfnd_once', payment_id: 'pay_test', currency: 'INR', status: 'processed', ...body }); throw new Error('response lost'); },
  } };
  const args = { paymentId: 'pay_test', amount: 110, receipt: `return_${oid}` };
  const first = await ensureOriginalRefundForTest(args, client);
  const second = await ensureOriginalRefundForTest(args, client);
  assert.equal(first.id, second.id); assert.equal(creates, 1);
});
test('gateway pending status is retained and mismatched or failed refunds are rejected', async () => {
  const refund = { id: 'rfnd_existing', payment_id: 'pay_test', currency: 'INR', receipt: `return_${oid}`, amount: 11000, status: 'pending' };
  const client = { payments: { fetchMultipleRefund: async () => ({ items: [refund] }), refund: async () => { throw new Error('Must not create a second refund'); } } };
  const args = { paymentId: 'pay_test', amount: 110, receipt: `return_${oid}` };
  assert.equal((await ensureOriginalRefundForTest(args, client)).status, 'pending');
  refund.amount = 100;
  await assert.rejects(ensureOriginalRefundForTest(args, client), /does not match/);
  refund.amount = 11000; refund.status = 'failed';
  await assert.rejects(ensureOriginalRefundForTest(args, client), /failed/);
});

const app = express(); app.use(express.json());
app.use('/api/admin', require('../routes/adminPanelRoutes'));
const server = app.listen(0, '127.0.0.1');
const ready = new Promise((resolve) => server.on('listening', resolve));
async function call(token) {
  await ready;
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/orders/${oid}/reopen`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ status: 'confirmed', reason: 'Wrong delivery status', codCollected: false, adminId: uid }),
  });
  return { status: response.status, body: await response.json() };
}
test('only authenticated admin can reopen and the audit cannot impersonate another administrator', async () => {
  delete state.order.returnRequest;
  assert.equal((await call(null)).status, 401);
  assert.equal((await call(customerToken({ _id: uid }))).status, 403);
  assert.equal((await call(jwt.sign({ id: aid, role: 'admin' }, process.env.JWT_SECRET))).status, 200);
  assert.equal(state.order.statusHistory[0].changedBy, aid);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const [object, key, value] of originals.reverse()) object[key] = value;
});
