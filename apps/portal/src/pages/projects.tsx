import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, CheckCircle2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ui } from "@/lib/ui-text";

import { fetchApi } from "../lib/api-client";
import { getSession } from "../lib/auth";

type MembershipStatus = "INVITED" | "ACCEPTED" | "DECLINED";
type ProjectView = "invitations" | "active" | "history";

interface ProjectMemberSummary {
  memberId: string;
  name: string;
  department: string | null;
  photoUrl: string | null;
}

interface MemberProject {
  id: string;
  status: MembershipStatus;
  invitedAt?: string;
  respondedAt?: string | null;
  project: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    activatedAt?: string | null;
    completedAt?: string | null;
    closedAt?: string | null;
    informationUpdatedAt?: string;
    projectManager?: { name: string } | null;
    members?: ProjectMemberSummary[];
  };
}

const viewLabels: Record<ProjectView, string> = {
  invitations: "Invitations",
  active: "Active",
  history: "History",
};

function projectView(item: MemberProject): ProjectView {
  if (item.status === "INVITED" && item.project.status === "ACTIVE") return "invitations";
  if (item.status === "ACCEPTED" && item.project.status === "ACTIVE") return "active";
  return "history";
}

function projectStatusLabel(item: MemberProject): string {
  if (item.status === "DECLINED") return ui("Declined");
  if (item.status === "INVITED") {
    return item.project.status === "ACTIVE" ? ui("Invitation pending") : ui("Invitation closed");
  }
  if (item.project.status === "ACTIVE") return ui("Active");
  if (item.project.status === "CLOSED") return ui("Closed");
  return ui("Completed");
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ProjectDetail({
  membership,
  pending,
  onRespond,
  onBack,
  currentMemberId,
}: {
  membership: MemberProject;
  pending: boolean;
  onRespond: (response: "ACCEPTED" | "DECLINED") => void;
  onBack: () => void;
  currentMemberId?: string;
}) {
  const { project } = membership;
  const invitedAt = formatDate(membership.invitedAt);
  const respondedAt = formatDate(membership.respondedAt);
  const startedAt = formatDate(project.activatedAt);
  const completedAt = formatDate(project.completedAt);
  const closedAt = formatDate(project.closedAt);

  return (
    <section
      aria-labelledby="project-detail-title"
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm sm:p-6"
    >
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-surface-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] lg:hidden"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {ui("Back to projects")}
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">
            {projectStatusLabel(membership)}
          </p>
          <h2 id="project-detail-title" className="mt-1 text-xl font-bold sm:text-2xl">
            {project.name}
          </h2>
        </div>
        {(invitedAt ?? respondedAt ?? startedAt ?? completedAt ?? closedAt) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
            {invitedAt && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {ui("Invited on")} {invitedAt}
              </span>
            )}
            {respondedAt && membership.status === "ACCEPTED" && (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {ui("Joined on")} {respondedAt}
              </span>
            )}
            {startedAt && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {ui("Started")} {startedAt}
              </span>
            )}
            {completedAt && (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {ui("Completed on")} {completedAt}
              </span>
            )}
            {closedAt && (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {ui("Closed on")} {closedAt}
              </span>
            )}
          </div>
        )}
      </div>

      {project.description && (
        <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[var(--color-text-secondary)]">
          {project.description}
        </p>
      )}
      {project.projectManager?.name && (
        <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
          {ui("Project manager")}: {project.projectManager.name}
        </p>
      )}

      {membership.status === "INVITED" && project.status === "ACTIVE" && (
        <div className="mt-5 rounded-xl bg-[var(--color-surface-secondary)] p-4">
          <p className="text-sm">{ui("You have been invited to join this project.")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={pending}
              onClick={() => {
                onRespond("ACCEPTED");
              }}
            >
              {ui("Accept invitation")}
            </button>
            <button
              type="button"
              className="min-h-11 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              disabled={pending}
              onClick={() => {
                onRespond("DECLINED");
              }}
            >
              {ui("Decline")}
            </button>
          </div>
        </div>
      )}
      {membership.status === "INVITED" && project.status !== "ACTIVE" && (
        <p className="mt-4 rounded-xl bg-[var(--color-surface-secondary)] p-4 text-sm text-[var(--color-text-secondary)]">
          {ui("This project has ended, so the invitation can no longer be accepted.")}
        </p>
      )}
      {membership.status === "DECLINED" && (
        <p className="mt-4 rounded-xl bg-[var(--color-surface-secondary)] p-4 text-sm text-[var(--color-text-secondary)]">
          {ui("You declined this project invitation.")}
        </p>
      )}

      {membership.status === "ACCEPTED" && Array.isArray(project.members) && (
        <section
          className="mt-6 border-t border-[var(--color-border)] pt-5"
          aria-labelledby="project-team-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="project-team-title" className="text-base font-semibold">
              {ui("Project team")}
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              {project.members.length} {ui("team members")}
            </p>
          </div>
          {project.members.length === 0 ? (
            <p className="mt-4 rounded-xl bg-[var(--color-surface-secondary)] p-4 text-sm text-[var(--color-text-secondary)]">
              {ui("No active team members are listed yet.")}
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {project.members.map((member) => (
                <li
                  key={member.memberId}
                  className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--color-border)] p-3"
                >
                  {member.photoUrl ? (
                    <img
                      src={member.photoUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-secondary)] text-sm font-semibold text-[var(--color-text-secondary)]"
                    >
                      {member.name.trim().charAt(0).toLocaleUpperCase() || "?"}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{member.name}</span>
                      {member.memberId === currentMemberId && (
                        <span className="rounded-full bg-[var(--color-surface-secondary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">
                          {ui("You")}
                        </span>
                      )}
                    </span>
                    {member.department && (
                      <span className="mt-0.5 block truncate text-xs text-[var(--color-text-secondary)]">
                        {member.department}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}

export default function Projects() {
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedView, setSelectedView] = useState<ProjectView | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<{ message: string; isError: boolean } | null>(null);
  const currentMemberId = getSession()?.memberId;
  const seenStorageKey = `loyaltyos-projects-seen:${currentMemberId ?? "unknown"}`;
  const [lastSeenProjectUpdates, setLastSeenProjectUpdates] = useState<Record<string, string>>({});
  const selectedProjectId = searchParams.get("project");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(seenStorageKey);
      setLastSeenProjectUpdates(stored ? JSON.parse(stored) as Record<string, string> : {});
    } catch {
      setLastSeenProjectUpdates({});
    }
  }, [seenStorageKey]);
  const projects = useQuery({
    queryKey: ["member-projects"],
    queryFn: () => fetchApi<MemberProject[]>("/members/me/projects"),
  });

  const respond = useMutation({
    mutationFn: ({
      projectId,
      response,
    }: {
      projectId: string;
      response: "ACCEPTED" | "DECLINED";
    }) =>
      fetchApi(`/members/me/projects/${projectId}/respond`, {
        method: "POST",
        body: JSON.stringify({ response }),
      }),
    onSuccess: async () => {
      setNotice({ message: ui("Your response has been saved."), isError: false });
      await client.invalidateQueries({ queryKey: ["member-projects"] });
    },
    onError: (error: Error) => {
      setNotice({ message: error.message, isError: true });
    },
  });

  const allProjects = projects.data ?? [];
  const counts = useMemo(
    () => ({
      invitations: allProjects.filter((item) => projectView(item) === "invitations").length,
      active: allProjects.filter((item) => projectView(item) === "active").length,
      history: allProjects.filter((item) => projectView(item) === "history").length,
    }),
    [allProjects],
  );
  const view =
    selectedView ??
    (counts.invitations > 0 ? "invitations" : counts.active > 0 ? "active" : "history");
  const visibleProjects = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return allProjects.filter((item) => {
      if (projectView(item) !== view) return false;
      return (
        !term ||
        `${item.project.name} ${item.project.description ?? ""}`.toLocaleLowerCase().includes(term)
      );
    });
  }, [allProjects, search, view]);
  const selectedProject = allProjects.find((item) => item.project.id === selectedProjectId) ?? null;
  const mutationPending = respond.isPending;

  useEffect(() => {
    const projectId = selectedProject?.project.id;
    const updatedAt = selectedProject?.project.informationUpdatedAt;
    if (!projectId || !updatedAt || lastSeenProjectUpdates[projectId] === updatedAt) return;
    const nextSeen = { ...lastSeenProjectUpdates, [projectId]: updatedAt };
    setLastSeenProjectUpdates(nextSeen);
    try {
      localStorage.setItem(seenStorageKey, JSON.stringify(nextSeen));
    } catch {
      // Keep the current page usable when browser storage is unavailable.
    }
  }, [lastSeenProjectUpdates, seenStorageKey, selectedProject?.project.id, selectedProject?.project.informationUpdatedAt]);

  const hasNewProjectInformation = (item: MemberProject): boolean => {
    const updatedAt = item.project.informationUpdatedAt;
    if (!updatedAt) return false;
    const seenAt = lastSeenProjectUpdates[item.project.id];
    return !seenAt || new Date(updatedAt).getTime() > new Date(seenAt).getTime();
  };

  const openProject = (projectId: string): void => {
    const project = allProjects.find((item) => item.project.id === projectId);
    if (project?.project.informationUpdatedAt) {
      const nextSeen = { ...lastSeenProjectUpdates, [projectId]: project.project.informationUpdatedAt };
      setLastSeenProjectUpdates(nextSeen);
      try {
        localStorage.setItem(seenStorageKey, JSON.stringify(nextSeen));
      } catch {
        // Keep the current page usable when browser storage is unavailable.
      }
    }
    const next = new URLSearchParams(searchParams);
    next.set("project", projectId);
    setSearchParams(next);
    setNotice(null);
  };

  const closeProject = (): void => {
    const next = new URLSearchParams(searchParams);
    next.delete("project");
    setSearchParams(next);
    setNotice(null);
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 pb-24 sm:py-7">
      <header>
        <p className="text-sm font-medium text-[var(--color-primary)]">{ui("Projects")}</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{ui("Your projects")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">
          {ui("Review invitations, see your project teams, and revisit completed projects.")}
        </p>
      </header>

      {notice && (
        <div
          role={notice.isError ? "alert" : "status"}
          className="rounded-xl border border-[var(--color-border)] p-3 text-sm"
        >
          {notice.message}
        </div>
      )}

      {projects.isLoading ? (
        <div
          className="grid gap-4 lg:grid-cols-[minmax(17rem,0.75fr)_minmax(0,1.6fr)]"
          aria-label={ui("Loading projects…")}
        >
          <div className="h-72 animate-pulse rounded-2xl bg-[var(--color-surface-secondary)]" />
          <div className="hidden h-96 animate-pulse rounded-2xl bg-[var(--color-surface-secondary)] lg:block" />
        </div>
      ) : projects.isError ? (
        <div className="rounded-2xl border border-[var(--color-border)] p-5">
          <p role="alert" className="text-sm">
            {ui("Could not load your projects. Please try again.")}
          </p>
          <button
            type="button"
            onClick={() => {
              void projects.refetch();
            }}
            className="mt-3 min-h-11 rounded-lg border border-[var(--color-border)] px-4 text-sm font-semibold"
          >
            {ui("Try again")}
          </button>
        </div>
      ) : allProjects.length === 0 ? (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6 text-sm text-[var(--color-text-secondary)]">
          <h2 className="font-semibold text-[var(--color-text)]">{ui("No projects yet.")}</h2>
          <p className="mt-1">
            {ui("Project invitations and projects you join will appear here.")}
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,0.75fr)_minmax(0,1.6fr)]">
          <section
            aria-label={ui("Project list")}
            className={selectedProjectId ? "hidden lg:block" : ""}
          >
            <label htmlFor="project-search" className="sr-only">
              {ui("Search projects")}
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]"
                aria-hidden="true"
              />
              <input
                id="project-search"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
                placeholder={ui("Search projects")}
                className="min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-10 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              />
            </div>

            <div
              className="mt-3 grid grid-cols-3 gap-2"
              role="group"
              aria-label={ui("Project views")}
            >
              {(Object.keys(viewLabels) as ProjectView[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  onClick={() => {
                    setSelectedView(key);
                  }}
                  className={`min-h-11 rounded-xl border px-2 py-2 text-center text-xs font-semibold transition-colors sm:text-sm ${view === key ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]"}`}
                >
                  {ui(viewLabels[key])} <span className="ml-1 opacity-80">{counts[key]}</span>
                </button>
              ))}
            </div>

            <ul className="mt-3 space-y-2">
              {visibleProjects.map((item) => {
                const selected = selectedProjectId === item.project.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        openProject(item.project.id);
                      }}
                      className={`w-full rounded-2xl border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${selected ? "border-[var(--color-primary)] bg-[var(--color-surface-secondary)]" : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)]"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 font-semibold">{item.project.name}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {hasNewProjectInformation(item) && <span className="rounded-full bg-red-600 px-2 py-1 text-[10px] font-semibold text-white">{ui("New information")}</span>}
                          <span className="rounded-full bg-[var(--color-surface-secondary)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)]">
                            {projectStatusLabel(item)}
                          </span>
                        </span>
                      </div>
                      {item.project.description && (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                          {item.project.description}
                        </p>
                      )}
                      {item.status === "ACCEPTED" && Array.isArray(item.project.members) && (
                        <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
                          {item.project.members.length} {ui("team members")}
                        </p>
                      )}
                    </button>
                  </li>
                );
              })}
              {visibleProjects.length === 0 && (
                <li className="rounded-2xl border border-dashed border-[var(--color-border)] p-5 text-sm text-[var(--color-text-secondary)]">
                  {search.trim()
                    ? ui("No projects match your search.")
                    : ui("No projects in this view.")}
                </li>
              )}
            </ul>
          </section>

          <div className={selectedProjectId ? "" : "hidden lg:block"}>
            {selectedProject ? (
              <ProjectDetail
                membership={selectedProject}
                pending={mutationPending}
                onRespond={(response) => {
                  respond.mutate({ projectId: selectedProject.project.id, response });
                }}
                onBack={closeProject}
                currentMemberId={currentMemberId}
              />
            ) : selectedProjectId ? (
              <section className="rounded-2xl border border-[var(--color-border)] p-5">
                <button
                  type="button"
                  onClick={() => {
                    closeProject();
                  }}
                  className="mb-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[var(--color-primary)] lg:hidden"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  {ui("Back to projects")}
                </button>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {ui("This project is no longer available to your account.")}
                </p>
              </section>
            ) : (
              <section className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
                <CheckCircle2 className="mx-auto h-7 w-7" aria-hidden="true" />
                <p className="mt-3 font-medium">
                  {ui("Choose a project to see its details and team.")}
                </p>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
