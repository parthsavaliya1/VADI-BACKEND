const Order = require("../models/Orders");
const Seller = require("../models/Seller");
const SellerLedger = require("../models/SellerLedger");
const CommissionSettings = require("../models/CommissionSettings");

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const normalizePercent = (value, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, number));
};

const getCommissionSettings = async () => {
  let settings = await CommissionSettings.findOne({ key: "global" });
  if (!settings) {
    settings = await CommissionSettings.create({ key: "global", defaultCommissionPercent: 10 });
  }
  return settings;
};

const rateForSeller = (seller, defaultPercent) => {
  if (seller && seller.commissionPercent !== undefined && seller.commissionPercent !== null) {
    return normalizePercent(seller.commissionPercent, defaultPercent);
  }
  return normalizePercent(defaultPercent, 10);
};

const splitGross = (gross, percent) => {
  const safeGross = roundMoney(gross);
  const commissionAmount = roundMoney((safeGross * percent) / 100);
  const sellerAmount = roundMoney(safeGross - commissionAmount);
  return { gross: safeGross, commissionPercent: percent, commissionAmount, sellerAmount };
};

/**
 * When a customer payment succeeds, credit each seller with their product
 * total minus commission. Delivery fee is not included. Idempotent.
 */
const settleOrderCommission = async (orderId) => {
  const order = await Order.findById(orderId).lean();
  if (!order || order.payment?.status !== "paid" || order.commissionSettled || order.commissionReversed) {
    return order;
  }

  const settings = await getCommissionSettings();
  const defaultPercent = normalizePercent(settings.defaultCommissionPercent, 10);
  const sellerIds = [
    ...new Set((order.items || []).map((item) => String(item.seller?.sellerId || "")).filter(Boolean)),
  ];
  const sellers = await Seller.find({ _id: { $in: sellerIds } })
    .select("name commissionPercent")
    .lean();
  const sellerById = new Map(sellers.map((seller) => [String(seller._id), seller]));

  const grouped = new Map();
  for (const item of order.items || []) {
    const sellerId = String(item.seller?.sellerId || "");
    if (!sellerId) continue;
    const current = grouped.get(sellerId) || {
      sellerName: item.seller?.sellerName || "",
      gross: 0,
    };
    current.gross += Number(item.subtotal) || 0;
    grouped.set(sellerId, current);
  }

  const settlements = [];
  for (const [sellerId, group] of grouped) {
    const seller = sellerById.get(sellerId);
    const percent = rateForSeller(seller, defaultPercent);
    settlements.push({
      sellerId,
      sellerName: seller?.name || group.sellerName,
      ...splitGross(group.gross, percent),
    });
  }

  const settlementBySeller = new Map(settlements.map((row) => [String(row.sellerId), row]));
  const items = (order.items || []).map((item) => {
    const sellerId = String(item.seller?.sellerId || "");
    const settlement = settlementBySeller.get(sellerId);
    if (!settlement || !Number(item.subtotal)) return item;
    const split = splitGross(item.subtotal, settlement.commissionPercent);
    return {
      ...item,
      commissionPercent: split.commissionPercent,
      commissionAmount: split.commissionAmount,
      sellerAmount: split.sellerAmount,
    };
  });

  const platformCommission = roundMoney(
    settlements.reduce((sum, row) => sum + row.commissionAmount, 0),
  );
  const sellerPayoutTotal = roundMoney(
    settlements.reduce((sum, row) => sum + row.sellerAmount, 0),
  );

  for (const row of settlements) {
    await SellerLedger.updateOne(
      { order: order._id, seller: row.sellerId },
      {
        $setOnInsert: {
          order: order._id,
          orderNumber: order.orderNumber,
          seller: row.sellerId,
          sellerName: row.sellerName,
          gross: row.gross,
          commissionPercent: row.commissionPercent,
          commissionAmount: row.commissionAmount,
          sellerAmount: row.sellerAmount,
          status: "credited",
          paidAt: order.payment?.paidAt || new Date(),
        },
      },
      { upsert: true },
    );
  }

  await Order.updateOne(
    { _id: order._id, commissionSettled: { $ne: true } },
    {
      $set: {
        items,
        settlements,
        platformCommission,
        sellerPayoutTotal,
        commissionSettled: true,
        commissionSettledAt: new Date(),
      },
    },
  );

  return Order.findById(orderId).lean();
};

const reverseOrderCommission = async (orderId) => {
  const order = await Order.findById(orderId).select("commissionSettled commissionReversed").lean();
  if (!order?.commissionSettled || order.commissionReversed) return;
  await SellerLedger.updateMany(
    { order: orderId, status: "credited" },
    { $set: { status: "reversed" } },
  );
  await Order.updateOne({ _id: orderId }, { $set: { commissionReversed: true } });
};

const settleUnsettledPaidOrders = async (filter = {}, limit = 200) => {
  const orders = await Order.find({
    ...filter,
    "payment.status": "paid",
    commissionSettled: { $ne: true },
    commissionReversed: { $ne: true },
  })
    .select("_id")
    .limit(limit)
    .lean();

  for (const order of orders) {
    try {
      await settleOrderCommission(order._id);
    } catch (error) {
      console.error("Commission backfill error:", error.message);
    }
  }
};

module.exports = {
  roundMoney,
  normalizePercent,
  getCommissionSettings,
  rateForSeller,
  splitGross,
  settleOrderCommission,
  reverseOrderCommission,
  settleUnsettledPaidOrders,
};
