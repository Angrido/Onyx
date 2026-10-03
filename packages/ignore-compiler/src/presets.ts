import { rule, type PolicyRule } from "./rules";

function security(pattern: string, reason: string): PolicyRule {
  return rule(pattern, { source: "SECURITY", locked: true, reason });
}

function preset(pattern: string, reason: string): PolicyRule {
  return rule(pattern, { source: "PRESET", reason });
}

export const SECURITY_RULES: readonly PolicyRule[] = [
  security(".env", "Environment secrets"),
  security(".env.*", "Environment secrets"),
  security("*.pem", "Private keys and certificates"),
  security("*.key", "Private keys"),
  security("*.p12", "Certificate bundles"),
  security("*.pfx", "Certificate bundles"),
  security("*.keystore", "Key stores"),
  security("id_rsa*", "SSH keys"),
  security("id_ed25519*", "SSH keys"),
  security(".npmrc", "Registry tokens"),
  security(".netrc", "Machine credentials"),
];

export const AGGRESSIVE_PRESET: readonly PolicyRule[] = [
  preset("node_modules/", "Dependencies"),
  preset("vendor/", "Dependencies"),
  preset(".pnpm-store/", "Dependencies"),
  preset(".venv/", "Python virtual environment"),
  preset("venv/", "Python virtual environment"),
  preset("__pycache__/", "Bytecode cache"),
  preset("dist/", "Build output"),
  preset("build/", "Build output"),
  preset(".next/", "Build output"),
  preset("out/", "Build output"),
  preset(".turbo/", "Build cache"),
  preset("coverage/", "Test coverage reports"),
  preset("pnpm-lock.yaml", "Lockfile"),
  preset("package-lock.json", "Lockfile"),
  preset("yarn.lock", "Lockfile"),
  preset("poetry.lock", "Lockfile"),
  preset("uv.lock", "Lockfile"),
  preset("Cargo.lock", "Lockfile"),
  preset("**/generated/**", "Generated code"),
  preset("*.generated.*", "Generated code"),
  preset("**/__snapshots__/**", "Test snapshots"),
  preset("*.snap", "Test snapshots"),
  preset("*.min.js", "Minified bundle"),
  preset("*.min.css", "Minified stylesheet"),
  preset("*.map", "Source maps"),
  preset("*.log", "Logs"),
  preset(".cache/", "Caches"),
  preset("tmp/", "Temporary files"),
];

export type PresetName = "aggressive" | "balanced" | "none";

export function presetRules(name: PresetName): PolicyRule[] {
  switch (name) {
    case "aggressive":
      return [...AGGRESSIVE_PRESET];
    case "balanced":
      return AGGRESSIVE_PRESET.filter(
        (candidate) => !["Test snapshots", "Temporary files"].includes(candidate.reason ?? ""),
      );
    case "none":
      return [];
  }
}
