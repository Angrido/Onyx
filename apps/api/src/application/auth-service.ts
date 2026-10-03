import { createHash, randomBytes } from "node:crypto";
import type { UserDto } from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import { conflict, unauthorized } from "../errors";
import { burnVerificationTime, hashPassword, verifyPassword } from "../infrastructure/password";

export interface IssuedSession {
  token: string;
  expiresAt: Date;
  user: UserDto;
}

export interface SessionMetadata {
  userAgent: string | null;
  ip: string | null;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sessionTtlMs: number,
  ) {}

  async setupRequired(): Promise<boolean> {
    return (await this.prisma.user.count()) === 0;
  }

  async setup(username: string, password: string, meta: SessionMetadata): Promise<IssuedSession> {
    const passwordHash = await hashPassword(password);
    const user = await this.prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) throw conflict("Onyx is already initialised");
      return tx.user.create({ data: { username, passwordHash, lastLoginAt: new Date() } });
    });
    return this.issueSession({ id: user.id, username: user.username }, meta);
  }

  async login(username: string, password: string, meta: SessionMetadata): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) {
      await burnVerificationTime(password);
      throw unauthorized("Invalid credentials");
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw unauthorized("Invalid credentials");
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.prisma.userSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return this.issueSession({ id: user.id, username: user.username }, meta);
  }

  async logout(token: string): Promise<void> {
    await this.prisma.userSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }

  async resolve(token: string): Promise<UserDto | null> {
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) return null;
    return { id: session.user.id, username: session.user.username };
  }

  private async issueSession(user: UserDto, meta: SessionMetadata): Promise<IssuedSession> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.sessionTtlMs);
    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
        ip: meta.ip,
        expiresAt,
      },
    });
    return { token, expiresAt, user };
  }
}
