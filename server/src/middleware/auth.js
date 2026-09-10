import jwt from "jsonwebtoken";
import { config } from "../config.js";

export function signAdminToken(admin) {
  return jwt.sign(
    { sub: admin.id, email: admin.email, role: "admin" },
    config.jwtSecret,
    { expiresIn: config.adminJwtExpires }
  );
}

export function readToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  if (req.query.access_token) return String(req.query.access_token);
  return "";
}

export function requireAdmin(req, res, next) {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    req.admin = jwt.verify(token, config.jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}
