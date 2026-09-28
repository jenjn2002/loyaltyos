import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi } from "@/lib/api-client";

type ProjectField = { id: string; key: string; label: string; type: "TEXT" | "NUMBER" | "BOOLEAN" | "DATE" | "SELECT"; required: boolean; options: string[]; isActive: boolean; sortOrder: number };
type PointType = { id: string; code: string; name: string; unitLabel: string; bankBalance: number | null };
type Member = { id: string; email: string | null; firstName: string | null; lastName: string | null; department: string | null };
type Bootstrap = { fields: ProjectField[]; pointTypes: PointType[]; members: Member[]; canManageProjects: boolean };
type Budget = { id: string; pointTypeId: string; requestedAmount: number; approvedAmount: number; remainingAmount: number; issuedAmount: number; pointType: { code: string; name: string; unitLabel?: string } };
type Participant = { id: string; memberId: string; status: string; member: Member };
type Task = { id: string; title: string; description: string | null; status: string; dueAt: string | null; assignee: Member | null };
type Project = { id: string; name: string; description: string | null; status: string; updatedAt: string; createdBy?: { id: string; name: string; email: string } | null; fieldValues: Record<string, unknown>; budgets: Budget[]; members?: Participant[]; tasks?: Task[]; issueBatches?: { id: string; status: string; allocations: { id: string; member: Member; pointType: { code: string }; amount: number }[] }[]; budgetTransactions?: { id: string; createdAt: string; pointType: { code: string }; type: string; amount: number; reason: string }[]; _count?: { members: number; tasks: number } };

