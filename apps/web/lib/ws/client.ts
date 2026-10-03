import type { ServerMessage } from "@onyx/contracts";
import { WS_PROTOCOL_VERSION } from "@onyx/contracts/client";

export type ConnectionState = "connecting" | "open" | "closed";
export type ChannelListener = (message: ServerMessage) => void;

const MAX_BACKOFF_MS = 15_000;

export interface WsEndpointSettings {
  url?: string | undefined;
  port?: string | undefined;
}

export function resolveWsUrl(
  location: Pick<Location, "protocol" | "hostname" | "host">,
  settings: WsEndpointSettings,
): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  if (settings.url) return settings.url.replaceAll("{hostname}", location.hostname);
  if (settings.port) return `${protocol}://${location.hostname}:${settings.port}/ws`;
  return `${protocol}://${location.host}/ws`;
}

export function defaultWsUrl(): string {
  return resolveWsUrl(window.location, {
    url: process.env.NEXT_PUBLIC_ONYX_WS_URL,
    port: process.env.NEXT_PUBLIC_ONYX_WS_PORT,
  });
}

export class WsClient {
  private socket: WebSocket | null = null;
  private state: ConnectionState = "closed";
  private readonly listeners = new Map<string, Set<ChannelListener>>();
  private readonly cursors = new Map<string, number>();
  private readonly stateListeners = new Set<() => void>();
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private readonly url: string) {}

  getState(): ConnectionState {
    return this.state;
  }

  onStateChange(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const socket = this.socket;
    this.socket = null;
    if (socket?.readyState === WebSocket.CONNECTING) {
      socket.onopen = () => socket.close();
    } else {
      socket?.close();
    }
    this.setState("closed");
  }

  subscribe(channel: string, listener: ChannelListener, since?: number): () => void {
    let set = this.listeners.get(channel);
    const isNewChannel = set === undefined;
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener);
    if (since !== undefined)
      this.cursors.set(channel, Math.max(this.cursors.get(channel) ?? 0, since));
    if (isNewChannel && this.state === "open") this.sendSubscribe([channel]);

    return () => {
      const current = this.listeners.get(channel);
      if (!current) return;
      current.delete(listener);
      if (current.size > 0) return;
      this.listeners.delete(channel);
      this.cursors.delete(channel);
      if (this.state === "open") {
        this.send({ v: WS_PROTOCOL_VERSION, type: "unsubscribe", data: { channels: [channel] } });
      }
    };
  }

  send(message: object): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private open(): void {
    this.setState("connecting");
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.setState("open");
      const channels = [...this.listeners.keys()];
      if (channels.length > 0) this.sendSubscribe(channels);
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      this.route(message);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setState("closed");
      this.scheduleReconnect();
    };
    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private route(message: ServerMessage): void {
    if (!("ch" in message)) return;
    if ("seq" in message && message.ch.startsWith("run:")) {
      this.cursors.set(message.ch, Math.max(this.cursors.get(message.ch) ?? 0, message.seq));
    }
    for (const listener of this.listeners.get(message.ch) ?? []) listener(message);
  }

  private sendSubscribe(channels: string[]): void {
    const since: Record<string, number> = {};
    for (const channel of channels) {
      const cursor = this.cursors.get(channel);
      if (cursor !== undefined) since[channel] = cursor;
    }
    this.send({
      v: WS_PROTOCOL_VERSION,
      type: "subscribe",
      data: { channels, ...(Object.keys(since).length > 0 ? { since } : {}) },
    });
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.stateListeners) listener();
  }
}
