const mongoose = require('mongoose');
const Order = require('../models/Orders');
const Payment = require('../models/Payment');
const Product = require('../models/Product');
const SellerLedger = require('../models/SellerLedger');
const { creditWallet } = require('./wallet');
const { ensureOriginalRefund } = require('./razorpayRefund');

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }

function validateReturnItems(order, requested, allowLegacyFull = false) {
  if (!Array.isArray(requested) || !requested.length) {
    if (!allowLegacyFull) fail('Select at least one item to return');
    requested = order.items.map((line) => ({ variantId: line.variantId, quantity: line.quantity, action: 'refund' }));
  }
  const seen = new Set();
  return requested.map((item) => {
    const key = String(item.variantId);
    const line = order.items.find((line) => String(line.variantId) === key);
    if (!line || seen.has(key) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > line.quantity ||
        !['refund', 'replace'].includes(item.action)) fail('Choose unique order items, whole quantities and a valid refund or replacement action');
    seen.add(key);
    return { variantId: line.variantId, quantity: item.quantity, action: item.action, productName: line.productName };
  });
}

function quoteReturn(order) {
  const items = validateReturnItems(order, order.returnRequest?.items, true);
  const fullRefund = order.items.every((line) => items.some((item) => String(item.variantId) === String(line.variantId) && item.action === 'refund' && item.quantity === line.quantity));
  const gross = order.items.reduce((sum, line) => sum + Number(line.subtotal), 0);
  const refundedGross = items.reduce((sum, item) => {
    const line = order.items.find((line) => String(line.variantId) === String(item.variantId));
    return sum + (item.action === 'refund' ? Number(line.subtotal) * item.quantity / line.quantity : 0);
  }, 0);
  const merchandisePaid = Math.max(0, Number(order.grandTotal) - Number(order.deliveryFee || 0));
  const amount = fullRefund ? merchandisePaid : (gross > 0 ? merchandisePaid * refundedGross / gross : 0);
  if (!Number.isFinite(amount) || amount < 0) fail('Order prices are invalid; review this order before refunding');
  return { items, fullRefund, amount: Math.min(Number(order.grandTotal), money(amount)) };
}

async function adjustReturnCommission(order, plan, session) {
  if (!order.commissionSettled || order.commissionReversed) return {};
  const ledgers = await SellerLedger.find({ order: order._id, status: 'credited' }).session(session).lean();
  if (plan.fullRefund) {
    await SellerLedger.updateMany({ order: order._id, status: 'credited' }, { $set: { status: 'reversed' } }, { session });
    return { commissionReversed: true };
  }
  const settlements = (order.settlements || []).map((row) => row.toObject ? row.toObject() : { ...row });
  for (const ledger of ledgers) {
    const sellerLines = order.items.filter((line) => String(line.seller?.sellerId) === String(ledger.seller));
    const originalGross = sellerLines.reduce((sum, line) => sum + Number(line.subtotal), 0);
    const returnedGross = sellerLines.reduce((sum, line) => {
      const item = plan.items.find((item) => String(item.variantId) === String(line.variantId) && item.action === 'refund');
      return sum + (item ? Number(line.subtotal) * item.quantity / line.quantity : 0);
    }, 0);
    const remaining = originalGross > 0 ? Math.max(0, 1 - returnedGross / originalGross) : 1;
    const gross = money(ledger.gross * remaining);
    const commissionAmount = money(ledger.commissionAmount * remaining);
    const sellerAmount = money(gross - commissionAmount);
    await SellerLedger.updateOne({ _id: ledger._id }, { $set: { gross, commissionAmount, sellerAmount,
      status: remaining === 0 ? 'reversed' : 'credited' } }, { session });
    const settlement = settlements.find((row) => String(row.sellerId) === String(ledger.seller));
    if (settlement) Object.assign(settlement, { gross, commissionAmount, sellerAmount });
  }
  return { settlements, platformCommission: money(settlements.reduce((sum, row) => sum + row.commissionAmount, 0)),
    sellerPayoutTotal: money(settlements.reduce((sum, row) => sum + row.sellerAmount, 0)) };
}

