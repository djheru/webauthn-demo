// --- Relying Party config ---
export const rpName = "Passkey Vault";
export const rpID = "localhost";
export const origin = "http://localhost:5173";

// --- Secrets (replace all of these in production) ---
export const sessionSecret = "replace-this-in-production";
export const cookieSecret = "replace-this-in-production";
export const csrfSecret = "replace-this-csrf-secret-in-production";

// --- Session type augmentation ---
declare module "express-session" {
  interface SessionData {
    userId?: string;
    stepUpUntil?: number;
  }
}
