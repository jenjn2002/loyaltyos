import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fetchApi } from "../lib/api-client";

interface MemberProject {
  id: string;
  status: "INVITED" | "ACCEPTED" | "DECLINED";
  project: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    fieldValues: Record<string, unknown>;
    tasks: { id: string; title: string; description: string | null; status: "TODO" | "IN_PROGRESS" | "DONE"; dueAt: string | null }[];
  };
}

export default function Projects() {
  const client = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const projects = useQuery({ queryKey: ["member-projects"], queryFn: () => fetchApi<MemberProject[]>("/members/me/projects") });
  const respond = useMutation({
    mutationFn: ({ projectId, response }: { projectId: string; response: "ACCEPTED" | "DECLINED" }) => fetchApi(`/members/me/projects/${projectId}/respond`, { method: "POST", body: JSON.stringify({ response }) }),
    onSuccess: async () => { setNotice(ui("Your response has been saved.")); await client.invalidateQueries({ queryKey: ["member-projects"] }); },
    onError: (error: Error) => setNotice(error.message),
  });
  const updateTask = useMutation({
    mutationFn: ({ projectId, taskId, status }: { projectId: string; taskId: string; status: "IN_PROGRESS" | "DONE" }) => fetchApi(`/members/me/projects/${projectId}/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["member-projects"] }); },
    onError: (error: Error) => setNotice(error.message),
  });

  return <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-6 pb-24">
    <header><p className="text-sm font-medium text-[var(--color-primary)]">{ui("Projects")}</p><h1 className="mt-1 text-2xl font-bold">{ui("Your projects")}</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{ui("Review invitations, accept projects, and update your assigned tasks.")}</p></header>
    {notice && <div role="status" className="rounded-xl border border-[var(--color-border)] p-3 text-sm">{notice}</div>}
    {projects.isLoading && <p className="text-sm text-[var(--color-text-secondary)]">{ui("Loading projects…")}</p>}
    {projects.isError && <p role="alert" className="text-sm">{ui("Could not load your projects. Please try again.")}</p>}
    {!projects.isLoading && !projects.isError && !projects.data?.length && <div className="rounded-2xl border border-[var(--color-border)] p-5 text-sm text-[var(--color-text-secondary)]">{ui("No project invitations or active projects yet.")}</div>}
    {(projects.data ?? []).map(({ id, status, project }) => {
      const projectCompleted = ["COMPLETED", "ISSUE_PENDING", "ISSUE_REJECTED", "ISSUED", "CLOSED"].includes(project.status);
      return <article key={id} className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2"><div><h2 className="text-lg font-semibold">{project.name}</h2><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{ui(projectCompleted ? "Completed" : status === "INVITED" ? "Invitation pending" : status === "ACCEPTED" ? "Joined" : "Declined")}</p></div></div>
      {project.description && <p className="text-sm text-[var(--color-text-secondary)]">{project.description}</p>}
      {status === "INVITED" && <div className="flex gap-2"><button type="button" className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={projectCompleted || respond.isPending} onClick={() => respond.mutate({ projectId: project.id, response: "ACCEPTED" })}>{ui("Accept invitation")}</button><button type="button" className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50" disabled={projectCompleted || respond.isPending} onClick={() => respond.mutate({ projectId: project.id, response: "DECLINED" })}>{ui("Decline")}</button></div>}
      {status === "ACCEPTED" && <div className="space-y-2"><h3 className="text-sm font-semibold">{ui("My tasks")}</h3>{project.tasks.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">{ui("No tasks assigned to you yet.")}</p>}{project.tasks.map((task) => <div key={task.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] p-3"><div><p className="text-sm font-medium">{task.title}</p>{task.description && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{task.description}</p>}{task.dueAt && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{ui("Due")} {new Date(task.dueAt).toLocaleDateString()}</p>}</div><select aria-label={`${ui("Update task")}: ${task.title}`} className="max-w-36 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs disabled:cursor-not-allowed disabled:opacity-50" value={task.status} disabled={projectCompleted || updateTask.isPending} onChange={(event) => { if (event.target.value === "IN_PROGRESS" || event.target.value === "DONE") updateTask.mutate({ projectId: project.id, taskId: task.id, status: event.target.value }); }}>
        {task.status === "TODO" && <option value="TODO">{ui("To do")}</option>}
        <option value="IN_PROGRESS">{ui("In progress")}</option><option value="DONE">{ui("Done")}</option></select></div>)}</div>}
    </article>;
    })}
  </div>;
}
