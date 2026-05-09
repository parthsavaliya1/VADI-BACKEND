/**
 * Rajkot delivery rules — keep in sync with vadi-app/app/add-address.tsx
 */

const ALLOWED_DELIVERY_PINCODES = [
  "360001",
  "360002",
  "360003",
  "360004",
  "360005",
  "360006",
  "360007",
];

const PIN_SET = new Set(ALLOWED_DELIVERY_PINCODES);

/** Rough Rajkot map bounds (lng, lat) */
const RAJKOT_BOUNDS = {
  north: 22.42,
  south: 22.22,
  east: 70.92,
  west: 70.68,
};

const DELIVERY_CITY_NORMALIZED = "rajkot";

function normalizeCity(str) {
  return String(str || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** @returns {boolean} */
function isGujaratState(value) {
  const t = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!t.length) return false;
  return t.includes("gujarat") || t === "gj" || t.endsWith(", gj");
}

/** @returns {boolean} */
function isInRajkotBounds(lat, lng) {
  return (
    lat <= RAJKOT_BOUNDS.north &&
    lat >= RAJKOT_BOUNDS.south &&
    lng <= RAJKOT_BOUNDS.east &&
    lng >= RAJKOT_BOUNDS.west
  );
}

function allowedPinsMessage() {
  return (
    "Delivery is only available for PIN codes " +
    ALLOWED_DELIVERY_PINCODES.slice(0, -1).join(", ") +
    " and " +
    ALLOWED_DELIVERY_PINCODES[ALLOWED_DELIVERY_PINCODES.length - 1] +
    " (Rajkot listed localities)."
  );
}

/**
 * Validates full address snapshot (create/update). Applies to edits as well as new rows.
 *
 * @param {{ pincode?: string; city?: string; state?: string; location?: { type?: string; coordinates?: unknown } } | null | undefined} a
 * @returns {string|null} Error message if invalid, otherwise null.
 */
function assertDeliverableRajkotAddress(a) {
  if (!a) return "Invalid address.";
  const pin = String(a.pincode || "").trim();

  if (!/^\d{6}$/.test(pin)) return "Provide a valid 6-digit PIN code.";
  if (!PIN_SET.has(pin))
    return `Outside delivery area. ${allowedPinsMessage()}`;

  if (normalizeCity(a.city) !== DELIVERY_CITY_NORMALIZED)
    return "Outside delivery area. Delivery is limited to Rajkot city only.";
  if (!isGujaratState(a.state || ""))
    return "Outside delivery area. Delivery is limited to Gujarat (Rajkot) only.";

  const coords = a.location?.coordinates;
  if (
    !Array.isArray(coords) ||
    coords.length !== 2 ||
    typeof coords[0] !== "number" ||
    typeof coords[1] !== "number"
  ) {
    return "Choose your location on the map (PIN must be matched to a delivery zone). Try saving again from the mobile app.";
  }

  const [lng, lat] = coords;
  if (!Number.isFinite(lng) || !Number.isFinite(lat))
    return "Invalid map coordinates. Confirm your pin on the map and save again.";

  if (!isInRajkotBounds(lat, lng))
    return "Map location is outside the Rajkot delivery boundary. Adjust the pin inside Rajkot and save.";

  return null;
}

module.exports = {
  ALLOWED_DELIVERY_PINCODES,
  assertDeliverableRajkotAddress,
  allowedPinsMessage,
};
