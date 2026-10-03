import {
  WS_PROTOCOL_VERSION,
  channels as channelNames,
  runIdFromChannel,
  type RunItem,
  type SequencedServerMessage,
  type ServerMessage,
  type ServerMessageOf,
  type TerminalDto,
} from "@onyx/contracts";

export interface WsConnection {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly bufferedAmount: number;
}

export interface StoredRunEvent {
  seq: number;
  ts: string;
  items: RunItem[];
}

export type RunReplaySource = (
  runId: string,
  afterSeq: number,
  beforeSeq: number | null,
) => Promise<StoredRunEvent[]>;

export type SnapshotProvider = (channel: string) => ServerMessage[];

export interface WsHubOptions {
  bufferSize?: number;
  maxChannels?: number;
  maxBufferedBytes?: number;
}

interface ChannelState {
  lastSeq: number;
  buffer: SequencedServerMessage[];
}

interface SubscriptionState {
  lastSentSeq: number;
  replaying: boolean;
  queued: SequencedServerMessage[];
}

export class Subscriber {
  readonly subscriptions = new Map<string, SubscriptionState>();

  constructor(
    readonly id: number,
    readonly connection: WsConnection,
  ) {}
}

export interface RunEventPublisher {
  publishRunEvent(runId: string, seq: number, ts: string, items: RunItem[]): void;
  publishRunDelta(runId: string, index: number, text: string): void;
}

function now(): string {
  return new Date().toISOString();
}

export function ptyOutputMessage(terminalId: string, data: string): ServerMessageOf<"pty.output"> {
  return {
    v: WS_PROTOCOL_VERSION,
    type: "pty.output",
    ch: channelNames.pty(terminalId),
    ts: now(),
    data: { terminalId, data },
  };
}

export function ptyStateMessage(terminal: TerminalDto): ServerMessageOf<"pty.state"> {
  return {
    v: WS_PROTOCOL_VERSION,
    type: "pty.state",
    ch: channelNames.pty(terminal.id),
    ts: now(),
    data: { terminal },
  };
}

export class WsHub implements RunEventPublisher {
  private readonly channelStates = new Map<string, ChannelState>();
  private readonly listeners = new Map<string, Set<Subscriber>>();
  private readonly subscribers = new Set<Subscriber>();
  private readonly snapshotProviders: Array<{ prefix: string; provider: SnapshotProvider }> = [];
  private nextSubscriberId = 1;
  private readonly bufferSize: number;
  private readonly maxChannels: number;
  private readonly maxBufferedBytes: number;

  constructor(
    private readonly replaySource: RunReplaySource,
    options: WsHubOptions = {},
  ) {
    this.bufferSize = options.bufferSize ?? 500;
    this.maxChannels = options.maxChannels ?? 512;
    this.maxBufferedBytes = options.maxBufferedBytes ?? 8 * 1024 * 1024;
  }

  get connectionCount(): number {
    return this.subscribers.size;
  }

  registerSnapshot(prefix: string, provider: SnapshotProvider): void {
    this.snapshotProviders.push({ prefix, provider });
  }

  connect(connection: WsConnection): Subscriber {
    const subscriber = new Subscriber(this.nextSubscriberId++, connection);
    this.subscribers.add(subscriber);
    return subscriber;
  }

  disconnect(subscriber: Subscriber): void {
    for (const channel of subscriber.subscriptions.keys()) {
      this.listeners.get(channel)?.delete(subscriber);
    }
    subscriber.subscriptions.clear();
    this.subscribers.delete(subscriber);
  }

  async subscribe(
    subscriber: Subscriber,
    channels: readonly string[],
    since: Readonly<Record<string, number>> = {},
  ): Promise<void> {
    const replays: Array<{ channel: string; since: number }> = [];
    const fresh: string[] = [];
    for (const channel of channels) {
      if (subscriber.subscriptions.has(channel)) continue;
      fresh.push(channel);
      const cursor = since[channel];
      subscriber.subscriptions.set(channel, {
        lastSentSeq: cursor ?? this.channelStates.get(channel)?.lastSeq ?? 0,
        replaying: cursor !== undefined,
        queued: [],
      });
      this.listenersOf(channel).add(subscriber);
      if (cursor !== undefined) replays.push({ channel, since: cursor });
    }
    this.send(subscriber, {
      v: WS_PROTOCOL_VERSION,
      type: "subscribed",
      ts: now(),
      data: { channels: [...channels] },
    });
    for (const channel of fresh) {
      if (since[channel] !== undefined) continue;
      for (const { prefix, provider } of this.snapshotProviders) {
        if (!channel.startsWith(prefix)) continue;
        for (const message of provider(channel)) this.send(subscriber, message);
      }
    }
    await Promise.all(
      replays.map((replay) => this.replay(subscriber, replay.channel, replay.since)),
    );
  }

  unsubscribe(subscriber: Subscriber, channels: readonly string[]): void {
    for (const channel of channels) {
      subscriber.subscriptions.delete(channel);
      this.listeners.get(channel)?.delete(subscriber);
    }
  }

  publishRunEvent(runId: string, seq: number, ts: string, items: RunItem[]): void {
    this.publishSequenced({
      v: WS_PROTOCOL_VERSION,
      type: "run.event",
      ch: channelNames.run(runId),
      seq,
      ts,
      data: { runId, items },
    });
  }

