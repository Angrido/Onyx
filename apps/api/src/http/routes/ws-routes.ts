import { ClientMessageSchema } from "@onyx/contracts";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { Container } from "../../container";

const HEARTBEAT_INTERVAL_MS = 30_000;

export function registerWsRoutes(app: FastifyInstance, container: Container): void {
  const { hub, scheduler, terminals, logger } = container;

  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    const subscriber = hub.connect(socket);
    let alive = true;

    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();

    socket.on("pong", () => {
      alive = true;
    });

    socket.on("message", (raw) => {
      alive = true;
      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        hub.sendError(subscriber, "BAD_REQUEST", "Messages must be JSON");
        return;
      }
      const parsed = ClientMessageSchema.safeParse(payload);
      if (!parsed.success) {
        hub.sendError(subscriber, "BAD_REQUEST", "Unknown or malformed message");
        return;
      }
      const message = parsed.data;
      switch (message.type) {
        case "subscribe":
          hub
            .subscribe(subscriber, message.data.channels, message.data.since ?? {})
            .catch((error: unknown) => {
              logger.error({ err: error }, "WebSocket replay failed");
              hub.sendError(subscriber, "INTERNAL", "Replay failed");
            });
          return;
        case "unsubscribe":
          hub.unsubscribe(subscriber, message.data.channels);
          return;
        case "run.abort":
          scheduler.abortRun(message.data.runId).then(
            (aborted) => {
              if (!aborted) hub.sendError(subscriber, "CONFLICT", "Run is not active");
            },
            (error: unknown) => logger.error({ err: error }, "Abort via WebSocket failed"),
          );
          return;
        case "pty.input":
        case "pty.resize":
          try {
            if (message.type === "pty.input")
              terminals.input(message.data.terminalId, message.data.data);
            else terminals.resize(message.data.terminalId, message.data.cols, message.data.rows);
          } catch (error) {
            hub.sendError(
              subscriber,
              "CONFLICT",
              error instanceof Error ? error.message : "Terminal is not available",
            );
          }
          return;
        case "ping":
          hub.sendPong(subscriber);
          return;
      }
    });

    socket.on("close", () => {
      clearInterval(heartbeat);
      hub.disconnect(subscriber);
    });
  });
}
