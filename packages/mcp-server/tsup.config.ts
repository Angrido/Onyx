import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "onyx-mcp": "src/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  splitting: false,
  noExternal: [/.*/],
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __onyxCreateRequire } from 'node:module'; const require = __onyxCreateRequire(import.meta.url);",
  },
});
