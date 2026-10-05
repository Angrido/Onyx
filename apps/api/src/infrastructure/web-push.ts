import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
} from "node:crypto";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushDelivery {
  status: number;
  gone: boolean;
}

const RECORD_SIZE = 4096;
const TOKEN_SECONDS = 12 * 3600;

export function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function fromBase64url(text: string): Buffer {
  return Buffer.from(text, "base64url");
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: base64url(ecdh.getPublicKey()), privateKey: base64url(ecdh.getPrivateKey()) };
}

function privateKeyObject(keys: VapidKeys) {
  const publicKey = fromBase64url(keys.publicKey);
  return createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: base64url(publicKey.subarray(1, 33)),
      y: base64url(publicKey.subarray(33, 65)),
    },
    format: "jwk",
  });
}

export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now = new Date(),
): string {
  const header = base64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now.getTime() / 1000) + TOKEN_SECONDS,
        sub: subject,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: privateKeyObject(keys),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${unsigned}.${base64url(signature)}, k=${keys.publicKey}`;
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function expand(prk: Buffer, info: Buffer, length: number): Buffer {
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

export function encryptPayload(
  payload: Buffer,
  target: Pick<PushTarget, "p256dh" | "auth">,
  options: { salt?: Buffer; ephemeral?: ReturnType<typeof createECDH> } = {},
): Buffer {
  const receiverKey = fromBase64url(target.p256dh);
  const authSecret = fromBase64url(target.auth);
  const ephemeral = options.ephemeral ?? createECDH("prime256v1");
  if (!options.ephemeral) ephemeral.generateKeys();
  const senderKey = ephemeral.getPublicKey();
  const shared = ephemeral.computeSecret(receiverKey);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), receiverKey, senderKey]);
  const ikm = expand(hmac(authSecret, shared), keyInfo, 32);
  const salt = options.salt ?? randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderKey.length, 20);
  return Buffer.concat([header, senderKey, body]);
}

export async function sendWebPush(
  target: PushTarget,
  payload: string,
  keys: VapidKeys,
  subject: string,
  fetcher: typeof fetch = fetch,
  urgency: "normal" | "high" = "normal",
): Promise<PushDelivery> {
  const response = await fetcher(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidAuthorization(target.endpoint, keys, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: urgency,
    },
    body: new Uint8Array(encryptPayload(Buffer.from(payload, "utf8"), target)),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, gone: response.status === 404 || response.status === 410 };
}
