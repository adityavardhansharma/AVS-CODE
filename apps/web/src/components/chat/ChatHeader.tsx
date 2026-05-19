import {
  type EnvironmentId,
  type EditorId,
  type ScopedThreadRef,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import {
  parseScopedThreadKey,
  scopeProjectRef,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime";
import { useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import GitActionsControl from "../GitActionsControl";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import {
  DiffIcon,
  FolderIcon,
  ListTreeIcon,
  PlusIcon,
  SearchIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../../store";
import { selectThreadTerminalState, useTerminalStateStore } from "../../terminalStateStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { cn } from "../../lib/utils";
import type { Project, SidebarThreadSummary } from "../../types";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { ThreadStatusLabel } from "../ThreadStatusIndicators";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  );
}

type ThreadSwitcherTab = "working" | "terminals" | "all";

interface ProjectThreadGroup {
  project: Project;
  threads: SidebarThreadSummary[];
}

interface ActiveTerminalThreadEntry {
  threadRef: ScopedThreadRef;
  title: string;
  project: Project;
  terminalCount: number;
}

function threadIsWorking(thread: SidebarThreadSummary): boolean {
  const status = resolveThreadStatusPill({ thread });
  return status?.label === "Working" || status?.label === "Connecting";
}

function terminalStateIsActive(
  terminalState: ReturnType<typeof selectThreadTerminalState>,
): boolean {
  return terminalState.terminalOpen || terminalState.runningTerminalIds.length > 0;
}

function activeTerminalCount(terminalState: ReturnType<typeof selectThreadTerminalState>): number {
  return terminalState.runningTerminalIds.length > 0
    ? terminalState.runningTerminalIds.length
    : terminalState.terminalIds.length;
}

function searchableText(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function sortThreads(left: SidebarThreadSummary, right: SidebarThreadSummary): number {
  const leftTime = left.updatedAt ?? left.latestUserMessageAt ?? left.createdAt;
  const rightTime = right.updatedAt ?? right.latestUserMessageAt ?? right.createdAt;
  return rightTime.localeCompare(leftTime) || left.title.localeCompare(right.title);
}

function groupThreadsByProject(
  projects: readonly Project[],
  threads: readonly SidebarThreadSummary[],
  options?: { includeEmptyProjects?: boolean },
): ProjectThreadGroup[] {
  const projectByScopedKey = new Map<string, Project>(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
  );
  const groups = new Map<string, ProjectThreadGroup>();

  if (options?.includeEmptyProjects) {
    for (const project of projects) {
      groups.set(`${project.environmentId}:${project.id}`, { project, threads: [] });
    }
  }

  for (const thread of threads) {
    const key = `${thread.environmentId}:${thread.projectId}`;
    const project = projectByScopedKey.get(key);
    if (!project) continue;
    const group = groups.get(key);
    if (group) {
      group.threads.push(thread);
    } else {
      groups.set(key, { project, threads: [thread] });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      project: group.project,
      threads: group.threads.toSorted(sortThreads),
    }))
    .toSorted((left, right) => left.project.name.localeCompare(right.project.name));
}

function ThreadSwitcherDialog({
  activeThreadEnvironmentId,
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
}: Pick<
  ChatHeaderProps,
  "activeThreadEnvironmentId" | "activeThreadId" | "activeThreadTitle" | "activeProjectName"
>) {
  const navigate = useNavigate();
  const { handleNewThread } = useNewThreadHandler();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const terminalStateByThreadKey = useTerminalStateStore((state) => state.terminalStateByThreadKey);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ThreadSwitcherTab>("working");
  const [query, setQuery] = useState("");
  const activeThreadRef = useMemo<ScopedThreadRef>(
    () => scopeThreadRef(activeThreadEnvironmentId, activeThreadId),
    [activeThreadEnvironmentId, activeThreadId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key.toLowerCase() !== "h") return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      setOpen((current) => !current);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeTerminalThreads = useMemo(() => {
    const projectByScopedKey = new Map<string, Project>(
      projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
    );
    const sidebarThreadByKey = new Map(
      threads.map((thread) => [
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        thread,
      ]),
    );

    return Object.entries(terminalStateByThreadKey).flatMap(
      ([threadKey, terminalState]): ActiveTerminalThreadEntry[] => {
        if (!terminalStateIsActive(terminalState)) return [];
        const threadRef = parseScopedThreadKey(threadKey);
        if (!threadRef) return [];

        const sidebarThread = sidebarThreadByKey.get(threadKey);
        const draftThread = draftThreadsByThreadKey[threadKey];
        const projectKey = sidebarThread
          ? `${sidebarThread.environmentId}:${sidebarThread.projectId}`
          : draftThread
            ? `${draftThread.environmentId}:${draftThread.projectId}`
            : null;
        const project = projectKey ? projectByScopedKey.get(projectKey) : undefined;
        if (!project) return [];

        return [
          {
            threadRef,
            title: sidebarThread?.title ?? "Draft thread",
            project,
            terminalCount: activeTerminalCount(terminalState),
          },
        ];
      },
    );
  }, [draftThreadsByThreadKey, projects, terminalStateByThreadKey, threads]);

  const terminalThreadKeySet = useMemo(
    () => new Set(activeTerminalThreads.map((entry) => scopedThreadKey(entry.threadRef))),
    [activeTerminalThreads],
  );

  const activeTerminalThreadCount = activeTerminalThreads.length;
  const activeTerminalPaneCount = useMemo(
    () => activeTerminalThreads.reduce((count, entry) => count + entry.terminalCount, 0),
    [activeTerminalThreads],
  );

  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const projectByScopedKey = new Map<string, Project>(
      projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
    );
    const projectMatches = (project: Project) =>
      !normalizedQuery || searchableText([project.name, project.cwd]).includes(normalizedQuery);
    const visibleThreads = threads.filter((thread) => {
      if (tab === "working" && !threadIsWorking(thread)) return false;
      if (tab === "terminals") {
        const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
        if (!terminalThreadKeySet.has(threadKey)) return false;
      }
      const project = projectByScopedKey.get(`${thread.environmentId}:${thread.projectId}`);
      if (!project) return false;
      if (!normalizedQuery) return true;
      return searchableText([thread.title, thread.branch, project.name, project.cwd]).includes(
        normalizedQuery,
      );
    });
    const visibleProjects =
      tab === "all"
        ? projects.filter((project) => {
            if (projectMatches(project)) return true;
            return visibleThreads.some(
              (thread) =>
                thread.environmentId === project.environmentId && thread.projectId === project.id,
            );
          })
        : projects;

    return groupThreadsByProject(visibleProjects, visibleThreads, {
      includeEmptyProjects: tab === "all",
    });
  }, [projects, query, tab, terminalThreadKeySet, threads]);

  const workingThreads = useMemo(
    () =>
      threads
        .filter(threadIsWorking)
        .toSorted(sortThreads)
        .map((thread) => {
          const project = projects.find(
            (candidate) =>
              candidate.environmentId === thread.environmentId && candidate.id === thread.projectId,
          );
          return project ? { thread, project } : null;
        })
        .filter((entry): entry is { thread: SidebarThreadSummary; project: Project } =>
          Boolean(entry),
        ),
    [projects, threads],
  );

  const navigateToThread = useCallback(
    (thread: SidebarThreadSummary) => {
      setOpen(false);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
      });
    },
    [navigate],
  );

  const navigateToThreadRef = useCallback(
    (threadRef: ScopedThreadRef) => {
      setOpen(false);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [navigate],
  );

  const createThreadForProject = useCallback(
    async (project: Project) => {
      setOpen(false);
      await handleNewThread(scopeProjectRef(project.environmentId, project.id));
    },
    [handleNewThread],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
          />
        }
      >
        <span
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </span>
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {activeTerminalThreadCount > 0 && (
          <Badge
            variant="outline"
            className="hidden shrink-0 gap-1 border-teal-500/25 text-teal-700 sm:inline-flex dark:text-teal-300"
          >
            <TerminalSquareIcon className="size-3" />
            {activeTerminalThreadCount}
          </Badge>
        )}
      </DialogTrigger>
      <DialogPopup className="h-[min(78vh,42rem)] w-[min(92vw,42rem)] max-w-none rounded-xl">
        <DialogHeader className="pb-3">
          <DialogTitle>Threads</DialogTitle>
          <DialogDescription>
            Switch threads, create project threads, or jump to active terminals.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-1 flex-col gap-4 pt-1">
          <div className="flex items-center gap-2 rounded-xl border bg-background px-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <Input
              type="search"
              nativeInput
              unstyled
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search threads and projects..."
              autoFocus
            />
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/45 p-1">
            {(["working", "terminals", "all"] as const).map((nextTab) => (
              <Button
                key={nextTab}
                type="button"
                variant={tab === nextTab ? "secondary" : "ghost"}
                size="sm"
                className="gap-1.5"
                onClick={() => setTab(nextTab)}
              >
                {nextTab === "working" ? (
                  <>
                    <span className="size-1.5 rounded-full bg-sky-500" />
                    Working
                    {workingThreads.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {workingThreads.length}
                      </span>
                    )}
                  </>
                ) : nextTab === "terminals" ? (
                  <>
                    <TerminalSquareIcon className="size-3.5" />
                    Terminals
                    {activeTerminalThreadCount > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {activeTerminalPaneCount}
                      </span>
                    )}
                  </>
                ) : (
                  "All"
                )}
              </Button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "working" ? (
              workingThreads.length === 0 ? (
                <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No threads are working
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border bg-background">
                  {workingThreads.map(({ thread, project }) => {
                    const status = resolveThreadStatusPill({ thread });
                    return (
                      <button
                        key={`${thread.environmentId}:${thread.id}`}
                        type="button"
                        className="group flex w-full min-w-0 items-center gap-2 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-accent"
                        onClick={() => navigateToThread(thread)}
                      >
                        <ListTreeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{thread.title}</span>
                          <span className="block truncate text-xs text-muted-foreground/80">
                            {project.name}
                          </span>
                        </span>
                        {status ? <ThreadStatusLabel status={status} compact /> : null}
                      </button>
                    );
                  })}
                </div>
              )
            ) : tab === "terminals" ? (
              activeTerminalThreads.length === 0 ? (
                <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No active terminals
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border bg-background">
                  {activeTerminalThreads.map(({ threadRef, title, project, terminalCount }) => (
                    <button
                      key={scopedThreadKey(threadRef)}
                      type="button"
                      className="group flex w-full min-w-0 items-center gap-2 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-accent"
                      onClick={() => navigateToThreadRef(threadRef)}
                    >
                      <TerminalSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{title}</span>
                        <span className="block truncate text-xs text-muted-foreground/80">
                          {project.name}
                        </span>
                      </span>
                      <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
                        {terminalCount}
                      </Badge>
                    </button>
                  ))}
                </div>
              )
            ) : filteredGroups.length === 0 ? (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                No matching threads
              </div>
            ) : (
              <div className="space-y-3">
                {filteredGroups.map((group) => (
                  <section
                    key={`${group.project.environmentId}:${group.project.id}`}
                    className="rounded-lg border bg-card"
                  >
                    <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{group.project.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {group.project.cwd}
                          </div>
                        </div>
                      </div>
                      {tab === "all" && (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => void createThreadForProject(group.project)}
                                aria-label={`New thread in ${group.project.name}`}
                              />
                            }
                          >
                            <PlusIcon className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipPopup side="left">New thread in this project</TooltipPopup>
                        </Tooltip>
                      )}
                    </div>
                    <div className="p-1.5">
                      {group.threads.length === 0 ? (
                        <div className="px-2 py-3 text-sm text-muted-foreground">
                          No threads in this project yet
                        </div>
                      ) : (
                        group.threads.map((thread) => {
                          const isActive =
                            scopedThreadKey(activeThreadRef) ===
                            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
                          const status = resolveThreadStatusPill({ thread });
                          return (
                            <button
                              key={`${thread.environmentId}:${thread.id}`}
                              type="button"
                              className={cn(
                                "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent",
                                isActive && "bg-accent text-accent-foreground",
                              )}
                              onClick={() => navigateToThread(thread)}
                            >
                              <ListTreeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">{thread.title}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {thread.branch ?? "default branch"}
                                </span>
                              </span>
                              {status ? <ThreadStatusLabel status={status} /> : null}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
}: ChatHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
  });

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <ThreadSwitcherDialog
          activeThreadEnvironmentId={activeThreadEnvironmentId}
          activeThreadId={activeThreadId}
          activeThreadTitle={activeThreadTitle}
          activeProjectName={activeProjectName}
        />
        {activeProjectName && !isGitRepo && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {showOpenInPicker && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            {...(draftId ? { draftId } : {})}
          />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                variant="outline"
                size="xs"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!terminalAvailable
              ? "Terminal is unavailable until this thread has an active project."
              : terminalToggleShortcutLabel
                ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                : "Toggle terminal drawer"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo && !diffOpen}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo && !diffOpen
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});
