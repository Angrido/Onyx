import {
  createDecipheriv,
  createECDH,
  createHmac,
  createPublicKey,
  randomBytes,
  verify,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  base64url,
  encryptPayload,
  fromBase64url,
  generateVapidKeys,
  vapidAuthorization,
} from "../../src/infrastructure/web-push";

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function expand(prk: Buffer, info: Buffer, length: number): Buffer {
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

function decrypt(body: Buffer, receiver: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const keyLength = body.readUInt8(20);
  const senderKey = body.subarray(21, 21 + keyLength);
  const cipherText = body.subarray(21 + keyLength);
  const shared = receiver.computeSecret(senderKey);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), receiver.getPublicKey(), senderKey]);
  const ikm = expand(hmac(auth, shared), info, 32);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(cipherText.subarray(cipherText.length - 16));
  const plain = Buffer.concat([
    decipher.update(cipherText.subarray(0, cipherText.length - 16)),
    decipher.final(),
  ]);
  expect(plain.at(-1)).toBe(2);
  return plain.subarray(0, -1).toString("utf8");
}

describe("web push", () => {
  it("encrypts a payload only the subscribed browser can read", () => {
    const receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const auth = randomBytes(16);
    const body = encryptPayload(Buffer.from('{"title":"Run failed"}'), {
      p256dh: base64url(receiver.getPublicKey()),
      auth: base64url(auth),
    });
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(decrypt(body, receiver, auth)).toBe('{"title":"Run failed"}');
  });

  it("matches the example of RFC 8291", () => {
    const sender = createECDH("prime256v1");
    sender.setPrivateKey(fromBase64url("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"));
    const body = encryptPayload(
      Buffer.from("When I grow up, I want to be a watermelon"),
      {
        p256dh:
          "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      { salt: fromBase64url("DGv6ra1nlYgDCS1FRnbzlw"), ephemeral: sender },
    );
    expect(base64url(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("signs a VAPID token for the push service origin", () => {
    const keys = generateVapidKeys();
    const header = vapidAuthorization(
      "https://push.example.net/send/abc",
      keys,
      "mailto:onyx@localhost",
      new Date("2026-10-04T10:00:00Z"),
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head, claims, signature, key] = match ?? [];
    expect(key).toBe(keys.publicKey);
    expect(JSON.parse(fromBase64url(claims ?? "").toString())).toEqual({
      aud: "https://push.example.net",
      exp: Date.parse("2026-10-04T10:00:00Z") / 1000 + 12 * 3600,
      sub: "mailto:onyx@localhost",
    });
    const publicKey = fromBase64url(keys.publicKey);
    const verifier = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: base64url(publicKey.subarray(1, 33)),
        y: base64url(publicKey.subarray(33, 65)),
      },
      format: "jwk",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${head}.${claims}`),
        { key: verifier, dsaEncoding: "ieee-p1363" },
        fromBase64url(signature ?? ""),
      ),
    ).toBe(true);
  });
});
