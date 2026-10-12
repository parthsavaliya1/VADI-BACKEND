const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const router = express.Router();

const uploadDir = path.join(__dirname, "../uploads/products");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)
      ? ext
      : ".jpg";
    cb(
      null,
      `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${safeExt}`,
    );
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      cb(new Error("Only images are allowed"));
      return;
    }
    cb(null, true);
  },
});

router.post("/", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Image file is required",
    });
  }

  const configured = process.env.PUBLIC_BASE_URL;
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const base = (configured || `${proto}://${req.get("host")}`).replace(
    /\/+$/,
    "",
  );

  res.status(201).json({
    success: true,
    url: `${base}/uploads/products/${req.file.filename}`,
  });
});

router.use((error, _req, res, _next) => {
  res.status(400).json({
    success: false,
    message: error.message || "Image upload failed",
  });
});

module.exports = router;
