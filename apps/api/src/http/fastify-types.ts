import type { UserDto } from "@onyx/contracts";

declare module "fastify" {
  interface FastifyRequest {
    user: UserDto | null;
    sessionToken: string | null;
  }

  interface FastifyContextConfig {
    public?: boolean;
  }
}

export {};
