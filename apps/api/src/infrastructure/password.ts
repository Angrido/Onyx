import { hash, verify } from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

let dummyHash: Promise<string> | null = null;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export async function burnVerificationTime(password: string): Promise<void> {
  dummyHash ??= hashPassword("onyx-timing-equaliser");
  await verifyPassword(await dummyHash, password);
}
