import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/^@onyx\//],
  banner: {
    js: "import { createRequire as __onyxCreateRequire } from 'node:module'; const require = __onyxCreateRequire(import.meta.url);",
  },
});
