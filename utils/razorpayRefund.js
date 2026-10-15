const Razorpay = require("razorpay");

const razorpay =
  process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    ? new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      })
    : null;

/** Returns the Razorpay refund id, or null when the gateway cannot refund. */
async function refundRazorpayPayment(paymentId, amountRupees) {
  if (!razorpay || !paymentId) return null;
  const paise = Math.round(Number(amountRupees) * 100);
  if (!Number.isFinite(paise) || paise < 100) return null;
  const refund = await razorpay.payments.refund(String(paymentId), { amount: paise });
  return refund?.id || null;
}

module.exports = { refundRazorpayPayment };
