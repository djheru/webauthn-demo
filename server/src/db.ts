import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = path.join(__dirname, "..", "webauthn.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// --- Schema ---

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    webauthn_user_id BLOB NOT NULL,
    recovery_code_hash TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    device_type TEXT NOT NULL CHECK(device_type IN ('singleDevice','multiDevice')),
    backed_up INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    label TEXT DEFAULT 'Unnamed passkey',
    created_at TEXT DEFAULT (datetime('now')),
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    event TEXT NOT NULL,
    detail TEXT,
    ip TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS challenges (
    challenge TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK(purpose IN ('registration','authentication','step-up')),
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
`);

// --- Types ---

export type DbUser = {
  id: string;
  email: string;
  webauthn_user_id: Buffer;
  recovery_code_hash: string | null;
  created_at: string;
};

export type DbPasskey = {
  id: string;
  user_id: string;
  public_key: Buffer;
  counter: number;
  device_type: "singleDevice" | "multiDevice";
  backed_up: number;
  transports: string | null;
  label: string;
  created_at: string;
  last_used_at: string | null;
};

// --- User queries ---

const insertUser = db.prepare(
  `INSERT INTO users (id, email, webauthn_user_id) VALUES (?, ?, ?)`
);
const selectUserByEmail = db.prepare(`SELECT * FROM users WHERE email = ?`);
const selectUserById = db.prepare(`SELECT * FROM users WHERE id = ?`);
const updateRecoveryCode = db.prepare(
  `UPDATE users SET recovery_code_hash = ? WHERE id = ?`
);

export function createUser(
  id: string,
  email: string,
  webauthnUserId: Uint8Array
): DbUser {
  insertUser.run(id, email, Buffer.from(webauthnUserId));
  return selectUserById.get(id) as DbUser;
}

export function findUserByEmail(email: string): DbUser | undefined {
  return selectUserByEmail.get(email) as DbUser | undefined;
}

export function findUserById(id: string): DbUser | undefined {
  return selectUserById.get(id) as DbUser | undefined;
}

export function setRecoveryCodeHash(userId: string, hash: string) {
  updateRecoveryCode.run(hash, userId);
}

// --- Passkey queries ---

const insertPasskey = db.prepare(`
  INSERT INTO passkeys (id, user_id, public_key, counter, device_type, backed_up, transports, label)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectPasskeysByUser = db.prepare(
  `SELECT * FROM passkeys WHERE user_id = ?`
);
const selectPasskeyById = db.prepare(`SELECT * FROM passkeys WHERE id = ?`);
const updatePasskeyCounter = db.prepare(
  `UPDATE passkeys SET counter = ?, last_used_at = datetime('now') WHERE id = ?`
);
const updatePasskeyLabel = db.prepare(
  `UPDATE passkeys SET label = ? WHERE id = ? AND user_id = ?`
);
const deletePasskeyStmt = db.prepare(
  `DELETE FROM passkeys WHERE id = ? AND user_id = ?`
);
const countPasskeysByUser = db.prepare(
  `SELECT COUNT(*) as count FROM passkeys WHERE user_id = ?`
);

export function savePasskey(
  id: string,
  userId: string,
  publicKey: Uint8Array,
  counter: number,
  deviceType: "singleDevice" | "multiDevice",
  backedUp: boolean,
  transports?: string[],
  label?: string
) {
  insertPasskey.run(
    id,
    userId,
    Buffer.from(publicKey),
    counter,
    deviceType,
    backedUp ? 1 : 0,
    transports ? JSON.stringify(transports) : null,
    label ?? "Unnamed passkey"
  );
}

export function getPasskeysByUser(userId: string): DbPasskey[] {
  return selectPasskeysByUser.all(userId) as DbPasskey[];
}

export function getPasskeyById(id: string): DbPasskey | undefined {
  return selectPasskeyById.get(id) as DbPasskey | undefined;
}

export function updateCounter(passkeyId: string, newCounter: number) {
  updatePasskeyCounter.run(newCounter, passkeyId);
}

export function renamePasskey(
  passkeyId: string,
  userId: string,
  label: string
) {
  updatePasskeyLabel.run(label, passkeyId, userId);
}

export function deletePasskey(passkeyId: string, userId: string): boolean {
  const count = (countPasskeysByUser.get(userId) as { count: number }).count;
  if (count <= 1) return false;
  const result = deletePasskeyStmt.run(passkeyId, userId);
  return result.changes > 0;
}

// --- Challenge queries ---

const insertChallenge = db.prepare(`
  INSERT INTO challenges (challenge, user_id, purpose, expires_at)
  VALUES (?, ?, ?, datetime('now', '+5 minutes'))
`);
const selectAndDeleteChallenge = db.prepare(`
  DELETE FROM challenges WHERE challenge = ? AND purpose = ? RETURNING *
`);
const cleanExpiredChallenges = db.prepare(
  `DELETE FROM challenges WHERE expires_at < datetime('now')`
);

export function storeChallenge(
  challenge: string,
  userId: string,
  purpose: string
) {
  cleanExpiredChallenges.run();
  insertChallenge.run(challenge, userId, purpose);
}

export function consumeChallenge(
  challenge: string,
  purpose: string
): { user_id: string } | undefined {
  const row = selectAndDeleteChallenge.get(challenge, purpose) as any;
  if (!row) return undefined;
  return { user_id: row.user_id };
}

// --- Audit log ---

const insertAuditLog = db.prepare(
  `INSERT INTO audit_log (user_id, event, detail, ip) VALUES (?, ?, ?, ?)`
);

export function logAuditEvent(
  userId: string | null,
  event: string,
  detail: string,
  ip: string
) {
  insertAuditLog.run(userId, event, detail, ip);
}

// --- Helpers ---

export function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export default db;
