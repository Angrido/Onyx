"use client";

import "@xterm/xterm/css/xterm.css";
import {
  WS_PROTOCOL_VERSION,
  channels,
  type ServerMessage,
  type TerminalDto,
} from "@onyx/contracts";
import { useEffect, useRef } from "react";
import { useWsClient } from "@/lib/ws/context";
import { cn } from "@/lib/utils";

const THEME = {
  background: "#0c0c11",
  foreground: "#ececf1",
  cursor: "#a78bfa",
  cursorAccent: "#0c0c11",
  selectionBackground: "#a78bfa44",
  black: "#1c1c24",
  brightBlack: "#5c5c6e",
  red: "#f0716b",
  brightRed: "#ff8f87",
  green: "#5fd49a",
  brightGreen: "#7fe8b2",
  yellow: "#f2c66d",
  brightYellow: "#ffd88c",
  blue: "#6cb6f0",
  brightBlue: "#8ccaff",
  magenta: "#b08cf7",
  brightMagenta: "#c9adff",
  cyan: "#5fd3e0",
  brightCyan: "#85e6f0",
  white: "#d6d6de",
  brightWhite: "#ffffff",
};

export function TerminalView({
  terminalId,
  interactive,
  onState,
  onOutput,
  className,
}: {
  terminalId: string;
  interactive: boolean;
  onState?: (terminal: TerminalDto) => void;
  onOutput?: (data: string) => void;
  className?: string;
}) {
  const client = useWsClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const onStateRef = useRef(onState);
  const onOutputRef = useRef(onOutput);
  const interactiveRef = useRef(interactive);

  useEffect(() => {
    onStateRef.current = onState;
    onOutputRef.current = onOutput;
    interactiveRef.current = interactive;
  }, [onState, onOutput, interactive]);

  useEffect(() => {
    const container = containerRef.current;
    if (!client || !container) return;
    let disposed = false;
    let cleanup = () => {};

    void Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]).then(
      ([{ Terminal }, { FitAddon }]) => {
        if (disposed) return;
        const term = new Terminal({
          cursorBlink: true,
          fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, Menlo, monospace",
          fontSize: 13,
          lineHeight: 1.15,
          scrollback: 5_000,
          allowProposedApi: false,
          theme: THEME,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(container);
        const send = (message: object) => client.send({ v: WS_PROTOCOL_VERSION, ...message });
        const refit = () => {
          try {
            fit.fit();
          } catch {
            return;
          }
        };
        refit();
        const input = term.onData((data) => {
          if (interactiveRef.current) send({ type: "pty.input", data: { terminalId, data } });
        });
        const resize = term.onResize(({ cols, rows }) => {
          if (interactiveRef.current)
            send({ type: "pty.resize", data: { terminalId, cols, rows } });
        });
        const unsubscribe = client.subscribe(channels.pty(terminalId), (message: ServerMessage) => {
          if (message.type === "pty.output") {
            if (message.data.reset) term.reset();
            term.write(message.data.data);
            onOutputRef.current?.(message.data.data);
          } else if (message.type === "pty.state") {
            onStateRef.current?.(message.data.terminal);
          }
        });
        const observer = new ResizeObserver(() => refit());
        observer.observe(container);
        if (interactiveRef.current) {
          send({ type: "pty.resize", data: { terminalId, cols: term.cols, rows: term.rows } });
          term.focus();
        }
        cleanup = () => {
          observer.disconnect();
          unsubscribe();
          input.dispose();
          resize.dispose();
          term.dispose();
        };
      },
    );

    return () => {
      disposed = true;
      cleanup();
    };
  }, [client, terminalId]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-[#0c0c11] p-2",
        !interactive && "opacity-80",
        className,
      )}
      data-testid="terminal-view"
    >
      <div ref={containerRef} className="size-full" />
    </div>
  );
}
