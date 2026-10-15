const RepeatReminder = require("../models/RepeatReminder");
const Order = require("../models/Orders");
const { notifyUser } = require("./orderNotify");

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function runDueReminders() {
  const due = await RepeatReminder.find({
    active: true,
    nextAt: { $lte: new Date() },
  }).limit(50);
  for (const reminder of due) {
    const order = await Order.findById(reminder.order).select("orderNumber").lean();
    await notifyUser({
      userId: reminder.user,
      title: "Time to reorder",
      body: order?.orderNumber
        ? `Your weekly reminder for ${order.orderNumber} is here. Open Orders and tap Buy again.`
        : "Your weekly reorder reminder is here. Open Orders and tap Buy again.",
      kind: "reminder",
      orderId: reminder.order,
    });
    reminder.nextAt = new Date(Date.now() + WEEK_MS);
    await reminder.save();
  }
}

module.exports = { runDueReminders, WEEK_MS };
