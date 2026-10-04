#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: process.env.ONYX_URL ?? "http://127.0.0.1:3000" },
    user: { type: "string", default: process.env.ONYX_USER ?? "" },
    password: { type: "string", default: process.env.ONYX_PASSWORD ?? "" },
    cookie: { type: "string", default: process.env.ONYX_COOKIE ?? "" },
    "min-score": { type: "string", default: "90" },
    lighthouse: { type: "boolean", default: true },
    "no-lighthouse": { type: "boolean", default: false },
    json: { type: "string", default: "" },
  },
});

const BASE = values.base.replace(/\/+$/, "");
const MIN_SCORE = Number(values["min-score"]);
const CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "onyx-ui-audit");
const PACKAGES = ["playwright-core@1.56.1", "axe-core@4.13.0", "lighthouse@12.8.2"];

function say(line) {
  process.stdout.write(`${line}\n`);
}

function load(name) {
  const require = createRequire(join(CACHE, "package.json"));
  return require(name);
}

function ensurePackages() {
  const ready = ["playwright-core", "axe-core", "lighthouse"].every((name) =>
    existsSync(join(CACHE, "node_modules", name)),
  );
  if (ready) return;
  mkdirSync(CACHE, { recursive: true });
  say(`Installing ${PACKAGES.join(", ")} into ${CACHE} (once)…`);
  execFileSync(
    "npm",
    ["install", "--no-save", "--no-audit", "--no-fund", "--prefix", CACHE, ...PACKAGES],
    {
      stdio: "inherit",
    },
  );
}

async function sessionCookie() {
  if (values.cookie)
    return values.cookie.includes("=") ? values.cookie : `onyx_sid=${values.cookie}`;
  if (!values.user || !values.password)
    throw new Error("Pass --user and --password (or ONYX_USER/ONYX_PASSWORD), or --cookie");
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ username: values.user, password: values.password }),
  });
  if (!response.ok) throw new Error(`Sign-in failed: HTTP ${response.status}`);
  const cookie = response.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0];
}

async function discover(cookie) {
  const get = async (path) => {
    const response = await fetch(`${BASE}${path}`, { headers: { cookie } });
    return response.ok ? response.json() : null;
  };
  const pages = [
    "/",
    "/projects",
    "/agents",
    "/approvals",
    "/logs",
    "/router",
    "/savings",
    "/settings",
    "/telemetry",
  ];
  const projects = (await get("/api/projects"))?.items ?? [];
  const project = projects.find((entry) => entry.taskCount > 0) ?? projects[0];
  if (project) {
    const base = `/projects/${project.id}`;
    pages.push(
      base,
      `${base}/graph`,
      `${base}/surgeon`,
      `${base}/memory`,
      `${base}/roadmap`,
      `${base}/github`,
      `${base}/insights`,
    );
    const detail = await get(`/api/projects/${project.id}`);
    const workspace = detail?.workspaces?.[0];
    if (workspace) pages.push(`${base}/workspaces/${workspace.id}`);
    const plans = (await get(`/api/projects/${project.id}/orchestrations`))?.items ?? [];
    if (plans[0]) pages.push(`${base}/plans/${plans[0].id}`);
    const tasks = (await get(`/api/tasks?projectId=${project.id}&limit=20`))?.items ?? [];
    const task = tasks.find((entry) => entry.lastRun) ?? tasks[0];
    if (task) pages.push(`/tasks/${task.id}`);
    if (task?.lastRun) pages.push(`/runs/${task.lastRun.id}`);
  }
  return pages;
}

async function main() {
  ensurePackages();
  const { chromium } = load("playwright-core");
  const axeSource = readFileSync(join(CACHE, "node_modules", "axe-core", "axe.min.js"), "utf8");
  const executablePath = process.env.CHROME_PATH ?? chromium.executablePath();
  const cookie = await sessionCookie();
  const pages = await discover(cookie);
  const [name, value] = cookie.split("=");
  const url = new URL(BASE);
  const results = [];
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 375, height: 812 } : { width: 1366, height: 900 },
      ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    });
    await context.addCookies([{ name, value, domain: url.hostname, path: "/" }]);
    const page = await context.newPage();
    for (const path of pages) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => undefined);
      await page.waitForTimeout(500);
      await page.addScriptTag({ content: axeSource });
      const violations = await page.evaluate(async () =>
        (
          await globalThis.axe.run(globalThis.document, {
            runOnly: ["wcag2a", "wcag2aa", "wcag21aa"],
          })
        ).violations.map(
          (entry) => `${entry.id} (${entry.nodes.length}): ${entry.nodes[0]?.target}`,
        ),
      );
      const overflow = await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
      );
      results.push({
        path,
        device: mobile ? "mobile" : "desktop",
        violations,
        overflow,
        scores: null,
      });
    }
    await context.close();
  }
  await browser.close();
  if (values.lighthouse && !values["no-lighthouse"]) {
    const lighthouse = (await import(join(CACHE, "node_modules", "lighthouse", "core", "index.js")))
      .default;
    const desktopConfig = (
      await import(join(CACHE, "node_modules", "lighthouse", "core", "config", "desktop-config.js"))
    ).default;
    const { launch } = load("chrome-launcher");
    const chrome = await launch({
      chromePath: executablePath,
      chromeFlags: ["--headless=new", "--no-sandbox"],
    });
    try {
      for (const result of results) {
        const run = await lighthouse(
          `${BASE}${result.path}`,
          {
            port: chrome.port,
            output: "json",
            logLevel: "error",
            onlyCategories: ["performance", "accessibility", "best-practices"],
            extraHeaders: { Cookie: cookie },
          },
          result.device === "desktop" ? desktopConfig : undefined,
        );
        const categories = run?.lhr.categories ?? {};
        result.scores = Object.fromEntries(
          Object.entries(categories).map(([key, category]) => [
            key,
            Math.round((category.score ?? 0) * 100),
          ]),
        );
      }
    } finally {
      await chrome.kill();
    }
  }
  let failed = 0;
  for (const result of results) {
    const scores = result.scores
      ? Object.entries(result.scores)
          .map(([key, score]) => `${key.replace("best-practices", "bp")} ${score}`)
          .join(" ")
      : "";
    const low = result.scores
      ? Object.values(result.scores).some((score) => score < MIN_SCORE)
      : false;
    const bad = result.violations.length > 0 || result.overflow > 0 || low;
    if (bad) failed += 1;
    say(
      `${bad ? "FAIL" : "ok  "} ${result.device.padEnd(7)} ${result.path.padEnd(60)} ${scores}${result.overflow > 0 ? ` overflow ${result.overflow}px` : ""}${result.violations.length > 0 ? `\n       axe: ${result.violations.join("\n            ")}` : ""}`,
    );
  }
  if (values.json) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(values.json, JSON.stringify(results, null, 2));
  }
  say(
    `${results.length - failed} of ${results.length} checks passed (minimum score ${MIN_SCORE}).`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
