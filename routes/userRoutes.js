const express = require("express");
const User = require("../models/User");

const router = express.Router();

/** Fields the mobile app may PATCH (matches AuthContext). */
const ALLOWED_PATCH_FIELDS = ["name", "dob", "profileImage", "lastLoginAt"];

/**
 * PATCH /api/users/:id
 * Used on app boot (lastLoginAt) and profile screen.
 */
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const updates = {};

    for (const key of ALLOWED_PATCH_FIELDS) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true },
    )
      .select("-otp -otpSessionId")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json(user);
  } catch (error) {
    console.error("PATCH /api/users/:id error:", error?.message || error);
    return res.status(500).json({ message: "Failed to update user" });
  }
});

module.exports = router;
