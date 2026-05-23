const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Driver = require("../models/Driver");

/**
 * Allows JWT for:
 * - Admin (legacy token `{ id }` or new `{ id, role: 'admin' }`)
 * - Driver (`{ id, role: 'driver' }`)
 */
module.exports = async function adminOrDriverMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication required. Sign in as admin or delivery staff.",
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }

  try {
    if (decoded.role === "driver") {
      const d = await Driver.findById(decoded.id).select("_id isActive name phone");
      if (!d || !d.isActive) {
        return res.status(403).json({
          success: false,
          message: "Driver account not found or inactive",
        });
      }
      req.driver = {
        id: d._id.toString(),
        phone: d.phone,
        name: d.name,
      };
      return next();
    }

    if (decoded.role === "admin") {
      const a = await Admin.findById(decoded.id).select("_id");
      if (!a) {
        return res.status(403).json({ success: false, message: "Admin not found" });
      }
      req.admin = decoded;
      return next();
    }

    const legacyAdmin = await Admin.findById(decoded.id).select("_id");
    if (legacyAdmin) {
      req.admin = { ...decoded, role: "admin" };
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "Only admin or delivery staff can perform this action",
    });
  } catch (e) {
    console.error("adminOrDriverMiddleware:", e);
    return res.status(500).json({ success: false, message: "Auth check failed" });
  }
};
