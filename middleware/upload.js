const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(), // ✅ correct
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only images allowed"));
    }
    cb(null, true);
  },
});

module.exports = upload;
