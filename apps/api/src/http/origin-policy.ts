import { isIP } from "node:net";
import { hostname as machineHostname } from "node:os";

const LOCAL_NETWORK_SUFFIXES = [
  ".local",
  ".lan",
  ".home",
  ".home.arpa",
  ".internal",
  ".localdomain",
  ".intranet",
  ".private",
];

export interface OriginPolicy {
  isAllowed(origin: string, requestHost: string | undefined): boolean;
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

export function hostnameFromHostHeader(hostHeader: string): string {
  const value = hostHeader.trim();
  if (value.startsWith("[")) return normalizeHostname(value.slice(0, value.indexOf("]") + 1));
  const colons = value.split(":").length - 1;
  if (colons === 1) return normalizeHostname(value.slice(0, value.indexOf(":")));
  return normalizeHostname(value);
}

export function defaultMachineNames(): string[] {
  const name = normalizeHostname(machineHostname());
  return name.length > 0 ? [name, `${name}.local`] : [];
}

export function isNetworkLocalHostname(
  hostname: string,
  machineNames: ReadonlySet<string>,
): boolean {
  const name = normalizeHostname(hostname);
  if (name.length === 0) return false;
  if (isIP(name) !== 0) return true;
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (!name.includes(".")) return true;
  if (machineNames.has(name)) return true;
  return LOCAL_NETWORK_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export function createOriginPolicy(
  allowedOrigins: readonly string[],
  machineNames: readonly string[] = defaultMachineNames(),
): OriginPolicy {
  const explicit = new Set<string>();
  for (const entry of allowedOrigins) {
    try {
      explicit.add(new URL(entry).origin);
    } catch {
      continue;
    }
  }
  const machines = new Set(machineNames.map(normalizeHostname));

  return {
    isAllowed(origin, requestHost) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        return false;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
      if (explicit.has(parsed.origin)) return true;
      if (requestHost === undefined || requestHost.length === 0) return false;
      const originHost = normalizeHostname(parsed.hostname);
      const targetHost = hostnameFromHostHeader(requestHost);
      return originHost === targetHost && isNetworkLocalHostname(originHost, machines);
    },
  };
}
