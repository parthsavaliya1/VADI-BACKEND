const User = require("../models/User");
const Order = require("../models/Orders");
const { creditWallet } = require("./wallet");
const { notifyUser } = require("./orderNotify");

const REFERRAL_REWARD = 25;

function makeCode() {
  return `VADI${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function ensureReferralCode(user) {
  if (user.referralCode) return user.referralCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    user.referralCode = makeCode();
    try {
      await user.save();
      return user.referralCode;
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  return user.referralCode;
}

async function attachReferrer(user, code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized || user.referredBy) return;
  const referrer = await User.findOne({ referralCode: normalized }).select("_id");
  if (!referrer || String(referrer._id) === String(user._id)) return;
  user.referredBy = referrer._id;
}

/** Credit both people once, the first time a referred customer's order is delivered. */
async function rewardReferralOnDelivery(customerId) {
  const customer = await User.findById(customerId);
  if (!customer?.referredBy || customer.referralRewardPaid) return;
  const deliveredCount = await Order.countDocuments({
    user: customer._id,
    status: "delivered",
  });
  if (deliveredCount < 1) return;
  await creditWallet({
    userId: customer._id,
    amount: REFERRAL_REWARD,
    reason: "refund",
  });
  await creditWallet({
    userId: customer.referredBy,
    amount: REFERRAL_REWARD,
    reason: "refund",
  });
  customer.referralRewardPaid = true;
  await customer.save();
  await notifyUser({
    userId: customer._id,
    title: "Referral reward",
    body: `₹${REFERRAL_REWARD} was added to your wallet.`,
    kind: "referral",
  });
  await notifyUser({
    userId: customer.referredBy,
    title: "Referral reward",
    body: `A friend placed their first order. ₹${REFERRAL_REWARD} was added to your wallet.`,
    kind: "referral",
  });
}

module.exports = {
  REFERRAL_REWARD,
  ensureReferralCode,
  attachReferrer,
  rewardReferralOnDelivery,
};