const labelForStatus: Record<string, string> = {
  DRAFT: "Draft", PLAN_PENDING: "Plan pending approval", PLAN_REJECTED: "Plan rejected", APPROVED: "Approved · ready to activate", ACTIVE: "Active", COMPLETED: "Completed · ready for distribution", ISSUE_PENDING: "Distribution pending approval", ISSUE_REJECTED: "Distribution rejected", ISSUED: "Points issued", CLOSED: "Closed",
};
const personName = (person: Member): string => [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email || person.id;
const projectStatusLabel = (status: string): string => ui(labelForStatus[status] ?? status);

export function ProjectsPage(): JSX.Element {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [budgetValues, setBudgetValues] = useState<Record<string, string>>({});
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [allocationValues, setAllocationValues] = useState<Record<string, { mode: "AMOUNT" | "PERCENT"; value: string }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldKey, setFieldKey] = useState("");
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldType, setFieldType] = useState<ProjectField["type"]>("TEXT");
  const [fieldOptions, setFieldOptions] = useState("");
  const [fieldRequired, setFieldRequired] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);

  const bootstrap = useQuery({ queryKey: ["projects", "bootstrap"], queryFn: () => fetchApi<Bootstrap>("/admin/projects/bootstrap") });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => fetchApi<Project[]>("/admin/projects"), refetchInterval: 30_000 });
  const detail = useQuery({ queryKey: ["projects", selectedId], queryFn: () => fetchApi<Project>(`/admin/projects/${selectedId ?? ""}`), enabled: Boolean(selectedId), refetchInterval: (query) => ["PLAN_PENDING", "ISSUE_PENDING"].includes((query.state.data as Project | undefined)?.status ?? "") ? 15_000 : false });
  const current = detail.data;
  const canManage = Boolean(bootstrap.data?.canManageProjects);
  const editable = canManage && (!current || current.status === "DRAFT" || current.status === "PLAN_REJECTED");

  useEffect(() => {
    if (!current || !editable) return;
    setName(current.name);
    setDescription(current.description ?? "");
    setFieldValues(current.fieldValues ?? {});
    setBudgetValues(Object.fromEntries(current.budgets.map((budget) => [budget.pointTypeId, String(budget.requestedAmount)])));
  }, [current?.id, current?.updatedAt, editable]);

  const refresh = async (): Promise<void> => {
    await Promise.all([client.invalidateQueries({ queryKey: ["projects"] }), client.invalidateQueries({ queryKey: ["projects", selectedId] }), client.invalidateQueries({ queryKey: ["projects", "bootstrap"] })]);
  };
  const planPayload = (): { name: string; description: string; fieldValues: Record<string, unknown>; budgets: { pointTypeId: string; amount: number }[] } => ({
    name: name.trim(), description, fieldValues,
    budgets: Object.entries(budgetValues).filter(([, amount]) => amount.trim()).map(([pointTypeId, amount]) => ({ pointTypeId, amount: Number(amount) })).filter((budget) => Number.isInteger(budget.amount) && budget.amount > 0),
  });
  const savePlan = useMutation({
    mutationFn: async ({ submitForApproval }: { submitForApproval: boolean }) => {
      const body = planPayload();
      if (!body.name || !body.budgets.length) throw new Error(ui("Enter a project name and at least one positive point budget."));
      const project = current
        ? await fetchApi<Project>(`/admin/projects/${current.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await fetchApi<Project>("/admin/projects", { method: "POST", body: JSON.stringify(body) });
      if (!submitForApproval) return { project, submitted: false as const, submissionError: undefined };
      try {
        await fetchApi(`/admin/projects/${project.id}/submit-plan`, { method: "POST" });
        return { project, submitted: true as const, submissionError: undefined };
      } catch (error) {
        return { project, submitted: false as const, submissionError: error instanceof Error ? error.message : String(error) };
      }
    },
    onSuccess: async ({ project, submitted, submissionError }) => {
      setSelectedId(project.id);
      setNotice(submissionError
        ? `${ui("Draft saved, but submission failed.")} ${submissionError}`
        : ui(submitted ? "Project plan submitted for approval." : "Project plan saved as draft."));
      if (submitted) await client.invalidateQueries({ queryKey: ["admin", "approvals"] });
      await refresh();
    },
    onError: (error: Error) => setNotice(error.message),
  });
  const callProject = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) => fetchApi(`/admin/projects/${selectedId}/${action}`, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    onSuccess: async () => { setNotice(ui("Project updated.")); await refresh(); },
    onError: (error: Error) => setNotice(error.message),
  });
  const invite = useMutation({ mutationFn: () => fetchApi(`/admin/projects/${selectedId}/members`, { method: "POST", body: JSON.stringify({ memberIds }) }), onSuccess: async () => { setMemberIds([]); setNotice(ui("Member invitations sent.")); await refresh(); }, onError: (error: Error) => setNotice(error.message) });
  const createTask = useMutation({ mutationFn: () => fetchApi(`/admin/projects/${selectedId}/tasks`, { method: "POST", body: JSON.stringify({ title: taskTitle, description: taskDescription, assigneeId: taskAssignee || null }) }), onSuccess: async () => { setTaskTitle(""); setTaskDescription(""); setTaskAssignee(""); await refresh(); }, onError: (error: Error) => setNotice(error.message) });
  const updateTask = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => fetchApi(`/admin/projects/${selectedId}/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }), onSuccess: refresh, onError: (error: Error) => setNotice(error.message) });
  const createField = useMutation({ mutationFn: () => fetchApi<ProjectField>("/admin/project-fields", { method: "POST", body: JSON.stringify({ key: fieldKey.trim().toLowerCase(), label: fieldLabel, type: fieldType, required: fieldRequired, options: fieldOptions.split(",").map((item) => item.trim()).filter(Boolean), sortOrder: bootstrap.data?.fields.length ?? 0 }) }), onSuccess: async () => { setFieldKey(""); setFieldLabel(""); setFieldOptions(""); setFieldRequired(false); await refresh(); }, onError: (error: Error) => setNotice(error.message) });
  const archiveField = useMutation({ mutationFn: (id: string) => fetchApi(`/admin/project-fields/${id}`, { method: "DELETE" }), onSuccess: refresh, onError: (error: Error) => setNotice(error.message) });

  const acceptedMembers = useMemo(() => (current?.members ?? []).filter((member) => member.status === "ACCEPTED"), [current?.members]);
  const rows = useMemo(() => acceptedMembers.flatMap((participant) => (current?.budgets ?? []).map((budget) => ({ participant, budget, key: `${participant.memberId}:${budget.pointTypeId}` }))), [acceptedMembers, current?.budgets]);
  const allocationTotals = (current?.budgets ?? []).map((budget) => ({
    budget,
    amount: rows.filter((row) => row.budget.id === budget.id).reduce((sum, row) => {
      const entry = allocationValues[row.key];
      if (!entry?.value) return sum;
      const value = Number(entry.value);
      return sum + (entry.mode === "PERCENT" ? Math.floor(budget.approvedAmount * value / 100) : value);
    }, 0),
  }));
  const issue = useMutation({
    mutationFn: () => {
      const allocations = rows.filter((row) => allocationValues[row.key]?.value).map((row) => ({ memberId: row.participant.memberId, pointTypeId: row.budget.pointTypeId, mode: allocationValues[row.key]!.mode, value: Number(allocationValues[row.key]!.value) }));
      if (!allocations.length) throw new Error(ui("Enter at least one member allocation."));
      return fetchApi(`/admin/projects/${selectedId}/submit-issuance`, { method: "POST", body: JSON.stringify({ allocations }) });
    },
    onSuccess: async () => { setNotice(ui("Point distribution submitted for approval.")); await refresh(); },
    onError: (error: Error) => setNotice(error.message),
  });

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-3xl font-bold">{ui("Group projects")}</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{ui("Plan a project and request a point budget, invite members after approval, track tasks, then submit member allocations for separate approval. Budget details are only shown to the project manager and authorized admins.")}</p></div>
        {canManage && <Button variant="outline" onClick={() => setFieldsOpen((open) => !open)}>{fieldsOpen ? ui("Hide project fields") : ui("Manage project fields")}</Button>}
      </header>
      {notice && <div role="status" className="rounded-md border bg-muted p-3 text-sm">{notice}</div>}
      {fieldsOpen && canManage && <Card><CardHeader><CardTitle>{ui("Shared project fields")}</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{ui("These admin-managed fields are available on every project plan.")}</p>
        <div className="grid gap-3 md:grid-cols-4"><div><Label>{ui("Field key")}</Label><Input value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} placeholder="project_code" /></div><div><Label>{ui("Label")}</Label><Input value={fieldLabel} onChange={(e) => setFieldLabel(e.target.value)} /></div><div><Label>{ui("Type")}</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={fieldType} onChange={(e) => setFieldType(e.target.value as ProjectField["type"])}>{["TEXT", "NUMBER", "BOOLEAN", "DATE", "SELECT"].map((type) => <option key={type}>{type}</option>)}</select></div><div><Label>{ui("Select options (comma-separated)")}</Label><Input value={fieldOptions} onChange={(e) => setFieldOptions(e.target.value)} disabled={fieldType !== "SELECT"} /></div></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fieldRequired} onChange={(e) => setFieldRequired(e.target.checked)} />{ui("Required")}</label>
        <Button onClick={() => createField.mutate()} disabled={!fieldKey.trim() || !fieldLabel.trim() || createField.isPending}>{ui("Add field")}</Button>
        <div className="space-y-2">{(bootstrap.data?.fields ?? []).map((field) => <div key={field.id} className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"><span>{field.label} · {field.type}{field.required ? ` · ${ui("Required")}` : ""}</span><Button size="sm" variant="ghost" onClick={() => archiveField.mutate(field.id)} disabled={archiveField.isPending}>{ui("Archive")}</Button></div>)}</div>
      </CardContent></Card>}
      <div className="grid gap-6 lg:grid-cols-[minmax(15rem,0.75fr)_minmax(0,1.6fr)]">
        <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>{ui("Group projects")}</CardTitle>{canManage && <Button size="sm" variant="outline" onClick={() => { setSelectedId(null); setName(""); setDescription(""); setFieldValues({}); setBudgetValues({}); }}>{ui("New project")}</Button>}</CardHeader><CardContent className="space-y-2">
          {(projects.data ?? []).map((project) => <button type="button" key={project.id} onClick={() => setSelectedId(project.id)} className={`w-full rounded-md border p-3 text-left ${project.id === selectedId ? "border-primary bg-primary/5" : "hover:bg-muted"}`}><p className="font-semibold">{project.name}</p><p className="mt-1 text-xs text-muted-foreground">{projectStatusLabel(project.status)}</p><p className="mt-1 text-xs text-muted-foreground">{project._count?.members ?? 0} {ui("members")} · {project._count?.tasks ?? 0} {ui("tasks")}{project.createdBy?.name ? ` · ${ui("Created by")}: ${project.createdBy.name}` : ""}</p></button>)}
          {!projects.data?.length && <p className="text-sm text-muted-foreground">{ui("No projects yet.")}</p>}
        </CardContent></Card>
        {canManage && (!selectedId || (current && editable)) ? <Card><CardHeader><CardTitle>{current ? ui("Project plan") : ui("Create project plan")}</CardTitle></CardHeader><CardContent className="space-y-4">
          {current && <p className="text-sm text-muted-foreground">{projectStatusLabel(current.status)}</p>}
          <div><Label>{ui("Project name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div><div><Label>{ui("Description")}</Label><textarea className="min-h-20 w-full rounded-md border bg-background p-3 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          {(bootstrap.data?.fields ?? []).map((field) => <div key={field.id}><Label>{field.label}{field.required ? " *" : ""}</Label>{field.type === "BOOLEAN" ? <input type="checkbox" checked={Boolean(fieldValues[field.key])} onChange={(e) => setFieldValues({ ...fieldValues, [field.key]: e.target.checked })} /> : field.type === "SELECT" ? <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={String(fieldValues[field.key] ?? "")} onChange={(e) => setFieldValues({ ...fieldValues, [field.key]: e.target.value })}><option value="">{ui("Select")}</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select> : <Input type={field.type === "NUMBER" ? "number" : field.type === "DATE" ? "date" : "text"} value={String(fieldValues[field.key] ?? "")} onChange={(e) => setFieldValues({ ...fieldValues, [field.key]: field.type === "NUMBER" ? Number(e.target.value) : e.target.value })} />}</div>)}
          <div className="space-y-3 rounded-md border p-3"><div><h3 className="font-semibold">{ui("Requested point budget")}</h3><p className="text-xs text-muted-foreground">{ui("Budget is reserved from the bank only after plan approval.")}</p></div>{(bootstrap.data?.pointTypes ?? []).map((type) => <div key={type.id} className="grid items-center gap-2 sm:grid-cols-[1fr_10rem]"><div><p className="text-sm font-medium">{type.code} · {type.name}</p>{type.bankBalance !== null && <p className="text-xs text-muted-foreground">{ui("Bank available")}: {type.bankBalance.toLocaleString()}</p>}</div><Input type="number" min="0" placeholder={ui("No budget") as string} value={budgetValues[type.id] ?? ""} onChange={(e) => setBudgetValues({ ...budgetValues, [type.id]: e.target.value })} /></div>)}</div>
          <div className="flex flex-wrap gap-2"><Button onClick={() => savePlan.mutate({ submitForApproval: false })} disabled={savePlan.isPending}>{ui("Save draft")}</Button><Button variant="outline" onClick={() => savePlan.mutate({ submitForApproval: true })} disabled={savePlan.isPending}>{ui("Save and submit for approval")}</Button></div>
        </CardContent></Card> : current ? <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{current?.name}</CardTitle><span className="rounded-full bg-muted px-3 py-1 text-xs">{projectStatusLabel(current?.status ?? "")}</span></div></CardHeader><CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">{current?.description}</p>
          {current?.createdBy && <p className="text-xs text-muted-foreground">{ui("Created by")}: {current.createdBy.name} · {current.createdBy.email}</p>}
          {Object.entries(current?.fieldValues ?? {}).length > 0 && <div className="grid gap-2 sm:grid-cols-2">{Object.entries(current?.fieldValues ?? {}).map(([key, value]) => <p key={key} className="text-sm"><span className="text-muted-foreground">{bootstrap.data?.fields.find((f) => f.key === key)?.label ?? key}:</span> {String(value)}</p>)}</div>}
          {canManage && <div className="flex flex-wrap gap-2">{current?.status === "APPROVED" && <Button onClick={() => callProject.mutate({ action: "activate" })}>{ui("Activate project")}</Button>}{["COMPLETED", "ISSUED"].includes(current?.status ?? "") && <Button variant="outline" onClick={() => callProject.mutate({ action: "close" })}>{ui("Close project and return unused budget")}</Button>}{current?.status === "ACTIVE" && <Button variant="outline" onClick={() => callProject.mutate({ action: "complete" })}>{ui("Confirm project complete")}</Button>}</div>}
          {current?.budgets.map((budget) => <div key={budget.id} className="flex flex-wrap justify-between gap-2 rounded border px-3 py-2 text-sm"><span>{budget.pointType.code} · {budget.pointType.name}</span><span>{ui("Approved")}: {budget.approvedAmount.toLocaleString()} · {ui("Remaining")}: {budget.remainingAmount.toLocaleString()} · {ui("Issued")}: {budget.issuedAmount.toLocaleString()}</span></div>)}
          {current?.status === "ACTIVE" && canManage && <section className="space-y-3 rounded-md border p-4"><h3 className="font-semibold">{ui("Invite members")}</h3><select multiple size={6} className="w-full rounded-md border bg-background p-2 text-sm" value={memberIds} onChange={(e) => setMemberIds(Array.from(e.target.selectedOptions, (option) => option.value))}>{(bootstrap.data?.members ?? []).filter((member) => !(current.members ?? []).some((item) => item.memberId === member.id && ["INVITED", "ACCEPTED"].includes(item.status))).map((member) => <option key={member.id} value={member.id}>{personName(member)} · {member.email ?? "—"}{member.department ? ` · ${member.department}` : ""}</option>)}</select><Button onClick={() => invite.mutate()} disabled={!memberIds.length || invite.isPending}>{ui("Send invitations")}</Button><div className="flex flex-wrap gap-2">{(current.members ?? []).map((item) => <span key={item.id} className="rounded-full border px-3 py-1 text-xs">{personName(item.member)} · {item.status}</span>)}</div></section>}
          {current?.status === "ACTIVE" && !canManage && <section className="rounded-md border p-4"><h3 className="font-semibold">{ui("Project members")}</h3><div className="mt-3 flex flex-wrap gap-2">{(current.members ?? []).map((item) => <span key={item.id} className="rounded-full border px-3 py-1 text-xs">{personName(item.member)} · {item.status}</span>)}</div></section>}
          {current?.status === "ACTIVE" && canManage && <section className="space-y-3 rounded-md border p-4"><h3 className="font-semibold">{ui("Tasks")}</h3><div className="grid gap-2 md:grid-cols-3"><Input placeholder={ui("Task title") as string} value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} /><Input placeholder={ui("Description") as string} value={taskDescription} onChange={(e) => setTaskDescription(e.target.value)} /><select className="h-10 rounded-md border bg-background px-3 text-sm" value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value)}><option value="">{ui("Unassigned")}</option>{acceptedMembers.map(({ member }) => <option key={member.id} value={member.id}>{personName(member)}</option>)}</select></div><Button variant="outline" onClick={() => createTask.mutate()} disabled={!taskTitle.trim() || createTask.isPending}>{ui("Add task")}</Button><div className="space-y-2">{(current.tasks ?? []).map((task) => <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"><div><p className="font-medium">{task.title}</p><p className="text-xs text-muted-foreground">{task.assignee ? personName(task.assignee) : ui("Unassigned")} · {task.status}</p></div><select className="h-9 rounded-md border bg-background px-2 text-sm" value={task.status} onChange={(e) => updateTask.mutate({ id: task.id, status: e.target.value })}><option value="TODO">TODO</option><option value="IN_PROGRESS">IN_PROGRESS</option><option value="DONE">DONE</option></select></div>)}</div></section>}
          {current?.status === "ACTIVE" && !canManage && <section className="rounded-md border p-4"><h3 className="font-semibold">{ui("Tasks")}</h3><div className="mt-3 space-y-2">{(current.tasks ?? []).map((task) => <div key={task.id} className="rounded border p-3"><p className="font-medium">{task.title}</p><p className="text-xs text-muted-foreground">{task.assignee ? personName(task.assignee) : ui("Unassigned")} · {task.status}</p></div>)}</div></section>}
          {["COMPLETED", "ISSUE_REJECTED"].includes(current?.status ?? "") && canManage && <section className="space-y-3 rounded-md border p-4"><div><h3 className="font-semibold">{ui("Member point distribution")}</h3><p className="text-xs text-muted-foreground">{ui("Percentages are calculated independently from each point type’s approved project budget. Totals must remain within each type’s remaining balance.")}</p></div>{rows.length ? <div className="space-y-2">{rows.map((row) => { const entry = allocationValues[row.key] ?? { mode: "AMOUNT" as const, value: "" }; return <div key={row.key} className="grid items-center gap-2 rounded border p-2 sm:grid-cols-[1fr_8rem_9rem]"><div className="text-sm">{personName(row.participant.member)} · {row.budget.pointType.code}<span className="block text-xs text-muted-foreground">{ui("Remaining")}: {row.budget.remainingAmount.toLocaleString()}</span></div><select className="h-9 rounded-md border bg-background px-2 text-sm" value={entry.mode} onChange={(e) => setAllocationValues({ ...allocationValues, [row.key]: { ...entry, mode: e.target.value as "AMOUNT" | "PERCENT" } })}><option value="AMOUNT">{ui("Points")}</option><option value="PERCENT">%</option></select><Input type="number" min="0" max={entry.mode === "PERCENT" ? "100" : undefined} value={entry.value} onChange={(e) => setAllocationValues({ ...allocationValues, [row.key]: { ...entry, value: e.target.value } })} /></div>; })}</div> : <p className="text-sm text-muted-foreground">{ui("Only accepted members can receive project points.")}</p>}<div className="flex flex-wrap gap-2">{allocationTotals.map(({ budget, amount }) => <span key={budget.id} className="rounded-full border px-3 py-1 text-xs">{budget.pointType.code}: {amount.toLocaleString()} / {budget.remainingAmount.toLocaleString()}</span>)}</div><Button onClick={() => issue.mutate()} disabled={!rows.length || issue.isPending}>{ui("Submit point distribution for approval")}</Button></section>}
          {(current?.issueBatches ?? []).map((batch) => <section key={batch.id} className="rounded-md border p-3"><p className="font-semibold">{ui("Distribution batch")}: {batch.status}</p><div className="mt-2 space-y-1 text-sm">{(batch.allocations ?? []).map((allocation) => <p key={allocation.id}>{personName(allocation.member)} · {allocation.pointType.code} · {allocation.amount.toLocaleString()}</p>)}</div></section>)}
          {(current?.budgetTransactions ?? []).length > 0 && <section><h3 className="font-semibold">{ui("Project budget history")}</h3><div className="mt-2 space-y-1 text-sm">{current?.budgetTransactions?.map((item) => <p key={item.id}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ""} · {item.pointType.code} · {item.type} · {item.amount.toLocaleString()} · {item.reason}</p>)}</div></section>}
        </CardContent></Card> : <Card><CardContent className="p-6 text-sm text-muted-foreground">{bootstrap.isLoading || projects.isLoading ? ui("Loading projects…") : ui("Select a project to view details.")}</CardContent></Card>}
      </div>
    </div>
  );
}
