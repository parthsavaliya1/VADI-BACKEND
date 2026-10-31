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

// A receipt identifies one business operation. Always look it up before retrying
// a timed-out request; never substitute a wallet credit for an uncertain result.
async function ensureOriginalRefund({ paymentId, amount, receipt }, client = razorpay) {
  if (!client) throw Object.assign(new Error("Razorpay is not configured. The return remains pending for reconciliation."), { statusCode: 503 });
  const paise = Math.round(Number(amount) * 100);
  if (!paymentId || !Number.isSafeInteger(paise) || paise < 100 || !/^return_[a-f0-9]{24}$/i.test(receipt)) {
    throw Object.assign(new Error("A valid payment reference and refund of at least ₹1 are required"), { statusCode: 409 });
  }
  async function existingRefund() {
    for (let skip = 0; ; skip += 100) {
      const page = await client.payments.fetchMultipleRefund(paymentId, { count: 100, skip });
      const found = page.items?.find((refund) => refund.receipt === receipt);
      if (found) return found;
      if (!page.items || page.items.length < 100) return null;
    }
  }
  let refund = await existingRefund();
  if (!refund) {
    try { refund = await client.payments.refund(paymentId, { amount: paise, speed: "normal", receipt }); }
    catch (error) {
      // The first request may have succeeded even if its HTTP response was lost.
      refund = await existingRefund();
      if (!refund) throw Object.assign(new Error("Could not confirm the original-payment refund. Use Resume refund to reconcile; no wallet credit was issued."), { statusCode: 502 });
    }
  }
  if (!refund?.id || refund.amount !== paise || refund.payment_id !== paymentId || refund.receipt !== receipt || refund.currency !== "INR") {
    throw Object.assign(new Error("The gateway refund does not match this return. Review it before proceeding."), { statusCode: 409 });
  }
  if (!["pending", "processed"].includes(refund.status)) {
    throw Object.assign(new Error("The original refund failed or has an unknown state. Review it in Razorpay; no wallet credit was issued."), { statusCode: 409 });
  }
  return refund;
}

module.exports = { refundRazorpayPayment, ensureOriginalRefund };
