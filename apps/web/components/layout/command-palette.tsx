"use client";

import type {
  ApprovalListResponse,
  ProjectListResponse,
  SearchResponse,
  TaskListResponse,
} from "@onyx/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Command, defaultFilter } from "cmdk";
import {
  Activity,
  DatabaseBackup,
  FileCode2,
  FolderGit2,
  Inbox,
  Languages,
  LayoutDashboard,
  LayoutGrid,
  ListTodo,
  LogOut,
  PiggyBank,
  Map as MapIcon,
  Play,
  Plus,
  Route,
  Search,
  Settings,
  Stethoscope,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { storeLocale, useLocale, useT } from "@/lib/i18n/client";
import { msg } from "@/lib/i18n/core";
import {
  CREATE_LINKS,
  isPaletteShortcut,
  OPEN_PALETTE_EVENT,
  PROJECT_PAGES,
  SETTINGS_LINKS,
} from "@/lib/palette";
import { SEARCH_PREFIX, searchHint, searchMinLength, snippetParts } from "@/lib/search";

const PAGES = [
  { href: "/", label: msg("Mission control"), icon: LayoutDashboard },
  { href: "/projects", label: msg("Projects"), icon: FolderGit2 },
  { href: "/agents", label: msg("Agent grid"), icon: LayoutGrid },
  { href: "/approvals", label: msg("Approvals"), icon: Inbox },
  { href: "/router", label: msg("Router"), icon: Route },
  { href: "/telemetry", label: msg("Telemetry"), icon: Activity },
  { href: "/savings", label: msg("Savings"), icon: PiggyBank },
  { href: "/settings", label: msg("Settings"), icon: Settings },
] as const;

function Item({
  value,
  onSelect,
  icon,
  children,
  hint,
}: {
  value: string;
  onSelect: () => void;
  icon: ReactNode;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground outline-none data-[selected=true]:bg-surface-3 data-[selected=true]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-[11px] text-muted-foreground">{hint}</span> : null}
    </Command.Item>
  );
}

function Snippet({ text }: { text: string }) {
  return (
    <span className="block truncate text-[11px] text-muted-foreground">
      {snippetParts(text).map((part, index) =>
        part.mark ? (
          <mark key={index} className="rounded-sm bg-primary/20 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}

function paletteFilter(value: string, search: string, keywords?: string[]): number {
  if (value.startsWith(SEARCH_PREFIX)) return 1;
  return defaultFilter(value, search, keywords);
}

function statusText(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replaceAll("_", " ");
}

const SEARCH_ICONS = { TASK: ListTodo, RUN: Play, FILE: FileCode2 } as const;

const GROUP =
  "px-1 py-1.5 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground";

export function CommandPalette({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setTerm(input.trim()), 150);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isPaletteShortcut(event)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  const projects = useQuery({
    queryKey: queryKeys.paletteProjects,
    queryFn: () => api.get<ProjectListResponse>("/api/projects"),
    enabled: open,
  });
  const tasks = useQuery({
    queryKey: queryKeys.paletteTasks,
    queryFn: () => api.get<TaskListResponse>("/api/tasks?limit=12"),
    enabled: open,
  });
  const found = useQuery({
    queryKey: ["search", term],
    queryFn: () => api.get<SearchResponse>(`/api/search?limit=12&q=${encodeURIComponent(term)}`),
    enabled: open && term.length >= searchMinLength,
    placeholderData: keepPreviousData,
  });
  const results = term.length >= searchMinLength ? (found.data?.items ?? []) : [];
  const approvals = useQuery({
    queryKey: queryKeys.approvalsPending,
    queryFn: () =>
      api
        .get<ApprovalListResponse>("/api/approvals?status=PENDING&limit=1")
        .then((page) => page.pending),
    enabled: open,
  });

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const run = useCallback(
    async (label: string, action: () => Promise<string>) => {
      setOpen(false);
      try {
        toast.success(await action());
      } catch (error) {
        toast.error(t("{action}: {error}", { action: label, error: errorMessage(error, t) }));
      }
    },
    [t],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="top-[18%] w-[min(94vw,36rem)] translate-y-0 gap-0 overflow-hidden p-0"
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">{t("Command palette")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("Search pages, projects and tasks, or run an action")}
        </DialogDescription>
        <Command label={t("Command palette")} loop filter={paletteFilter}>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 text-muted-foreground" />
            <Command.Input
              autoFocus
              value={input}
              onValueChange={setInput}
              placeholder={t("Search tasks, runs and files, or go to a page…")}
              className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <Command.List className="max-h-[min(60vh,26rem)] overflow-y-auto p-1">
            <Command.Empty className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t("Nothing matches.")}
            </Command.Empty>
            {results.length > 0 ? (
              <Command.Group heading={t("Search")} className={GROUP} data-testid="palette-search">
                {results.map((result) => {
                  const Icon = SEARCH_ICONS[result.kind];
                  return (
                    <Item
                      key={`${result.kind}-${result.id}`}
                      value={`${SEARCH_PREFIX}${result.kind} ${result.id}`}
                      onSelect={() => go(result.href)}
                      icon={<Icon />}
                      hint={searchHint(result, t)}
                    >
                      <span className="block truncate">{result.title}</span>
                      {result.snippet ? <Snippet text={result.snippet} /> : null}
                    </Item>
                  );
                })}
              </Command.Group>
            ) : null}
            <Command.Group heading={t("Pages")} className={GROUP}>
              {PAGES.map((page) => (
                <Item
                  key={page.href}
                  value={`page ${page.label} ${t(page.label)}`}
                  onSelect={() => go(page.href)}
                  icon={<page.icon />}
                  {...(page.href === "/approvals" && approvals.data
                    ? { hint: t("{count} waiting", { count: approvals.data }) }
                    : {})}
                >
                  {t(page.label)}
                </Item>
              ))}
            </Command.Group>
            <Command.Group heading={t("Create")} className={GROUP}>
              {CREATE_LINKS.map((link) => (
                <Item
                  key={link.id}
                  value={`create ${link.label} ${t(link.label)}`}
                  onSelect={() => go(link.href)}
                  icon={<Plus />}
                >
                  {t(link.label)}
                </Item>
              ))}
            </Command.Group>
            <Command.Group heading={t("Settings")} className={GROUP}>
              {SETTINGS_LINKS.map((link) => (
                <Item
                  key={link.id}
                  value={`settings ${link.label} ${t(link.label)}`}
                  onSelect={() => go(link.href)}
                  icon={<Settings />}
                >
                  {t(link.label)}
                </Item>
              ))}
              <Item
                value="settings language switch english italiano lingua"
                onSelect={() => {
                  setOpen(false);
                  storeLocale(locale === "it" ? "en" : "it");
                  router.refresh();
                }}
                icon={<Languages />}
              >
                {locale === "it" ? t("Switch to English") : t("Switch to Italian")}
              </Item>
            </Command.Group>
            {projects.data && projects.data.items.length > 0 ? (
              <Command.Group heading={t("Projects")} className={GROUP}>
                {projects.data.items.map((project) => (
                  <Item
                    key={project.id}
                    value={`project ${project.name} ${project.id}`}
                    onSelect={() => go(`/projects/${project.id}`)}
                    icon={<FolderGit2 />}
                  >
                    {project.name}
                  </Item>
                ))}
                {projects.data.items.map((project) => (
                  <Item
                    key={`${project.id}-roadmap`}
                    value={`roadmap ${project.name} ${project.id}`}
                    onSelect={() => go(`/projects/${project.id}/roadmap`)}
                    icon={<MapIcon />}
                  >
                    {t("Roadmap")} · {project.name}
                  </Item>
                ))}
                {projects.data.items.flatMap((project) =>
                  PROJECT_PAGES.map((page) => (
                    <Item
                      key={`${project.id}${page.suffix}`}
                      value={`${page.suffix.slice(1)} ${t(page.label)} ${project.name} ${project.id}`}
                      onSelect={() => go(`/projects/${project.id}${page.suffix}`)}
                      icon={<FolderGit2 />}
                    >
                      {t(page.label)} · {project.name}
                    </Item>
                  )),
                )}
              </Command.Group>
            ) : null}
            {tasks.data && tasks.data.items.length > 0 ? (
              <Command.Group heading={t("Recent tasks")} className={GROUP}>
                {tasks.data.items.map((task) => (
                  <Item
                    key={task.id}
                    value={`task ${task.title} ${task.id}`}
                    onSelect={() => go(`/tasks/${task.id}`)}
                    icon={<ListTodo />}
                    hint={t(statusText(task.status))}
                  >
                    {task.title}
                  </Item>
                ))}
              </Command.Group>
            ) : null}
            <Command.Group heading={t("Actions")} className={GROUP}>
              <Item
                value="action back up the database now"
                onSelect={() =>
                  void run(t("Backup"), async () => {
                    const backup = await api.post<{ name: string }>("/api/backups");
                    return t("Backup written: {name}", { name: backup.name });
                  })
                }
                icon={<DatabaseBackup />}
              >
                {t("Back up the database now")}
              </Item>
              <Item
                value="action check claude code compatibility"
                onSelect={() =>
                  void run(t("Check"), async () => {
                    const account = await api.post<{
                      cliVersion: string | null;
                      compatibility: { ok: boolean } | null;
                    }>("/api/settings/claude/check");
                    return account.compatibility?.ok
                      ? t("Claude Code {version} is compatible", {
                          version: account.cliVersion ?? "",
                        })
                      : t("Claude Code is not compatible: see Settings");
                  })
                }
                icon={<Stethoscope />}
              >
                {t("Check Claude Code compatibility")}
              </Item>
              <Item
                value="action sign out"
                onSelect={() =>
                  void (async () => {
                    setOpen(false);
                    await api.post("/api/auth/logout");
                    router.replace("/login");
                    router.refresh();
                  })()
                }
                icon={<LogOut />}
              >
                {t("Sign out")}
              </Item>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
