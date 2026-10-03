import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const PREFIX = "onyx:v1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class SecretVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretVaultError";
  }
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

function decodeKey(text: string): Buffer {
  const key = Buffer.from(text.trim(), "base64");
  if (key.length !== KEY_BYTES)
    throw new SecretVaultError(`The secret key must be ${KEY_BYTES} bytes encoded in base64`);
  return key;
}

export class SecretVault {
  private constructor(
    private readonly key: Buffer,
    readonly keyFile: string | null,
    readonly created: boolean,
  ) {}

  static fromKey(base64: string): SecretVault {
    return new SecretVault(decodeKey(base64), null, false);
  }

  static async open(keyFile: string, envKey?: string | null): Promise<SecretVault> {
    if (envKey) return new SecretVault(decodeKey(envKey), null, false);
    const existing = await readFile(keyFile, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing !== null) {
      const info = await stat(keyFile);
      if ((info.mode & 0o077) !== 0) await chmod(keyFile, 0o600);
      return new SecretVault(decodeKey(existing), keyFile, false);
    }
    await mkdir(dirname(keyFile), { recursive: true, mode: 0o700 });
    const key = randomBytes(KEY_BYTES);
    await writeFile(keyFile, `${key.toString("base64")}\n`, { mode: 0o600, flag: "wx" });
    return new SecretVault(key, keyFile, true);
  }

  seal(plaintext: string, purpose: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(purpose, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${body.toString("base64url")}`;
  }

  open(sealed: string, purpose: string): string {
    if (!isSealed(sealed)) throw new SecretVaultError("The value is not sealed");
    const [iv, tag, body] = sealed.slice(PREFIX.length).split(":");
    if (!iv || !tag || body === undefined)
      throw new SecretVaultError("The sealed value is malformed");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
      decipher.setAAD(Buffer.from(purpose, "utf8"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(body, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new SecretVaultError(
        "The secret cannot be decrypted with this key: the key file changed or the value was tampered with",
      );
    }
  }

  reveal(value: string, purpose: string): string | null {
    if (!isSealed(value)) return value;
    try {
      return this.open(value, purpose);
    } catch {
      return null;
    }
  }
}
