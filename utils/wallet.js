const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");

async function ensureWallet(userId, session) {
  let wallet = await Wallet.findOne({ user: userId }).session(session || null);
  if (wallet) return wallet;
  const created = await Wallet.create([{ user: userId, balance: 0 }], {
    session,
  });
  return created[0];
}

async function creditWallet({
  userId,
  amount,
  reason,
  razorpayPaymentId,
  razorpayOrderId,
  orderId,
  session,
}) {
  const wallet = await ensureWallet(userId, session);
  if (razorpayPaymentId) {
    const existing = await WalletTransaction.findOne({
      razorpayPaymentId,
    }).session(session || null);
    if (existing) {
      const current = await Wallet.findOne({ user: userId }).session(session || null);
      return Number(current?.balance ?? wallet.balance);
    }
  }

  wallet.balance = Number((Number(wallet.balance) + Number(amount)).toFixed(2));
  await wallet.save({ session });
  await WalletTransaction.create(
    [
      {
        user: userId,
        amount,
        direction: "credit",
        reason,
        order: orderId,
        razorpayOrderId,
        razorpayPaymentId,
        balanceAfter: wallet.balance,
        status: "paid",
      },
    ],
    { session },
  );
  return Number(wallet.balance);
}

async function debitWallet({ userId, amount, orderId, session }) {
  const wallet = await Wallet.findOne({ user: userId }).session(session);
  const balance = Number(wallet?.balance ?? 0);
  const charge = Number(amount);
  if (!wallet || balance < charge) {
    const err = new Error(
      `Wallet balance is ₹${balance}. Add ₹${Math.ceil(charge - balance)} to pay with wallet.`,
    );
    err.statusCode = 402;
    throw err;
  }
  wallet.balance = Number((balance - charge).toFixed(2));
  await wallet.save({ session });
  await WalletTransaction.create(
    [
      {
        user: userId,
        amount: charge,
        direction: "debit",
        reason: "order",
        order: orderId,
        balanceAfter: wallet.balance,
        status: "paid",
      },
    ],
    { session },
  );
  return Number(wallet.balance);
}

module.exports = { ensureWallet, creditWallet, debitWallet };
