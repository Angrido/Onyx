import { pino, type DestinationStream, type Logger, type LoggerOptions } from "pino";
import type { AppConfig } from "./config";
import type { LogBuffer } from "./infrastructure/log-buffer";

export interface LoggerSinks {
  buffer?: LogBuffer;
  destination?: DestinationStream;
}

export function createLogger(
  config: Pick<AppConfig, "env" | "logLevel">,
  sinks: LoggerSinks = {},
): Logger {
  const pretty = config.env === "development" && process.stdout.isTTY && !sinks.destination;
  const buffer = sinks.buffer;
  const options: LoggerOptions = {
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
    ...(buffer ? { hooks: { streamWrite: (line: string) => buffer.ingest(line) } } : {}),
    ...(pretty
      ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } } }
      : {}),
  };
  return sinks.destination ? pino(options, sinks.destination) : pino(options);
}
