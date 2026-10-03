import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const noComments = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      found: "Comments are not allowed: express intent through naming and structure.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") continue;
          context.report({ loc: comment.loc, messageId: "found" });
        }
      },
    };
  },
};

const onyxPlugin = { rules: { "no-comments": noComments } };

export function createConfig({ webAppDir = "apps/web" } = {}) {
  return tseslint.config(
    {
      ignores: [
        "**/node_modules/**",
        "**/dist/**",
        "**/.next/**",
        "**/.turbo/**",
        "**/coverage/**",
        "**/generated/**",
        "**/next-env.d.ts",
        "**/playwright-report/**",
        "**/test-results/**",
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: "module",
        globals: { ...globals.node },
      },
      plugins: { onyx: onyxPlugin },
      linterOptions: { reportUnusedDisableDirectives: "error" },
      rules: {
        "onyx/no-comments": "error",
        "no-console": ["error", { allow: ["error"] }],
        eqeqeq: ["error", "always"],
        "prefer-const": "error",
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/consistent-type-imports": "error",
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
      },
    },
    {
      files: [`${webAppDir}/**/*.{ts,tsx}`],
      languageOptions: {
        globals: { ...globals.browser },
      },
      plugins: {
        "react-hooks": reactHooks,
        "@next/next": nextPlugin,
      },
      settings: { next: { rootDir: webAppDir } },
      rules: {
        ...reactHooks.configs.recommended.rules,
        ...nextPlugin.configs.recommended.rules,
        ...nextPlugin.configs["core-web-vitals"].rules,
      },
    },
    {
      files: ["**/*.test.ts", "**/tests/**/*.ts", "**/bin/**/*.ts"],
      rules: {
        "no-console": "off",
      },
    },
  );
}
