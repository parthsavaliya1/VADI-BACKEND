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
      .select("readBroadcastNotificationIds deletedNotificationIds")
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
      _id: { $nin: user.deletedNotificationIds || [] },
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

// Remove notifications only from this user's inbox; keep shared broadcasts.
router.post("/delete-bulk", async (req, res) => {
  try {
    const userId = normalizeObjectId(req.body?.userId);
    const ids = req.body?.ids;
    if (!userId || !Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => !normalizeObjectId(id))) {
      return res.status(400).json({ success: false, message: "userId and 1–100 valid notification IDs are required" });
    }
    const user = await User.findById(userId).select("_id").lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const notes = await Notification.find({
      _id: { $in: [...new Set(ids.map(normalizeObjectId))] },
      $or: [{ user: userId }, { kind: "broadcast" }, { user: null }, { user: { $exists: false } }],
    }).select("_id").lean();
    const deletedIds = notes.map((note) => String(note._id));
    if (deletedIds.length) await User.updateOne({ _id: userId }, { $addToSet: { deletedNotificationIds: { $each: deletedIds } } });
    return res.json({ success: true, removed: deletedIds.length, deletedIds });
  } catch (error) {
    console.error("Delete notifications failed:", error);
    return res.status(500).json({ success: false, message: "Failed to delete notifications" });
  }
});
module.exports = router;
