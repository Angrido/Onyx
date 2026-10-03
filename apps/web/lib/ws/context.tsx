"use client";

import type { ServerMessage } from "@onyx/contracts";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { WsClient, defaultWsUrl, type ConnectionState } from "./client";

const WsContext = createContext<WsClient | null>(null);

export function WsProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() =>
    typeof window === "undefined" ? null : new WsClient(defaultWsUrl()),
  );

  useEffect(() => {
    client?.start();
    return () => client?.stop();
  }, [client]);

  return <WsContext.Provider value={client}>{children}</WsContext.Provider>;
}

export function useWsClient(): WsClient | null {
  return useContext(WsContext);
}

const SERVER_STATE: ConnectionState = "connecting";

export function useConnectionState(): ConnectionState {
  const client = useWsClient();
  return useSyncExternalStore(
    (listener) => client?.onStateChange(listener) ?? (() => undefined),
    () => client?.getState() ?? SERVER_STATE,
    () => SERVER_STATE,
  );
}

export function useChannel(
  channel: string | null,
  handler: (message: ServerMessage) => void,
  options: { since?: number; enabled?: boolean } = {},
): void {
  const client = useWsClient();
  const handlerRef = useRef(handler);
  const { since, enabled = true } = options;

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!client || !channel || !enabled) return;
    return client.subscribe(channel, (message) => handlerRef.current(message), since);
  }, [client, channel, since, enabled]);
}
