const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Notification = require("../models/Notification");

const router = express.Router();

function normalizeObjectId(id) {
  if (id == null) return null;
  const s = String(id).trim();
  if (!s || !mongoose.Types.ObjectId.isValid(s)) return null;
  return s;
}

/**
 * GET /notifications?userId=&limit=
 * In-app list of admin broadcast notifications + read state for this user.
 */
router.get("/", async (req, res) => {
  try {
    const userId = normalizeObjectId(req.query.userId);
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId query parameter is required",
      });
    }

    const user = await User.findById(userId)
      .select("readBroadcastNotificationIds")
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const readSet = new Set(
      (user.readBroadcastNotificationIds || []).map((id) => String(id)),
    );

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);

    const items = await Notification.find({
      $or: [
        { user: userId },
        { kind: "broadcast" },
        { user: null },
        { user: { $exists: false } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const data = items.map((n) => ({
      _id: n._id,
      title: n.title,
      body: n.body,
      imageUrl: n.imageUrl || "",
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      read: readSet.has(String(n._id)),
    }));

    const unreadCount = data.filter((n) => !n.read).length;

    return res.json({
      success: true,
      data,
      unreadCount,
    });
  } catch (error) {
    console.error("GET /notifications error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load notifications",
      error: error.message,
    });
  }
});

/**
 * POST /notifications/:notificationId/read
 * Body: { userId }
 */
router.post("/:notificationId/read", async (req, res) => {
  try {
    const notificationId = normalizeObjectId(req.params.notificationId);
    const userId = normalizeObjectId(req.body?.userId);

    if (!notificationId || !userId) {
      return res.status(400).json({
        success: false,
        message: "notificationId and body.userId are required",
      });
    }

    const [note, user] = await Promise.all([
      Notification.findById(notificationId).select("_id").lean(),
      User.findById(userId).select("_id").lean(),
    ]);

    if (!note) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    await User.updateOne(
      { _id: userId },
      { $addToSet: { readBroadcastNotificationIds: notificationId } },
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("POST /notifications/:id/read error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark notification read",
      error: error.message,
    });
  }
});

module.exports = router;
