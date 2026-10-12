/** Quick-commerce delivery quote shared by checkout and payments. */
const FREE_DELIVERY_ABOVE = 500;
const DELIVERY_FEE = 40;

function quoteDeliveryFee(subtotal) {
  const amount = Number(subtotal) || 0;
  return amount > FREE_DELIVERY_ABOVE ? 0 : DELIVERY_FEE;
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
  quoteDeliveryFee,
  quoteDeliverySlot,
  normalizeAddressSnapshot,
};
