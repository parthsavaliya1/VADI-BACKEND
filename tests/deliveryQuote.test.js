const test = require("node:test");
const assert = require("node:assert/strict");
const { quoteDeliverySlot } = require("../utils/deliveryQuote");

test("delivery deadline is 48 elapsed hours after placement, including date boundaries", () => {
  for (const value of ["2026-11-03T10:15:00+05:30", "2026-12-31T23:30:00Z"]) {
    const placed = new Date(value);
    const quote = quoteDeliverySlot(placed);
    assert.equal(quote.date.getTime() - placed.getTime(), 48 * 60 * 60 * 1000);
    assert.equal(quote.slot, "Within 48 hours of placing your order");
    assert.equal(placed.toISOString(), new Date(value).toISOString());
  }
});
