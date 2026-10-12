/** Quick-commerce delivery quote shared by checkout and payments. */
const { getCommissionSettings, roundMoney } = require("./commission");

const FREE_DELIVERY_ABOVE = 500;
const DELIVERY_FEE = 40;
const DRIVER_FEE_MODES = ["flat", "percent_of_delivery", "percent_of_order"];

function readFeeSettings(settings = {}) {
  const deliveryFee = Math.max(0, Number(settings.deliveryFee ?? DELIVERY_FEE) || 0);
  const freeDeliveryAbove = Math.max(
    0,
    Number(settings.freeDeliveryAbove ?? FREE_DELIVERY_ABOVE) || 0,
  );
  const driverFeeMode = DRIVER_FEE_MODES.includes(settings.driverFeeMode)
    ? settings.driverFeeMode
    : "flat";
  let driverFeeValue = Math.max(0, Number(settings.driverFeeValue ?? 30) || 0);
  if (driverFeeMode !== "flat") driverFeeValue = Math.min(100, driverFeeValue);
  return {
    defaultCommissionPercent: Number(settings.defaultCommissionPercent ?? 10),
    deliveryFee,
    freeDeliveryAbove,
    driverFeeMode,
    driverFeeValue,
  };
}

async function loadFeeSettings() {
  const settings = await getCommissionSettings();
  return readFeeSettings(settings);
}

function quoteDeliveryFeeAmount(subtotal, settings) {
  const amount = Number(subtotal) || 0;
  const rules = readFeeSettings(settings);
  if (rules.freeDeliveryAbove > 0 && amount > rules.freeDeliveryAbove) return 0;
  return rules.deliveryFee;
}

function quoteDriverPayout(subtotal, deliveryFee, settings) {
  const rules = readFeeSettings(settings);
  if (rules.driverFeeMode === "percent_of_delivery") {
    return roundMoney((Number(deliveryFee) || 0) * rules.driverFeeValue / 100);
  }
  if (rules.driverFeeMode === "percent_of_order") {
    return roundMoney((Number(subtotal) || 0) * rules.driverFeeValue / 100);
  }
  return roundMoney(rules.driverFeeValue);
}

async function quoteOrderFees(subtotal) {
  const settings = await loadFeeSettings();
  const deliveryFee = quoteDeliveryFeeAmount(subtotal, settings);
  const driverPayout = quoteDriverPayout(subtotal, deliveryFee, settings);
  return { settings, deliveryFee, driverPayout };
}

function quoteDeliveryFee(subtotal) {
  return quoteDeliveryFeeAmount(subtotal, {
    deliveryFee: DELIVERY_FEE,
    freeDeliveryAbove: FREE_DELIVERY_ABOVE,
  });
}

function formatSlotTime(date) {
  return date.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Blinkit-style window: arrive about 10–20 minutes after the order is placed. */
function quoteDeliverySlot(from = new Date()) {
  const start = new Date(from.getTime() + 10 * 60 * 1000);
  const end = new Date(from.getTime() + 20 * 60 * 1000);
  return {
    date: end,
    slot: `${formatSlotTime(start)} – ${formatSlotTime(end)}`,
  };
}

function normalizeAddressSnapshot(snapshot = {}) {
  const line1 = String(snapshot.addressLine1 || snapshot.addressLine || "").trim();
  const line2 = String(snapshot.addressLine2 || "").trim();
  const addressLine = [line1, line2].filter(Boolean).join(", ");
  return {
    name: snapshot.name || "",
    phone: snapshot.phone || "",
    addressLine,
    addressLine1: line1,
    addressLine2: line2,
    city: snapshot.city || "",
    state: snapshot.state || "",
    pincode: snapshot.pincode || "",
    landmark: snapshot.landmark || "",
  };
}

module.exports = {
  FREE_DELIVERY_ABOVE,
  DELIVERY_FEE,
  DRIVER_FEE_MODES,
  readFeeSettings,
  loadFeeSettings,
  quoteDeliveryFeeAmount,
  quoteDriverPayout,
  quoteOrderFees,
  quoteDeliveryFee,
  quoteDeliverySlot,
  normalizeAddressSnapshot,
};
