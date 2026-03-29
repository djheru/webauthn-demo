import { doubleCsrf } from "csrf-csrf";
import express from "express";
import rateLimit from "express-rate-limit";

/** Extract the WebAuthn challenge from a base64url-encoded clientDataJSON string. */
export const extractChallenge = (clientDataJSONBase64url: string): string =>
  JSON.parse(
    Buffer.from(clientDataJSONBase64url, "base64url").toString(),
  ).challenge;

export const getClientIp = (req: express.Request): string =>
  (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
  req.ip ||
  "unknown";

export const requireSession = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

export const requireRecentStepUp = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  if (!req.session.stepUpUntil || req.session.stepUpUntil < Date.now()) {
    return res.status(403).json({ error: "Fresh verification required" });
  }
  next();
};

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please slow down" },
});

export const createCsrfProtection = (secret: string) =>
  doubleCsrf({
    getSecret: () => secret,
    cookieName: "__csrf",
    cookieOptions: { httpOnly: true, sameSite: "lax" as const, secure: false },
    getTokenFromRequest: (req) => req.headers["x-csrf-token"] as string,
  });
