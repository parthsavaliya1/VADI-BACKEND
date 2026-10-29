const Razorpay = require('razorpay');
const crypto = require('crypto');
async function verifyCapturedPayment({ orderId, paymentId, signature, userId, amountInPaise }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!process.env.RAZORPAY_KEY_ID || !secret) throw new Error('Payment service is unavailable');
  if (![orderId, paymentId, signature].every(v => typeof v === 'string' && v.length < 200)) throw new Error('Payment details are required');
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(signature) || !crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) throw new Error('Payment signature verification failed');
  const client = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: secret });
  const [order, payment] = await Promise.all([client.orders.fetch(orderId), client.payments.fetch(paymentId)]);
  if (String(order.notes?.userId) !== String(userId) || payment.order_id !== orderId || payment.currency !== 'INR' || order.currency !== 'INR') throw new Error('Payment does not belong to this checkout');
  if (payment.status !== 'captured') throw new Error('Payment has not been captured yet. Try again after confirmation');
  if (Number(payment.amount) !== Number(order.amount) || (amountInPaise !== undefined && Number(payment.amount) !== Number(amountInPaise))) throw new Error('Payment amount does not match the order total');
  return payment;
}
module.exports = verifyCapturedPayment;
