import { createReadStream } from "node:fs";
import type { BackupDto, BackupListResponse, BackupVerifyResult } from "@onyx/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { notFound } from "../../errors";

const NameParamsSchema = z.object({ name: z.string().min(1).max(80) });

function actorOf(request: FastifyRequest): string {
  return request.user ? `user:${request.user.username}` : "user:unknown";
}

function nameParam(params: unknown): string {
  return NameParamsSchema.parse(params).name;
}

export function registerBackupRoutes(app: FastifyInstance, container: Container): void {
  const { backups } = container;

  app.get("/api/backups", async (): Promise<BackupListResponse> => backups.list());

  app.post("/api/backups", async (request, reply): Promise<BackupDto> => {
    const created = await backups.create("manual", actorOf(request));
    reply.status(201);
    return created;
  });

  app.post("/api/backups/:name/verify", async (request): Promise<BackupVerifyResult> =>
    backups.verify(nameParam(request.params)),
  );

  app.get("/api/backups/:name/download", async (request, reply) => {
    const name = nameParam(request.params);
    const path = backups.pathOf(name);
    if (!(await backups.exists(name))) throw notFound("Backup");
    reply.header("content-type", "application/vnd.sqlite3");
    reply.header("content-disposition", `attachment; filename="${name}"`);
    return reply.send(createReadStream(path));
  });
}
