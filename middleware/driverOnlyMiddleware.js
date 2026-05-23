const jwt = require("jsonwebtoken");

/** Bearer JWT with role === "driver" only */
module.exports = function driverOnlyMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }

  if (decoded.role !== "driver") {
    return res.status(403).json({ success: false, message: "Driver access only" });
  }

  req.driver = { id: String(decoded.id) };
  next();
};
