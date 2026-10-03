import { hostname, networkInterfaces } from "node:os";
import type { NetworkAddress, NetworkInfo } from "@onyx/contracts";

export function listNetworkAddresses(): NetworkAddress[] {
  const addresses: NetworkAddress[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (entry.family === "IPv6" && entry.address.toLowerCase().startsWith("fe80")) continue;
      addresses.push({ interface: name, address: entry.address, family: entry.family });
    }
  }
  return addresses.sort((left, right) => left.family.localeCompare(right.family));
}

function portSuffix(host: string | undefined): string {
  if (!host) return "";
  const match = /:(\d+)$/.exec(host);
  if (!match || host.endsWith("]")) return "";
  const port = match[1];
  return port === "80" || port === "443" ? "" : `:${port}`;
}

export function describeNetwork(protocol: string, requestHost: string | undefined): NetworkInfo {
  const name = hostname();
  const mdnsName = `${name}.local`;
  const scheme = protocol === "https" ? "https" : "http";
  const port = portSuffix(requestHost);
  const addresses = listNetworkAddresses();
  const urls = [
    ...addresses
      .filter((entry) => entry.family === "IPv4")
      .map((entry) => `${scheme}://${entry.address}${port}`),
    `${scheme}://${mdnsName}${port}`,
  ];
  return {
    hostname: name,
    mdnsName,
    currentOrigin: requestHost ? `${scheme}://${requestHost}` : null,
    addresses,
    urls: [...new Set(urls)],
  };
}