async function resolveOrderReturn({ id, action, adminNote = '', restock = false, adminId }) {
  if (!mongoose.isObjectIdOrHexString(id)) fail('Invalid order ID');
  if (!['approve', 'reject'].includes(action)) fail('Choose approve or reject');
  if (typeof adminNote !== 'string' || adminNote.length > 1000 || typeof restock !== 'boolean') fail('Invalid return details');
  let gatewayRefund = null;
  const candidate = await Order.findById(id);
  if (!candidate) fail('Order not found', 404);
  if (candidate.status !== 'delivered') fail('Returns can be resolved only for delivered orders', 409);
  const online = ['upi', 'card', 'wallet'].includes(candidate.payment.method);
  const candidatePayment = await Payment.findOne({ order: id });
  if (['refunded', 'partial_refund'].includes(candidatePayment?.status) || candidatePayment?.refund?.amount > 0 || candidate.payment.status === 'refunded') {
    fail('A refund is already recorded. Review it before issuing another.', 409);
  }
  const candidatePaid = candidate.payment.status === 'paid' || candidatePayment?.status === 'success';
  const pendingGateway = candidate.returnRequest?.status === 'processing';
  if (pendingGateway && (!online || !candidate.returnRequest.refundOperation?.receipt || action !== 'approve')) {
    fail('This return is processing. Reconcile the original refund before changing it.', 409);
  }
  if (!['pending', 'processing'].includes(candidate.returnRequest?.status)) fail('This return has already been resolved or does not exist', 409);
  if (action === 'approve' && online && candidatePaid) {
    const plan = quoteReturn(candidate);
    if (plan.amount > 0) {
      const operation = pendingGateway ? candidate.returnRequest.refundOperation : {
        receipt: `return_${id}`, amount: plan.amount,
        paymentId: candidate.payment.transactionId || candidatePayment?.gateway?.paymentId,
        adminNote: adminNote.trim(), restock,
      };
      if (!candidatePayment || !operation.paymentId || operation.amount > Number(candidatePayment.amount) || operation.amount !== plan.amount) {
        fail('Payment reference or refund amount is invalid. Reconcile this payment first.', 409);
      }
      if (pendingGateway && operation.restock && !restock) {
        operation.restock = false;
        await Order.updateOne({ _id: id, 'returnRequest.status': 'processing' }, { $set: { 'returnRequest.refundOperation.restock': false } });
      }
      if (!pendingGateway) {
        const claimed = await Order.findOneAndUpdate({ _id: id, status: 'delivered', 'returnRequest.status': 'pending' }, { $set: {
          'returnRequest.status': 'processing', 'returnRequest.refundStatus': 'processing', 'returnRequest.refundOperation': operation,
        } }, { new: true, runValidators: true });
        if (!claimed) fail('This return changed. Refresh and try again.', 409);
      }
      // Gateway calls run outside database transactions. An uncertain result stays
      // processing and is reconciled by the same receipt on the next admin retry.
      try {
        gatewayRefund = await ensureOriginalRefund({ paymentId: operation.paymentId, amount: operation.amount, receipt: operation.receipt });
      } catch (error) {
        await Order.updateOne({ _id: id, 'returnRequest.status': 'processing' }, { $set: { 'returnRequest.refundOperation.error': error.message } });
        throw error;
      }
      await Order.updateOne({ _id: id, 'returnRequest.status': 'processing' }, { $set: {
        'returnRequest.refundOperation.gatewayRefundId': gatewayRefund.id, 'returnRequest.refundOperation.state': gatewayRefund.status,
        'returnRequest.refundStatus': gatewayRefund.status, 'returnRequest.refundOperation.error': '',
      } });
      if (gatewayRefund.status === 'pending') return { processing: true, refundAmount: operation.amount, refundedTo: 'original', action, order: await Order.findById(id) };
      // Retried approvals use the original restocking and note decision.
      restock = operation.restock;
      adminNote = operation.adminNote;
    }
  }
  const expectedStatus = gatewayRefund ? 'processing' : 'pending';
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(id).session(session);
      if (!order || order.returnRequest?.status !== expectedStatus) fail('This return has already been resolved or does not exist', 409);
      if (order.status !== 'delivered') fail('Returns can be resolved only for delivered orders', 409);
      const patch = { 'returnRequest.adminNote': adminNote.trim(), 'returnRequest.resolvedAt': new Date(),
        'returnRequest.resolvedBy': adminId, 'returnRequest.refundStatus': 'none', 'returnRequest.status': action === 'approve' ? 'approved' : 'rejected' };
      // Claim the order inside the transaction before any wallet or inventory change.
      const claimed = await Order.updateOne({ _id: id, status: 'delivered', 'returnRequest.status': expectedStatus },
        { $set: { 'returnRequest.status': 'processing', 'returnRequest.refundStatus': 'processing' } }, { session });
      if (!claimed.modifiedCount) fail('This return changed. Refresh before trying again.', 409);
      let refundedTo = 'none';
      let refundAmount = 0;
      if (action === 'approve') {
        const plan = quoteReturn(order);
        const payment = await Payment.findOne({ order: order._id }).session(session);
        if (payment?.refund?.amount > 0 || ['refunded', 'partial_refund'].includes(payment?.status) || order.returnRequest.refundAmount > 0 || order.payment.status === 'refunded') {
          fail('A refund is already recorded. Review it before issuing another.', 409);
        }
        const paid = order.payment.status === 'paid' || payment?.status === 'success';
        if (paid && plan.amount > 0) {
          if (!payment) fail('Payment record is missing. Reconcile payment before refunding.', 409);
          refundAmount = plan.amount;
          if (refundAmount > Number(payment.amount)) fail('Refund exceeds the recorded payment', 409);
          if (online) {
            if (!gatewayRefund || gatewayRefund.status !== 'processed' || gatewayRefund.amount !== Math.round(refundAmount * 100)) fail('Original refund is not confirmed', 409);
            refundedTo = 'original';
          } else {
            await creditWallet({ userId: order.user, amount: refundAmount, reason: 'refund', orderId: order._id, session });
            refundedTo = 'wallet';
          }
          patch['returnRequest.refundStatus'] = 'processed';
          const fullPaymentRefund = refundAmount >= Number(payment.amount);
          patch['payment.status'] = fullPaymentRefund ? 'refunded' : 'paid';
          await Payment.updateOne({ _id: payment._id }, { $set: {
            status: fullPaymentRefund ? 'refunded' : 'partial_refund',
            refund: { amount: refundAmount, reason: order.returnRequest.reason, refundedAt: new Date(), destination: refundedTo, gatewayRefundId: gatewayRefund?.id },
          } }, { session });
          Object.assign(patch, await adjustReturnCommission(order, plan, session));
        } else if (plan.fullRefund && !paid) {
          patch['payment.status'] = 'cancelled';
          await Payment.updateMany({ order: order._id }, { $set: { status: 'cancelled' } }, { session });
        }
        patch['returnRequest.refundAmount'] = refundAmount;
        patch['returnRequest.refundedTo'] = refundedTo;
        patch['returnRequest.restocked'] = restock;
        if (plan.fullRefund) patch.status = 'returned';
        if (restock) for (const item of plan.items) {
          const line = order.items.find((line) => String(line.variantId) === String(item.variantId));
          const stock = await Product.updateOne({ _id: line.product, 'variants._id': line.variantId },
            { $inc: { 'variants.$.stock': item.quantity } }, { session });
          if (!stock.matchedCount) fail('Cannot restock a removed product pack. Retry with restocking disabled.', 409);
        }
      }
      await Order.updateOne({ _id: id }, { $set: patch }, { session, runValidators: true });
      result = { refundAmount, refundedTo, action };
    });
    return { ...result, order: await Order.findById(id) };
  } finally { await session.endSession(); }
}

module.exports = { validateReturnItems, quoteReturn, adjustReturnCommission, resolveOrderReturn };
