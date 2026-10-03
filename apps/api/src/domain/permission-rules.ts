export const SECRET_READ_DENY_RULES: readonly string[] = [
  "Read(**/.env)",
  "Read(**/.env.*)",
  "Read(**/*.pem)",
  "Read(**/*.key)",
  "Read(**/*.p12)",
  "Read(**/id_rsa*)",
  "Read(**/id_ed25519*)",
];

export interface RunSettings {
  permissions: {
    deny: string[];
    allow: string[];
  };
}

export function buildRunSettings(extraDeny: readonly string[] = []): RunSettings {
  return {
    permissions: {
      deny: [...new Set([...SECRET_READ_DENY_RULES, ...extraDeny])],
      allow: [],
    },
  };
}
