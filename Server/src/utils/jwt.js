import jwt from "jsonwebtoken";
import { auth as authConfig } from "../config.js";

export function signToken(userId) {
  return jwt.sign({ userId }, authConfig.jwtSecret, { expiresIn: authConfig.jwtExpiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, authConfig.jwtSecret);
}
