import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** AES-256-GCM for service-held secrets at rest (merchant agent keys, §7.5). */
function key(secret: string): Buffer {
  if (secret.length < 32) throw new Error("KEY_SEAL_SECRET must be at least 32 characters");
  return createHash("sha256").update(secret).digest();
}

export function seal(plain: Uint8Array, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function unseal(sealed: string, secret: string): Uint8Array {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1") throw new Error("unknown sealed format");
  const d = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return new Uint8Array(Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]));
}
