const mongoose = require('mongoose');
const Order = require('../models/Orders');
const Payment = require('../models/Payment');
const SellerLedger = require('../models/SellerLedger');

function fail(message, statusCode = 409) {
  throw Object.assign(new Error(message), { statusCode });
}

async function reopenDeliveredOrder({ id, adminId, status, reason, codCollected }) {
  if (!mongoose.isObjectIdOrHexString(id)) fail('Invalid order ID', 400);
  if (!['placed', 'confirmed', 'packed', 'shipped'].includes(status)) fail('Choose Placed, Confirmed, Packed or Shipped', 400);
  if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 500) fail('Enter a correction reason of 5–500 characters', 400);
  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(id).session(session);
      if (!order) fail('Order not found', 404);
      if (order.status !== 'delivered') fail('Only a delivered order can be reopened');
      if (['pending', 'processing', 'approved'].includes(order.returnRequest?.status)) fail('Resolve the return before reopening this order');
      const payment = await Payment.findOne({ order: order._id }).session(session);
      if (order.payment.status === 'refunded' || order.returnRequest?.refundAmount > 0 ||
          ['refunded', 'partial_refund'].includes(payment?.status) || payment?.refund?.amount > 0) {
        fail('A refunded order cannot be reopened. Create a new order instead.');
      }
      const isCod = order.payment.method === 'cod';
      if (isCod && typeof codCollected !== 'boolean') fail('Confirm whether COD cash was actually collected', 400);
      const patch = {
        status, deliveredAt: null, deliveredByDriver: null, driverLocation: null,
        deliveryHandoverCipher: null, deliveryHandoverGeneratedAt: null,
        deliveryHandoverVerifiedAt: null, deliveryHandoverVerifiedByDriver: null,
        deliveryHandoverWrongAttempts: 0,
      };
      if (order.returnRequest?.status === 'rejected') patch.returnRequest = null;
      if (isCod) {
        patch['payment.status'] = codCollected ? 'paid' : 'pending';
        patch['payment.codCollected'] = codCollected;
        patch['payment.paidAt'] = codCollected ? order.payment.paidAt || new Date() : null;
        await Payment.updateMany({ order: order._id }, { $set: {
          status: codCollected ? 'success' : 'pending', codCollected,
          collectedAt: codCollected ? payment?.collectedAt || new Date() : null,
        } }, { session });
        if (!codCollected) {
          await SellerLedger.updateMany({ order: order._id, status: 'credited' }, { $set: { status: 'reversed' } }, { session });
          patch.commissionSettled = false;
          patch.commissionReversed = false;
          patch.commissionSettledAt = null;
        }
      }
      // Inventory is already reserved. Reopening must not restore or reserve it again.
      updated = await Order.findOneAndUpdate({ _id: id, status: 'delivered' }, {
        $set: patch,
        $push: { statusHistory: { from: 'delivered', to: status, reason: reason.trim(), changedBy: adminId,
          changedAt: new Date(), previousPaymentStatus: order.payment.status,
          previousCodCollected: order.payment.codCollected, previousReturnRequest: order.returnRequest?.status === 'rejected' ? (order.returnRequest.toObject ? order.returnRequest.toObject() : order.returnRequest) : undefined, codCollected: isCod ? codCollected : undefined } },
      }, { new: true, runValidators: true, session });
      if (!updated) fail('Order changed while you were editing. Refresh and try again.');
    });
    return updated;
  } finally {
    await session.endSession();
  }
}

module.exports = { reopenDeliveredOrder };
