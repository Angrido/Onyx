import { pino, type Logger } from "pino";
import type { AppConfig } from "./config";

export function createLogger(config: Pick<AppConfig, "env" | "logLevel">): Logger {
  const pretty = config.env === "development" && process.stdout.isTTY;
  return pino({
    level: config.logLevel,
    redact: {
      paths: [
        "req.headers.cookie",
        "req.headers.authorization",
        "res.headers['set-cookie']",
        "*.password",
        "*.ANTHROPIC_API_KEY",
        "*.CLAUDE_CODE_OAUTH_TOKEN",
      ],
      censor: "[redacted]",
    },
    ...(pretty
      ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } } }
      : {}),
  });
}
