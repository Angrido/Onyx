"use client";

import type { ApprovalListResponse, ProjectListResponse, TaskListResponse } from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import {
  Activity,
  DatabaseBackup,
  FolderGit2,
  Inbox,
  LayoutDashboard,
  ListTodo,
  LogOut,
  PiggyBank,
  Map as MapIcon,
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
import { isPaletteShortcut, OPEN_PALETTE_EVENT } from "@/lib/palette";

const PAGES = [
  { href: "/", label: "Console", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderGit2 },
  { href: "/approvals", label: "Approvals", icon: Inbox },
  { href: "/router", label: "Router", icon: Route },
  { href: "/telemetry", label: "Telemetry", icon: Activity },
  { href: "/savings", label: "Savings", icon: PiggyBank },
  { href: "/settings", label: "Settings", icon: Settings },
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

const GROUP =
  "px-1 py-1.5 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground";

export function CommandPalette({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);

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

  const run = useCallback(async (label: string, action: () => Promise<string>) => {
    setOpen(false);
    try {
      toast.success(await action());
    } catch (error) {
      toast.error(`${label}: ${errorMessage(error)}`);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="top-[18%] w-[min(94vw,36rem)] translate-y-0 gap-0 overflow-hidden p-0"
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search pages, projects and tasks, or run an action
        </DialogDescription>
        <Command label="Command palette" loop>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 text-muted-foreground" />
            <Command.Input
              autoFocus
              placeholder="Go to a page, project or task…"
              className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <Command.List className="max-h-[min(60vh,26rem)] overflow-y-auto p-1">
            <Command.Empty className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing matches.
            </Command.Empty>
            <Command.Group heading="Pages" className={GROUP}>
              {PAGES.map((page) => (
                <Item
                  key={page.href}
                  value={`page ${page.label}`}
                  onSelect={() => go(page.href)}
                  icon={<page.icon />}
                  {...(page.href === "/approvals" && approvals.data
                    ? { hint: `${approvals.data} waiting` }
                    : {})}
                >
                  {page.label}
                </Item>
              ))}
            </Command.Group>
            {projects.data && projects.data.items.length > 0 ? (
              <Command.Group heading="Projects" className={GROUP}>
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
                    Roadmap · {project.name}
                  </Item>
                ))}
              </Command.Group>
            ) : null}
            {tasks.data && tasks.data.items.length > 0 ? (
              <Command.Group heading="Recent tasks" className={GROUP}>
                {tasks.data.items.map((task) => (
                  <Item
                    key={task.id}
                    value={`task ${task.title} ${task.id}`}
                    onSelect={() => go(`/tasks/${task.id}`)}
                    icon={<ListTodo />}
                    hint={task.status.toLowerCase().replaceAll("_", " ")}
                  >
                    {task.title}
                  </Item>
                ))}
              </Command.Group>
            ) : null}
            <Command.Group heading="Actions" className={GROUP}>
              <Item
                value="action back up the database now"
                onSelect={() =>
                  void run("Backup", async () => {
                    const backup = await api.post<{ name: string }>("/api/backups");
                    return `Backup written: ${backup.name}`;
                  })
                }
                icon={<DatabaseBackup />}
              >
                Back up the database now
              </Item>
              <Item
                value="action check claude code compatibility"
                onSelect={() =>
                  void run("Check", async () => {
                    const account = await api.post<{
                      cliVersion: string | null;
                      compatibility: { ok: boolean } | null;
                    }>("/api/settings/claude/check");
                    return account.compatibility?.ok
                      ? `Claude Code ${account.cliVersion ?? ""} is compatible`
                      : "Claude Code is not compatible: see Settings";
                  })
                }
                icon={<Stethoscope />}
              >
                Check Claude Code compatibility
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
                Sign out
              </Item>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
