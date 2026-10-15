const User = require("../models/User");
const Notification = require("../models/Notification");
const { sendExpoPush } = require("./expoPushSend");

const COPY = {
  en: {
    placed: ["Order placed", "We received your order {n}."],
    confirmed: ["Order confirmed", "Your order {n} is confirmed."],
    packed: ["Order packed", "Your order {n} is packed and will ship soon."],
    shipped: ["Order shipped", "Your order {n} has been shipped."],
    out_for_delivery: ["Out for delivery", "Your order {n} is on the way."],
    delivered: ["Order delivered", "Your order {n} has been delivered."],
    cancelled: ["Order cancelled", "Your order {n} was cancelled."],
    returned: ["Return update", "Your return for order {n} was updated."],
  },
  hi: {
    placed: ["ऑर्डर मिल गया", "हमें आपका ऑर्डर {n} मिल गया है।"],
    confirmed: ["ऑर्डर कन्फर्म", "आपका ऑर्डर {n} कन्फर्म हो गया है।"],
    packed: ["ऑर्डर पैक", "आपका ऑर्डर {n} पैक हो गया है।"],
    shipped: ["ऑर्डर शिप", "आपका ऑर्डर {n} शिप हो गया है।"],
    out_for_delivery: ["डिलीवरी के लिए निकला", "आपका ऑर्डर {n} रास्ते में है।"],
    delivered: ["ऑर्डर डिलीवर", "आपका ऑर्डर {n} डिलीवर हो गया है।"],
    cancelled: ["ऑर्डर रद्द", "आपका ऑर्डर {n} रद्द कर दिया गया।"],
    returned: ["रिटर्न अपडेट", "ऑर्डर {n} की रिटर्न अपडेट हो गई।"],
  },
  gu: {
    placed: ["ઓર્ડર મળ્યો", "તમારો ઓર્ડર {n} અમને મળ્યો છે."],
    confirmed: ["ઓર્ડર કન્ફર્મ", "તમારો ઓર્ડર {n} કન્ફર્મ થયો છે."],
    packed: ["ઓર્ડર પેક", "તમારો ઓર્ડર {n} પેક થઈ ગયો છે."],
    shipped: ["ઓર્ડર શિપ", "તમારો ઓર્ડર {n} શિપ થઈ ગયો છે."],
    out_for_delivery: ["ડિલિવરી માટે નીકળ્યો", "તમારો ઓર્ડર {n} રસ્તામાં છે."],
    delivered: ["ઓર્ડર ડિલિવર", "તમારો ઓર્ડર {n} ડિલિવર થઈ ગયો છે."],
    cancelled: ["ઓર્ડર રદ", "તમારો ઓર્ડર {n} રદ કરવામાં આવ્યો."],
    returned: ["રિટર્ન અપડેટ", "ઓર્ડર {n} નું રિટર્ન અપડેટ થયું."],
  },
};

function line(lang, status, orderNumber) {
  const pack = COPY[lang] || COPY.en;
  const pair = pack[status] || COPY.en[status] || ["Order update", "Your order {n} was updated."];
  const n = orderNumber || "your order";
  return {
    title: pair[0],
    body: pair[1].replace("{n}", n),
  };
}

/**
 * Save an in-app notice and send a push. Failures are logged and never thrown,
 * so an order status change still succeeds if Expo is unreachable.
 */
async function notifyUser({ userId, title, body, kind = "order", orderId, data }) {
  if (!userId || !title || !body) return;
  try {
    await Notification.create({
      title,
      body,
      user: userId,
      order: orderId || null,
      kind,
    });
    const user = await User.findById(userId).select("pushToken").lean();
    if (!user?.pushToken) return;
    await sendExpoPush([user.pushToken], {
      title,
      body,
      data: { type: kind, orderId: orderId ? String(orderId) : "", ...(data || {}) },
    });
  } catch (error) {
    console.error("[orderNotify] failed:", error.message);
  }
}

async function notifyOrderStatus(order, status, extra = {}) {
  if (!order?.user || !status) return;
  const user = await User.findById(order.user).select("preferredLanguage").lean();
  const lang = user?.preferredLanguage || "en";
  const message = line(lang, status, order.orderNumber);
  let body = message.body;
  if (status === "out_for_delivery" && extra.handoverCode) {
    body = `${body} Code: ${extra.handoverCode}`;
  }
  await notifyUser({
    userId: order.user,
    title: message.title,
    body,
    kind: "order",
    orderId: order._id,
    data: { status },
  });
}

module.exports = { notifyUser, notifyOrderStatus };
