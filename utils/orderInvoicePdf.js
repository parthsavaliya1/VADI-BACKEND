const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

const MARGIN = 48;
const PAGE_W = 595.28;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const GREEN = "#166534";
const GREEN_BAR = "#1E7A35";
const GREEN_SOFT = "#F0F7F1";
const TEXT_MUTED = "#4B5563";
const BORDER = "#E5E7EB";

const LOGO_PATH = path.join(__dirname, "..", "assets", "vadi-brand-logo.png");

function money(n) {
  return `₹${Number(n || 0).toFixed(2)}`;
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(d);
  }
}

/**
 * Build a PDF invoice for a delivered order.
 * @param {import("mongoose").Document} order Mongoose order doc (populate items.product optional)
 * @returns {Promise<Buffer>}
 */
function buildOrderInvoicePdf(order) {
  const o = order.toObject ? order.toObject() : order;
  const snap = o.address?.snapshot || {};
  const pay = o.payment || {};
  const items = Array.isArray(o.items) ? o.items : [];
  const hasLogo = fs.existsSync(LOGO_PATH);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: `Invoice ${o.orderNumber || ""}` } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = MARGIN;
    const pageMaxY = () => doc.page.height - MARGIN;

    // ── Accent bar ─────────────────────────────────────────────
    doc.save();
    doc.rect(MARGIN, y, CONTENT_W, 4).fill(GREEN_BAR);
    doc.restore();
    y += 12;

    // ── Header card ────────────────────────────────────────────
    const headerTop = y;
    const headerH = hasLogo ? 92 : 72;
    doc.save();
    doc.roundedRect(MARGIN, headerTop, CONTENT_W, headerH, 8).fill(GREEN_SOFT);
    doc.restore();

    const innerLeft = MARGIN + 16;
    const headerY = headerTop + 16;

    if (hasLogo) {
      try {
        doc.image(LOGO_PATH, innerLeft, headerY, { width: 56 });
      } catch {
        // ignore corrupt / unreadable image
      }
    }

    const textLeft = hasLogo ? innerLeft + 68 : innerLeft;
    doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(20).text("VADI", textLeft, headerY);
    doc.font("Helvetica").fontSize(10).fillColor(TEXT_MUTED).text("Fresh groceries, delivered.", textLeft, headerY + 24);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(GREEN_BAR).text("ORDER INVOICE", textLeft, headerY + 40);

    const deliveredOrUpdated = o.deliveredAt || o.updatedAt || o.createdAt;
    const metaBlockW = 150;
    const metaX = MARGIN + CONTENT_W - 16 - metaBlockW;
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MUTED);
    doc.text("Order no.", metaX, headerY, { width: metaBlockW, align: "right" });
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text(String(o.orderNumber || "—"), metaX, headerY + 12, {
      width: metaBlockW,
      align: "right",
    });
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MUTED).text("Invoice date", metaX, headerY + 30, {
      width: metaBlockW,
      align: "right",
    });
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text(fmtDate(deliveredOrUpdated), metaX, headerY + 40, {
      width: metaBlockW,
      align: "right",
    });
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MUTED).text("Status", metaX, headerY + 56, { width: metaBlockW, align: "right" });
    doc.font("Helvetica-Bold").fontSize(9).fillColor(GREEN).text(
      String((o.status || "—").replace(/_/g, " ")).toUpperCase(),
      metaX,
      headerY + 66,
      { width: metaBlockW, align: "right" },
    );

    y = headerTop + headerH + 20;
    doc.x = MARGIN;

    // ── Bill to & Payment (two columns) ─────────────────────
    const colGap = 16;
    const halfW = (CONTENT_W - colGap) / 2;
    const boxY = y;

    doc.save();
    doc.roundedRect(MARGIN, boxY, halfW, 108, 6).stroke(BORDER);
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(10).fillColor(GREEN_BAR).text("Bill to", MARGIN + 12, boxY + 10);
    doc.font("Helvetica").fontSize(9).fillColor("#111");
    let by = boxY + 26;
    doc.text(snap.name || "—", MARGIN + 12, by, { width: halfW - 24 });
    by = doc.y + 2;
    doc.fillColor(TEXT_MUTED).text(snap.phone || "—", MARGIN + 12, by, { width: halfW - 24 });
    by = doc.y + 2;
    const addrLine = [snap.addressLine, snap.city, snap.state, snap.pincode].filter(Boolean).join(", ");
    if (addrLine) {
      doc.text(addrLine, MARGIN + 12, by, { width: halfW - 24 });
      by = doc.y + 2;
    }
    if (snap.landmark) doc.fontSize(8).text(`Landmark: ${snap.landmark}`, MARGIN + 12, by, { width: halfW - 24 });

    const payX = MARGIN + halfW + colGap;
    doc.save();
    doc.roundedRect(payX, boxY, halfW, 108, 6).stroke(BORDER);
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(10).fillColor(GREEN_BAR).text("Payment", payX + 12, boxY + 10);
    doc.font("Helvetica").fontSize(9).fillColor("#111");
    let py = boxY + 26;
    doc.text(`Method: ${String(pay.method || "—").toUpperCase()}`, payX + 12, py, { width: halfW - 24 });
    py = doc.y + 4;
    doc.text(`Status: ${String(pay.status || "—").toUpperCase()}`, payX + 12, py, { width: halfW - 24 });
    if (pay.isCod) {
      py = doc.y + 4;
      doc.fontSize(8).fillColor(TEXT_MUTED).text("Cash on delivery (COD)", payX + 12, py, { width: halfW - 24 });
    }

    y = boxY + 108 + 24;

    // ── Line items table ─────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111").text("Items", MARGIN, y);
    y = doc.y + 8;

    const colItem = MARGIN + 8;
    const colQty = 312;
    const colRate = 370;
    const colAmt = 430;
    const itemTextW = colQty - colItem - 10;
    const tableRight = MARGIN + CONTENT_W - 8;

    doc.save();
    doc.rect(MARGIN, y, CONTENT_W, 22).fill(GREEN_BAR);
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#fff");
    doc.text("Description", colItem, y + 6, { width: itemTextW });
    doc.text("Qty", colQty, y + 6, { width: 36, align: "right" });
    doc.text("Rate", colRate, y + 6, { width: 52, align: "right" });
    doc.text("Amount", colAmt, y + 6, { width: tableRight - colAmt, align: "right" });
    y += 22;

    doc.font("Helvetica").fontSize(9).fillColor("#111");
    let rowIndex = 0;
    for (const line of items) {
      const name = String(line.product?.name || line.productName || "Product").slice(0, 120);
      const qty = line.quantity ?? 0;
      const unit = Number(line.unitPrice ?? 0);
      const sub = Number(line.subtotal ?? qty * unit);

      const rowPad = 8;
      doc.font("Helvetica").fontSize(9);
      const hName = doc.heightOfString(name, { width: itemTextW });
      const rowH = Math.max(hName, 14) + rowPad;

      if (y + rowH > pageMaxY() - 140) {
        doc.addPage();
        y = MARGIN;
      }

      if (rowIndex % 2 === 0) {
        doc.save();
        doc.rect(MARGIN, y, CONTENT_W, rowH).fill("#FAFAFA");
        doc.restore();
      }

      doc.fillColor("#111").text(name, colItem, y + rowPad / 2, { width: itemTextW });
      doc.text(String(qty), colQty, y + rowPad / 2, { width: 36, align: "right" });
      doc.text(money(unit), colRate, y + rowPad / 2, { width: 52, align: "right" });
      doc.text(money(sub), colAmt, y + rowPad / 2, { width: tableRight - colAmt, align: "right" });

      y += rowH;
      rowIndex += 1;
    }

    if (y + 160 > pageMaxY()) {
      doc.addPage();
      y = MARGIN;
    }

    doc.save();
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).stroke(BORDER);
    doc.restore();
    y += 14;

    // ── Totals (right-aligned block) ─────────────────────────
    const totalsW = 200;
    const totalsX = MARGIN + CONTENT_W - totalsW;
    doc.font("Helvetica").fontSize(10).fillColor("#111");
    doc.text(`Subtotal`, totalsX, y, { width: 100, align: "left" });
    doc.text(money(o.subtotal), totalsX + 100, y, { width: totalsW - 100, align: "right" });
    y = doc.y + 6;

    if (Number(o.totalDiscount) > 0) {
      doc.fillColor(TEXT_MUTED).text(`Discount`, totalsX, y, { width: 100, align: "left" });
      doc.text(`−${money(o.totalDiscount)}`, totalsX + 100, y, { width: totalsW - 100, align: "right" });
      y = doc.y + 6;
    }

    if (Number(o.couponDiscount) > 0) {
      doc.fillColor(TEXT_MUTED).text(`Coupon${o.couponCode ? ` (${o.couponCode})` : ""}`, totalsX, y, { width: 100, align: "left" });
      doc.text(`−${money(o.couponDiscount)}`, totalsX + 100, y, { width: totalsW - 100, align: "right" });
      y = doc.y + 6;
    }

    doc.fillColor("#111").text(`Tax`, totalsX, y, { width: 100, align: "left" });
    doc.text(money(o.taxAmount), totalsX + 100, y, { width: totalsW - 100, align: "right" });
    y = doc.y + 6;

    const delLabel = Number(o.deliveryFee) === 0 ? "Delivery (FREE)" : "Delivery";
    doc.text(delLabel, totalsX, y, { width: 100, align: "left" });
    doc.text(Number(o.deliveryFee) === 0 ? "₹0.00" : money(o.deliveryFee), totalsX + 100, y, {
      width: totalsW - 100,
      align: "right",
    });
    y = doc.y + 10;

    doc.save();
    doc.roundedRect(totalsX - 8, y - 4, totalsW + 16, 30, 4).fillAndStroke(GREEN_SOFT, GREEN_BAR);
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(12).fillColor(GREEN_BAR).text("Grand total", totalsX, y + 4, { width: 100, align: "left" });
    doc.text(money(o.grandTotal), totalsX + 100, y + 4, { width: totalsW - 100, align: "right" });

    const footerY = doc.page.height - 52;
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MUTED).text(
      "This is a computer-generated invoice and does not require a signature.",
      MARGIN,
      footerY,
      { width: CONTENT_W, align: "center" },
    );
    doc.fillColor(TEXT_MUTED).text("Thank you for shopping with VADI.", MARGIN, footerY + 14, {
      width: CONTENT_W,
      align: "center",
    });

    doc.end();
  });
}

module.exports = { buildOrderInvoicePdf };