  publishRunDelta(runId: string, index: number, text: string): void {
    this.publishTransient({
      v: WS_PROTOCOL_VERSION,
      type: "run.delta",
      ch: channelNames.run(runId),
      ts: now(),
      data: { runId, index, text },
    });
  }

  publishIndexProgress(data: ServerMessageOf<"index.progress">["data"]): void {
    this.publishTransient({
      v: WS_PROTOCOL_VERSION,
      type: "index.progress",
      ch: channelNames.project(data.projectId),
      ts: now(),
      data,
    });
  }

  publishPtyOutput(terminalId: string, data: string): void {
    this.publishTransient(ptyOutputMessage(terminalId, data));
  }

  publishPtyState(terminal: TerminalDto): void {
    this.publishTransient(ptyStateMessage(terminal));
  }

  hasListeners(channel: string): boolean {
    return (this.listeners.get(channel)?.size ?? 0) > 0;
  }

  publishTaskStatus(data: ServerMessageOf<"task.status">["data"]): void {
    for (const channel of [channelNames.task(data.taskId), channelNames.project(data.projectId)]) {
      this.publishSequenced({
        v: WS_PROTOCOL_VERSION,
        type: "task.status",
        ch: channel,
        seq: this.nextSeq(channel),
        ts: now(),
        data,
      });
    }
  }

  publishSystemRuns(data: ServerMessageOf<"system.runs">["data"]): void {
    this.publishSequenced({
      v: WS_PROTOCOL_VERSION,
      type: "system.runs",
      ch: channelNames.system,
      seq: this.nextSeq(channelNames.system),
      ts: now(),
      data,
    });
  }

  sendError(subscriber: Subscriber, code: string, message: string): void {
    this.send(subscriber, {
      v: WS_PROTOCOL_VERSION,
      type: "error",
      ts: now(),
      data: { code, message },
    });
  }

  sendPong(subscriber: Subscriber): void {
    this.send(subscriber, { v: WS_PROTOCOL_VERSION, type: "pong", ts: now() });
  }

  private publishTransient(message: ServerMessage & { ch: string }): void {
    for (const subscriber of this.listeners.get(message.ch) ?? []) {
      if (subscriber.subscriptions.get(message.ch)?.replaying === false)
        this.send(subscriber, message);
    }
  }

  private async replay(subscriber: Subscriber, channel: string, since: number): Promise<void> {
    const state = subscriber.subscriptions.get(channel);
    if (!state) return;
    const buffered = (this.channelStates.get(channel)?.buffer ?? []).filter(
      (message) => message.seq > since,
    );
    const firstBufferedSeq = buffered[0]?.seq ?? null;
    const runId = runIdFromChannel(channel);
    let stored: SequencedServerMessage[] = [];
    if (runId !== null && (firstBufferedSeq === null || firstBufferedSeq > since + 1)) {
      const rows = await this.replaySource(runId, since, firstBufferedSeq);
      stored = rows.map((row) => ({
        v: WS_PROTOCOL_VERSION,
        type: "run.event",
        ch: channel,
        seq: row.seq,
        ts: row.ts,
        data: { runId, items: row.items },
      }));
    }
    if (subscriber.subscriptions.get(channel) !== state) return;
    state.replaying = false;
    const backlog = [...stored, ...buffered, ...state.queued];
    state.queued = [];
    for (const message of backlog) this.deliver(subscriber, state, message);
  }

  private publishSequenced(message: SequencedServerMessage): void {
    const state = this.stateOf(message.ch);
    state.lastSeq = Math.max(state.lastSeq, message.seq);
    state.buffer.push(message);
    if (state.buffer.length > this.bufferSize) state.buffer.shift();
    for (const subscriber of this.listeners.get(message.ch) ?? []) {
      const subscription = subscriber.subscriptions.get(message.ch);
      if (!subscription) continue;
      if (subscription.replaying) subscription.queued.push(message);
      else this.deliver(subscriber, subscription, message);
    }
  }

  private deliver(
    subscriber: Subscriber,
    subscription: SubscriptionState,
    message: SequencedServerMessage,
  ): void {
    if (message.seq <= subscription.lastSentSeq) return;
    subscription.lastSentSeq = message.seq;
    this.send(subscriber, message);
  }

  private send(subscriber: Subscriber, message: ServerMessage): void {
    if (!this.subscribers.has(subscriber)) return;
    if (subscriber.connection.bufferedAmount > this.maxBufferedBytes) {
      subscriber.connection.close(1013, "Client too slow");
      this.disconnect(subscriber);
      return;
    }
    subscriber.connection.send(JSON.stringify(message));
  }

  private nextSeq(channel: string): number {
    return this.stateOf(channel).lastSeq + 1;
  }

  private stateOf(channel: string): ChannelState {
    const existing = this.channelStates.get(channel);
    if (existing) {
      this.channelStates.delete(channel);
      this.channelStates.set(channel, existing);
      return existing;
    }
    this.evictIdleChannels();
    const created: ChannelState = { lastSeq: 0, buffer: [] };
    this.channelStates.set(channel, created);
    return created;
  }

  private listenersOf(channel: string): Set<Subscriber> {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    return set;
  }

  private evictIdleChannels(): void {
    if (this.channelStates.size < this.maxChannels) return;
    for (const channel of this.channelStates.keys()) {
      if (this.channelStates.size < this.maxChannels) return;
      if (channel === channelNames.system) continue;
      if ((this.listeners.get(channel)?.size ?? 0) > 0) continue;
      this.channelStates.delete(channel);
      this.listeners.delete(channel);
    }
  }
}
