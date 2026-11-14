import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for secrets stored in the database (AES-256-GCM).
 * Format: "v1:" + base64(iv[12] | tag[16] | ciphertext).
 *
 * `context` is bound as additional authenticated data (e.g. organization id +
 * provider), so a ciphertext copied to another row fails to decrypt.
 */
const VERSION = "v1:";

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

export function encryptSecret(plaintext: string, key: Buffer, context: string): string {
  if (key.length !== 32) throw new SecretBoxError("Kunci enkripsi harus 32 byte.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return VERSION + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(box: string, key: Buffer, context: string): string {
  if (!box.startsWith(VERSION)) throw new SecretBoxError("Format rahasia tidak dikenal.");
  const raw = Buffer.from(box.slice(VERSION.length), "base64");
  if (raw.length < 29) throw new SecretBoxError("Rahasia rusak.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError("Rahasia tidak dapat dibuka (kunci enkripsi berubah atau data rusak).");
  }
}

/** Display hint that never reveals the secret: "gsk_…a1b2". */
export function secretHint(secret: string): string {
  const s = secret.trim();
  if (s.length <= 8) return "…";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
