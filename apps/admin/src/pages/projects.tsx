import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";

type ProjectField = { id: string; key: string; label: string; type: "TEXT" | "NUMBER" | "BOOLEAN" | "DATE" | "SELECT"; required: boolean; options: string[]; isActive: boolean; sortOrder: number };
type PointType = { id: string; code: string; name: string; unitLabel: string; bankBalance: number | null };
type Member = { id: string; email: string | null; firstName: string | null; lastName: string | null; department: string | null };
type Bootstrap = { fields: ProjectField[]; pointTypes: PointType[]; members: Member[]; canManageProjects: boolean };
type Budget = { id: string; pointTypeId: string; requestedAmount: number; approvedAmount: number; remainingAmount: number; issuedAmount: number; pointType: { code: string; name: string; unitLabel?: string } };
type Participant = { id: string; memberId: string; status: string; member: Member };
type Task = { id: string; title: string; description: string | null; status: string; dueAt: string | null; assignee: Member | null };
type ApprovalSummary = { id: string; status: string; requestedAt: string; resolvedAt: string | null; decision: string | null; comment: string | null };
type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  updatedAt: string;
  canManage: boolean;
  canViewBudget: boolean;
  createdBy?: { id: string; name: string; email: string } | null;
  fieldValues: Record<string, unknown>;
  budgets?: Budget[];
  members?: Participant[];
  tasks?: Task[];
  issueBatches?: { id: string; status: string; allocations: { id: string; member: Member; pointType: { code: string }; amount: number }[] }[];
  budgetTransactions?: { id: string; createdAt: string; pointType: { code: string }; type: string; amount: number; reason: string }[];
  approvalSummary?: { plan: ApprovalSummary | null; distribution: ApprovalSummary | null };
  _count?: { members: number; tasks: number };
};
type AllocationEntry = { mode: "AMOUNT" | "PERCENT"; value: string };
type ProjectStatusFilter = "ALL" | "DRAFT" | "PLAN_PENDING" | "PLAN_REJECTED" | "APPROVED" | "ACTIVE" | "COMPLETED" | "ISSUE_PENDING" | "ISSUE_REJECTED" | "ISSUED" | "CLOSED";
type WorkspaceTab = "overview" | "members" | "tasks" | "budget" | "history";

const statusOptions: ProjectStatusFilter[] = ["DRAFT", "PLAN_PENDING", "PLAN_REJECTED", "APPROVED", "ACTIVE", "COMPLETED", "ISSUE_PENDING", "ISSUE_REJECTED", "ISSUED", "CLOSED"];
const membershipStatusLabels: Record<string, string> = { INVITED: "Invited", ACCEPTED: "Accepted", DECLINED: "Declined" };
const projectFieldTypeLabels: Record<ProjectField["type"], string> = { TEXT: "Text", NUMBER: "Number", BOOLEAN: "Boolean", DATE: "Date", SELECT: "Select" };
const labelForStatus: Record<string, string> = {
  DRAFT: "Draft", PLAN_PENDING: "Plan pending approval", PLAN_REJECTED: "Plan rejected", APPROVED: "Approved · ready to activate", ACTIVE: "Active", COMPLETED: "Completed · ready for distribution", ISSUE_PENDING: "Distribution pending approval", ISSUE_REJECTED: "Distribution rejected", ISSUED: "Points issued", CLOSED: "Closed",
};
const personName = (person: Member): string => [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email || person.id;
const humanizeEnum = (value: string): string => ui(value.toLocaleLowerCase().split("_").map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1)).join(" "));
const projectStatusLabel = (status: string): string => ui(labelForStatus[status] ?? humanizeEnum(status));
const membershipStatusLabel = (status: string): string => ui(membershipStatusLabels[status] ?? humanizeEnum(status));
const memberSearchText = (member: Member): string => [personName(member), member.email, member.department].filter(Boolean).join(" ").toLocaleLowerCase();
const dateInputValue = (value: string | null): string => value ? value.slice(0, 10) : "";
const dateLabel = (value: string | null): string => value ? new Date(`${value.slice(0, 10)}T12:00:00.000Z`).toLocaleDateString() : "";

function stageForStatus(status: string): { label: string; index: number } {
  if (["DRAFT", "PLAN_PENDING", "PLAN_REJECTED"].includes(status)) return { label: ui("Plan and approval"), index: 0 };
  if (status === "APPROVED") return { label: ui("Ready to activate"), index: 1 };
  if (status === "ACTIVE") return { label: ui("Project delivery"), index: 2 };
  if (["COMPLETED", "ISSUE_PENDING", "ISSUE_REJECTED"].includes(status)) return { label: ui("Point distribution"), index: 3 };
  return { label: status === "CLOSED" ? ui("Closed") : ui("Complete"), index: 4 };
}

function nextActionFor(project: Project, openTaskCount: number): string {
  if (project.status === "DRAFT") return ui("Complete the project plan and submit it for approval.");
  if (project.status === "PLAN_REJECTED") return ui("Review the rejection feedback, update the plan, and submit it again.");
  if (project.status === "PLAN_PENDING") return ui("The plan is waiting for an approver.");
  if (project.status === "APPROVED") return project.canManage ? ui("Activate the approved project to invite members and start tasks.") : ui("The project manager can activate this approved plan.");
  if (project.status === "ACTIVE") {
    if (openTaskCount > 0) return ui("Finish the open tasks before confirming project completion.");
    return project.canManage ? ui("The project is ready for completion review.") : ui("The project manager can confirm completion when delivery is finished.");
  }
  if (project.status === "COMPLETED") return project.canManage ? ui("Prepare member allocations and submit the distribution for approval.") : ui("The project manager is preparing the point distribution.");
  if (project.status === "ISSUE_REJECTED") return ui("Review the rejection feedback, adjust the member allocations, and submit again.");
  if (project.status === "ISSUE_PENDING") return ui("The point distribution is waiting for an approver.");
  if (project.status === "ISSUED") return project.canManage ? ui("Points have been issued. Close the project when you are ready to return any unused budget.") : ui("Points have been issued; the project manager can close the project.");
  return ui("This project is closed.");
}

export function ProjectsPage(): JSX.Element {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("overview");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter | "ALL">("ALL");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [budgetValues, setBudgetValues] = useState<Record<string, string>>({});
  const [memberSearch, setMemberSearch] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [allocationValues, setAllocationValues] = useState<Record<string, AllocationEntry>>({});
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
  const canManageGlobally = bootstrap.data?.canManageProjects === true;
  const canViewBudget = current?.canViewBudget === true;
  const editable = creating || Boolean(current?.canManage && ["DRAFT", "PLAN_REJECTED"].includes(current.status));
  const currentTasks = current?.tasks ?? [];
  const acceptedMembers = useMemo(() => (current?.members ?? []).filter((participant) => participant.status === "ACCEPTED"), [current?.members]);
  const openTaskCount = currentTasks.filter((task) => task.status !== "DONE").length;
  const filteredProjects = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (projects.data ?? []).filter((project) => {
      if (statusFilter !== "ALL" && project.status !== statusFilter) return false;
      if (!needle) return true;
      return [project.name, project.description, project.createdBy?.name, project.createdBy?.email].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle);
    });
  }, [projects.data, search, statusFilter]);
  const availableMembers = useMemo(() => (bootstrap.data?.members ?? []).filter((member) => !(current?.members ?? []).some((participant) => participant.memberId === member.id && ["INVITED", "ACCEPTED"].includes(participant.status))), [bootstrap.data?.members, current?.members]);
  const visibleMembers = useMemo(() => {
    const needle = memberSearch.trim().toLocaleLowerCase();
    return availableMembers.filter((member) => !needle || memberSearchText(member).includes(needle));
  }, [availableMembers, memberSearch]);
  const allVisibleSelected = visibleMembers.length > 0 && visibleMembers.every((member) => memberIds.includes(member.id));

  useEffect(() => {
    setWorkspaceTab("overview");
    setName("");
    setDescription("");
    setFieldValues({});
    setBudgetValues({});
    setMemberSearch("");
    setMemberIds([]);
    setTaskTitle("");
    setTaskDescription("");
    setTaskAssignee("");
    setTaskDueAt("");
    setEditingTaskId(null);
    setAllocationValues({});
  }, [selectedId, creating]);

  useEffect(() => {
    if (!current || !editable) return;
    setName(current.name);
    setDescription(current.description ?? "");
    setFieldValues(current.fieldValues ?? {});
    setBudgetValues(Object.fromEntries((current.budgets ?? []).map((budget) => [budget.pointTypeId, String(budget.requestedAmount)])));
  }, [current?.id, current?.updatedAt, editable]);

  useEffect(() => {
    if (!canViewBudget && workspaceTab === "budget") setWorkspaceTab("overview");
  }, [canViewBudget, workspaceTab]);

  const refresh = async (): Promise<void> => {
    await Promise.all([client.invalidateQueries({ queryKey: ["projects"] }), client.invalidateQueries({ queryKey: ["projects", selectedId] }), client.invalidateQueries({ queryKey: ["projects", "bootstrap"] })]);
  };
  const budgetValidation = useMemo(() => {
    const errors: Record<string, string> = {};
    const budgets: { pointTypeId: string; amount: number }[] = [];
    for (const type of bootstrap.data?.pointTypes ?? []) {
      const raw = budgetValues[type.id] ?? "";
      if (!raw.trim()) continue;
      const amount = Number(raw);
      if (!Number.isSafeInteger(amount) || amount <= 0) errors[type.id] = ui("Enter a whole number greater than zero, or clear this field.");
      else budgets.push({ pointTypeId: type.id, amount });
    }
    if (!budgets.length && !Object.values(errors).length) errors._form = ui("Add at least one positive point budget.");
    return { errors, budgets };
  }, [bootstrap.data?.pointTypes, budgetValues]);
  const requiredFieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const field of bootstrap.data?.fields ?? []) {
      const value = fieldValues[field.key] ?? (field.type === "BOOLEAN" ? false : undefined);
      if (field.required && (value === undefined || value === null || value === "")) errors[field.key] = ui("This field is required.");
    }
    return errors;
  }, [bootstrap.data?.fields, fieldValues]);
  const planPayload = (): { name: string; description: string; fieldValues: Record<string, unknown>; budgets: { pointTypeId: string; amount: number }[] } => ({
    name: name.trim(), description,
    fieldValues: {
      ...Object.fromEntries((bootstrap.data?.fields ?? []).filter((field) => field.type === "BOOLEAN").map((field) => [field.key, false])),
      ...fieldValues,
    },
    budgets: budgetValidation.budgets,
  });

  const savePlan = useMutation({
    mutationFn: async ({ submitForApproval }: { submitForApproval: boolean }) => {
      if (!name.trim()) throw new Error(ui("Enter a project name."));
      if (Object.keys(requiredFieldErrors).length) throw new Error(ui("Complete all required project fields."));
      if (Object.keys(budgetValidation.errors).length) throw new Error(budgetValidation.errors._form ?? ui("Fix the point budget values before saving."));
      const body = planPayload();
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
      setCreating(false);
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
    mutationFn: ({ action }: { action: string }) => fetchApi(`/admin/projects/${selectedId}/${action}`, { method: "POST" }),
    onSuccess: async () => { setNotice(ui("Project updated.")); await refresh(); },
    onError: (error: Error) => setNotice(error.message),
  });
  const invite = useMutation({
    mutationFn: () => fetchApi<{ invited: number }>(`/admin/projects/${selectedId}/members`, { method: "POST", body: JSON.stringify({ memberIds }) }),
    onSuccess: async (result) => { setMemberIds([]); setMemberSearch(""); setNotice(`${ui("Invitations sent:")} ${result.invited}`); await refresh(); },
    onError: (error: Error) => setNotice(error.message),
  });
  const saveTask = useMutation({
    mutationFn: () => {
      const dueAt = taskDueAt ? new Date(`${taskDueAt}T12:00:00.000Z`).toISOString() : null;
      const body = { title: taskTitle.trim(), description: taskDescription.trim() || null, assigneeId: taskAssignee || null, dueAt };
      return editingTaskId
        ? fetchApi(`/admin/projects/${selectedId}/tasks/${editingTaskId}`, { method: "PATCH", body: JSON.stringify(body) })
        : fetchApi(`/admin/projects/${selectedId}/tasks`, { method: "POST", body: JSON.stringify({ ...body, description: taskDescription.trim() }) });
    },
    onSuccess: async () => { setTaskTitle(""); setTaskDescription(""); setTaskAssignee(""); setTaskDueAt(""); setEditingTaskId(null); await refresh(); },
    onError: (error: Error) => setNotice(error.message),
  });
  const updateTask = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => fetchApi(`/admin/projects/${selectedId}/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: refresh,
    onError: (error: Error) => setNotice(error.message),
  });
  const deleteTask = useMutation({
    mutationFn: (id: string) => fetchApi(`/admin/projects/${selectedId}/tasks/${id}`, { method: "DELETE" }),
    onSuccess: async () => { setNotice(ui("Task removed.")); await refresh(); },
    onError: (error: Error) => setNotice(error.message),
  });
  const createField = useMutation({ mutationFn: () => fetchApi<ProjectField>("/admin/project-fields", { method: "POST", body: JSON.stringify({ key: fieldKey.trim().toLowerCase(), label: fieldLabel, type: fieldType, required: fieldRequired, options: fieldOptions.split(",").map((item) => item.trim()).filter(Boolean), sortOrder: bootstrap.data?.fields.length ?? 0 }) }), onSuccess: async () => { setFieldKey(""); setFieldLabel(""); setFieldOptions(""); setFieldRequired(false); await refresh(); }, onError: (error: Error) => setNotice(error.message) });
  const archiveField = useMutation({ mutationFn: (id: string) => fetchApi(`/admin/project-fields/${id}`, { method: "DELETE" }), onSuccess: refresh, onError: (error: Error) => setNotice(error.message) });

  const rows = useMemo(() => acceptedMembers.flatMap((participant) => (current?.budgets ?? []).map((budget) => ({ participant, budget, key: `${participant.memberId}:${budget.pointTypeId}` }))), [acceptedMembers, current?.budgets]);
  const allocationReview = useMemo(() => {
    const issues: Record<string, string> = {};
    const totals = new Map<string, number>();
    const allocations: { memberId: string; pointTypeId: string; mode: "AMOUNT" | "PERCENT"; value: number }[] = [];
    for (const row of rows) {
      const entry = allocationValues[row.key];
      if (!entry?.value.trim()) continue;
      const value = Number(entry.value);
      if (!Number.isFinite(value) || value <= 0) {
        issues[row.key] = ui("Enter a value greater than zero.");
        continue;
      }
      if (entry.mode === "AMOUNT" && !Number.isSafeInteger(value)) {
        issues[row.key] = ui("Point amounts must be whole numbers.");
        continue;
      }
      if (entry.mode === "PERCENT" && value > 100) {
        issues[row.key] = ui("Percentage cannot be greater than 100.");
        continue;
      }
      const amount = entry.mode === "PERCENT" ? Math.floor(row.budget.approvedAmount * value / 100) : value;
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        issues[row.key] = ui("This percentage rounds to zero points.");
        continue;
      }
      totals.set(row.budget.id, (totals.get(row.budget.id) ?? 0) + amount);
      allocations.push({ memberId: row.participant.memberId, pointTypeId: row.budget.pointTypeId, mode: entry.mode, value });
    }
    const budgets = (current?.budgets ?? []).map((budget) => {
      const amount = totals.get(budget.id) ?? 0;
      const overLimit = amount > budget.remainingAmount;
      return { budget, amount, overLimit };
    });
    return { issues, allocations, budgets, hasOverLimit: budgets.some((item) => item.overLimit) };
  }, [rows, allocationValues, current?.budgets]);
  const issue = useMutation({
    mutationFn: () => {
      if (!allocationReview.allocations.length) throw new Error(ui("Enter at least one member allocation."));
      if (Object.keys(allocationReview.issues).length || allocationReview.hasOverLimit) throw new Error(ui("Fix allocation values that exceed the available budget."));
      return fetchApi(`/admin/projects/${selectedId}/submit-issuance`, { method: "POST", body: JSON.stringify({ allocations: allocationReview.allocations }) });
    },
    onSuccess: async () => { setNotice(ui("Point distribution submitted for approval.")); setAllocationValues({}); await refresh(); },
    onError: (error: Error) => setNotice(error.message),
  });

  const selectProject = (id: string): void => { setNotice(null); setCreating(false); setSelectedId(id); };
  const startNewProject = (): void => { setNotice(null); setSelectedId(null); setCreating(true); };
  const resetTaskEditor = (): void => { setEditingTaskId(null); setTaskTitle(""); setTaskDescription(""); setTaskAssignee(""); setTaskDueAt(""); };
  const editTask = (task: Task): void => {
    setEditingTaskId(task.id);
    setTaskTitle(task.title);
    setTaskDescription(task.description ?? "");
    setTaskAssignee(task.assignee?.id ?? "");
    setTaskDueAt(dateInputValue(task.dueAt));
  };
  const toggleVisibleMembers = (): void => {
    setMemberIds((ids) => allVisibleSelected ? ids.filter((id) => !visibleMembers.some((member) => member.id === id)) : [...new Set([...ids, ...visibleMembers.map((member) => member.id)])]);
  };

  const renderPlanForm = (isNew: boolean): JSX.Element => (
    <Card>
      <CardHeader><CardTitle>{isNew ? ui("New project plan") : ui("Project plan")}</CardTitle><CardDescription>{ui("Describe the work and request point budget approval before inviting members.")}</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div><Label htmlFor="project-name">{ui("Project name")}</Label><Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} aria-invalid={!name.trim()} /></div>
        <div><Label htmlFor="project-description">{ui("Description")}</Label><Textarea id="project-description" className="min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} /></div>
        {(bootstrap.data?.fields ?? []).map((field) => <div key={field.id}>
          <Label htmlFor={`project-field-${field.key}`}>{field.label}{field.required ? " *" : ""}</Label>
          {field.type === "BOOLEAN" ? <label className="flex items-center gap-2 pt-2 text-sm"><input id={`project-field-${field.key}`} type="checkbox" checked={Boolean(fieldValues[field.key])} onChange={(event) => setFieldValues({ ...fieldValues, [field.key]: event.target.checked })} />{field.label}</label> : field.type === "SELECT" ? <select id={`project-field-${field.key}`} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={String(fieldValues[field.key] ?? "")} onChange={(event) => setFieldValues({ ...fieldValues, [field.key]: event.target.value })}><option value="">{ui("Select")}</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <Input id={`project-field-${field.key}`} type={field.type === "NUMBER" ? "number" : field.type === "DATE" ? "date" : "text"} value={String(fieldValues[field.key] ?? "")} onChange={(event) => setFieldValues({ ...fieldValues, [field.key]: field.type === "NUMBER" ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value })} />}
          {requiredFieldErrors[field.key] && <p className="mt-1 text-xs text-destructive">{requiredFieldErrors[field.key]}</p>}
        </div>)}
        <div className="space-y-3 rounded-md border p-4">
          <div><h3 className="font-semibold">{ui("Requested point budget")}</h3><p className="text-xs text-muted-foreground">{ui("Budget is reserved from the bank only after plan approval.")}</p></div>
          {(bootstrap.data?.pointTypes ?? []).map((type) => <div key={type.id} className="grid items-start gap-2 sm:grid-cols-[1fr_10rem]">
            <div><p className="text-sm font-medium">{type.code} · {type.name}</p>{type.bankBalance !== null && <p className="text-xs text-muted-foreground">{ui("Bank available")}: {type.bankBalance.toLocaleString()}</p>}</div>
            <div><Input type="number" min="1" step="1" placeholder={ui("No budget") as string} value={budgetValues[type.id] ?? ""} onChange={(event) => setBudgetValues({ ...budgetValues, [type.id]: event.target.value })} aria-invalid={Boolean(budgetValidation.errors[type.id])} /><p className="mt-1 min-h-4 text-xs text-destructive">{budgetValidation.errors[type.id] ?? " "}</p></div>
          </div>)}
          {budgetValidation.errors._form && <p className="text-sm text-destructive">{budgetValidation.errors._form}</p>}
        </div>
        <div className="flex flex-wrap gap-2"><Button onClick={() => savePlan.mutate({ submitForApproval: false })} disabled={savePlan.isPending}>{savePlan.isPending ? ui("Saving…") : ui("Save draft")}</Button><Button variant="outline" onClick={() => savePlan.mutate({ submitForApproval: true })} disabled={savePlan.isPending}>{ui("Save and submit for approval")}</Button>{!isNew && current?.status === "PLAN_REJECTED" && <Badge variant="outline">{ui("Rejected plan can be resubmitted")}</Badge>}</div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-5 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold">{ui("Group projects")}</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{ui("Manage project plans, member participation, delivery tasks, and approved point distributions.")}</p></div>
        <div className="flex flex-wrap gap-2">{canManageGlobally && <Button variant="outline" onClick={() => setFieldsOpen((open) => !open)}>{fieldsOpen ? ui("Hide project fields") : ui("Manage project fields")}</Button>}{canManageGlobally && <Button onClick={startNewProject}>{ui("New project")}</Button>}</div>
      </header>

      {notice && <div role="status" className="rounded-md border bg-muted p-3 text-sm">{notice}</div>}
      {bootstrap.isError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 p-3 text-sm"><span>{ui("Project permissions and planning options could not be loaded.")}</span><Button size="sm" variant="outline" onClick={() => void bootstrap.refetch()}>{ui("Retry")}</Button></div>}

      {fieldsOpen && canManageGlobally && <Card><CardHeader><CardTitle>{ui("Shared project fields")}</CardTitle><CardDescription>{ui("These admin-managed fields are available on every project plan.")}</CardDescription></CardHeader><CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4"><div><Label>{ui("Field key")}</Label><Input value={fieldKey} onChange={(event) => setFieldKey(event.target.value)} placeholder="project_code" /></div><div><Label>{ui("Label")}</Label><Input value={fieldLabel} onChange={(event) => setFieldLabel(event.target.value)} /></div><div><Label>{ui("Type")}</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={fieldType} onChange={(event) => setFieldType(event.target.value as ProjectField["type"])}>{(["TEXT", "NUMBER", "BOOLEAN", "DATE", "SELECT"] as const).map((type) => <option key={type} value={type}>{ui(projectFieldTypeLabels[type])}</option>)}</select></div><div><Label>{ui("Select options (comma-separated)")}</Label><Input value={fieldOptions} onChange={(event) => setFieldOptions(event.target.value)} disabled={fieldType !== "SELECT"} /></div></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fieldRequired} onChange={(event) => setFieldRequired(event.target.checked)} />{ui("Required")}</label>
        <Button onClick={() => createField.mutate()} disabled={!fieldKey.trim() || !fieldLabel.trim() || createField.isPending}>{ui("Add field")}</Button>
        <div className="space-y-2">{(bootstrap.data?.fields ?? []).map((field) => <div key={field.id} className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"><span>{field.label} · {ui(projectFieldTypeLabels[field.type])}{field.required ? ` · ${ui("Required")}` : ""}</span><Button size="sm" variant="ghost" onClick={() => archiveField.mutate(field.id)} disabled={archiveField.isPending}>{ui("Archive")}</Button></div>)}</div>
      </CardContent></Card>}

      <div className="grid gap-4 xl:grid-cols-[minmax(17rem,0.82fr)_minmax(0,1.8fr)]">
        <Card className="h-fit xl:sticky xl:top-4 xl:flex xl:max-h-[calc(100vh-2rem)] xl:flex-col">
          <CardHeader><div><CardTitle>{ui("Projects")}</CardTitle><CardDescription>{filteredProjects.length} {ui("shown")} · {(projects.data ?? []).length} {ui("total")}</CardDescription></div></CardHeader>
          <CardContent className="space-y-3 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden">
            <Input aria-label={ui("Search projects")} placeholder={ui("Search by project or manager") as string} value={search} onChange={(event) => setSearch(event.target.value)} />
            <select aria-label={ui("Filter by status")} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ProjectStatusFilter | "ALL")}><option value="ALL">{ui("All statuses")}</option>{statusOptions.map((status) => <option key={status} value={status}>{projectStatusLabel(status)}</option>)}</select>
            <div className="max-h-80 space-y-2 overflow-y-auto xl:max-h-[calc(100vh-20rem)] xl:min-h-0 xl:flex-1 xl:pr-1">
              {projects.isLoading && <p className="py-4 text-sm text-muted-foreground">{ui("Loading projects…")}</p>}
              {projects.isError && <div role="alert" className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm"><p>{ui("Projects could not be loaded.")}</p><Button size="sm" variant="outline" onClick={() => void projects.refetch()}>{ui("Retry")}</Button></div>}
              {!projects.isLoading && !projects.isError && filteredProjects.map((project) => <button type="button" key={project.id} onClick={() => selectProject(project.id)} className={`w-full rounded-md border p-3 text-left transition-colors ${project.id === selectedId && !creating ? "border-primary bg-primary/5" : "hover:bg-muted"}`}>
                <p className="break-words text-base font-semibold leading-snug">{project.name}</p>
                <div className="mt-1"><Badge variant="secondary" className="max-w-full whitespace-normal text-xs leading-tight">{projectStatusLabel(project.status)}</Badge></div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{project.description || ui("No description")}</p>
                <p className="mt-2 text-xs text-muted-foreground">{project._count?.members ?? 0} {ui("members")} · {project._count?.tasks ?? 0} {ui("tasks")}{project.createdBy?.name ? ` · ${ui("Manager")}: ${project.createdBy.name}` : ""}</p>
              </button>)}
              {!projects.isLoading && !projects.isError && !filteredProjects.length && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{projects.data?.length ? ui("No projects match these filters.") : ui("No projects yet. Create a plan to get started.")}</p>}
            </div>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {creating && renderPlanForm(true)}
          {!creating && !selectedId && <Card><CardContent className="p-8 text-sm text-muted-foreground">{projects.isLoading || bootstrap.isLoading ? ui("Loading projects…") : ui("Select a project to open its workspace.")}</CardContent></Card>}
          {selectedId && detail.isLoading && !current && <Card><CardContent className="p-8 text-sm text-muted-foreground">{ui("Loading project workspace…")}</CardContent></Card>}
          {selectedId && detail.isError && !current && <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-6"><p role="alert" className="text-sm">{ui("Project details could not be loaded.")}</p><Button variant="outline" onClick={() => void detail.refetch()}>{ui("Retry")}</Button></CardContent></Card>}
          {selectedId && current && <>
            {detail.isError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 p-3 text-sm"><span>{ui("Project details may be out of date.")}</span><Button size="sm" variant="outline" onClick={() => void detail.refetch()}>{ui("Retry")}</Button></div>}
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-card p-4">
              <div><div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-2xl font-semibold">{current.name}</h2><Badge variant="secondary">{projectStatusLabel(current.status)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{ui("Manager")}: {current.createdBy?.name ?? ui("Unknown")}</p></div>
              {current.canManage && current.status === "DRAFT" && <Button variant="outline" onClick={() => setWorkspaceTab("overview")}>{ui("Edit plan")}</Button>}
              {current.canManage && current.status === "PLAN_REJECTED" && <Button variant="outline" onClick={() => setWorkspaceTab("overview")}>{ui("Revise rejected plan")}</Button>}
            </div>
            <Card className="border-primary/20 bg-primary/[0.025]"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ui("Next action")}</p><p className="mt-1 text-sm">{nextActionFor(current, openTaskCount)}</p></div>
              {current.canManage && current.status === "APPROVED" && <Button onClick={() => callProject.mutate({ action: "activate" })} disabled={callProject.isPending}>{callProject.isPending ? ui("Updating…") : ui("Activate project")}</Button>}
              {current.canManage && current.status === "ACTIVE" && <div className="text-right"><Button variant="outline" onClick={() => { if (window.confirm(ui("Confirm the project is complete? This locks task updates and opens point distribution."))) callProject.mutate({ action: "complete" }); }} disabled={callProject.isPending || openTaskCount > 0}>{callProject.isPending ? ui("Updating…") : ui("Confirm project complete")}</Button>{openTaskCount > 0 && <p className="mt-1 text-xs text-muted-foreground">{openTaskCount} {ui("open task(s) must be finished first")}</p>}</div>}
              {current.canManage && ["COMPLETED", "ISSUED", "ISSUE_REJECTED"].includes(current.status) && <div className="flex flex-wrap gap-2">
                {canViewBudget && ["COMPLETED", "ISSUE_REJECTED"].includes(current.status) && <Button onClick={() => setWorkspaceTab("budget")}>{ui("Budget & distribution")}</Button>}
                <Button variant="outline" onClick={() => { if (window.confirm(ui("Close this project and return all unused point budget to the bank? This cannot be undone."))) callProject.mutate({ action: "close" }); }} disabled={callProject.isPending}>{callProject.isPending ? ui("Updating…") : ui("Close project")}</Button>
              </div>}
            </CardContent></Card>

            <Tabs value={workspaceTab} onValueChange={(value) => setWorkspaceTab(value as WorkspaceTab)} className="space-y-4">
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1 md:flex md:flex-wrap">
                <TabsTrigger value="overview">{ui("Overview")}</TabsTrigger>
                <TabsTrigger value="members">{ui("Members")}</TabsTrigger>
                <TabsTrigger value="tasks">{ui("Tasks")}</TabsTrigger>
                {canViewBudget && <TabsTrigger value="budget">{ui("Budget & distribution")}</TabsTrigger>}
                <TabsTrigger value="history">{ui("History")}</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="space-y-4">
                {editable ? renderPlanForm(false) : <Card><CardHeader><CardTitle>{ui("Project progress")}</CardTitle><CardDescription>{nextActionFor(current, openTaskCount)}</CardDescription></CardHeader><CardContent className="space-y-4">
                  <ol className="grid gap-2 sm:grid-cols-5">{[ui("Plan"), ui("Activate"), ui("Deliver"), ui("Distribute"), ui("Close")].map((label, index) => { const stage = stageForStatus(current.status); return <li key={label} className={`rounded-md border p-3 text-xs ${index === stage.index ? "border-primary bg-primary/5 font-semibold" : index < stage.index ? "bg-muted/50 text-muted-foreground" : "text-muted-foreground"}`}><span className="mr-2">{index < stage.index ? "✓" : index + 1}</span>{label}</li>; })}</ol>
                  <p className="text-sm">{current.description || ui("No description")}</p>
                  {Object.entries(current.fieldValues ?? {}).length > 0 && <div className="grid gap-2 border-t pt-3 sm:grid-cols-2">{Object.entries(current.fieldValues).map(([key, value]) => <p key={key} className="text-sm"><span className="text-muted-foreground">{bootstrap.data?.fields.find((field) => field.key === key)?.label ?? key}:</span> {String(value)}</p>)}</div>}
                  <div className="grid gap-3 border-t pt-3 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">{ui("Members")}</p><p className="text-lg font-semibold">{current.members?.length ?? current._count?.members ?? 0}</p></div><div><p className="text-xs text-muted-foreground">{ui("Tasks complete")}</p><p className="text-lg font-semibold">{currentTasks.filter((task) => task.status === "DONE").length} / {currentTasks.length}</p></div><div><p className="text-xs text-muted-foreground">{ui("Last updated")}</p><p className="text-sm font-medium">{new Date(current.updatedAt).toLocaleString()}</p></div></div>
                </CardContent></Card>}
                {canViewBudget && current.status === "PLAN_REJECTED" && current.approvalSummary?.plan?.comment && <Card className="border-destructive/30"><CardHeader><CardTitle>{ui("Plan rejection feedback")}</CardTitle></CardHeader><CardContent><p className="text-sm">{current.approvalSummary.plan.comment}</p></CardContent></Card>}
                {canViewBudget && current.status === "ISSUE_REJECTED" && current.approvalSummary?.distribution?.comment && <Card className="border-destructive/30"><CardHeader><CardTitle>{ui("Distribution rejection feedback")}</CardTitle></CardHeader><CardContent><p className="text-sm">{current.approvalSummary.distribution.comment}</p></CardContent></Card>}
              </TabsContent>

              <TabsContent value="members">
                <Card><CardHeader><CardTitle>{ui("Project members")}</CardTitle><CardDescription>{ui("Invitation status and participation for this project.")}</CardDescription></CardHeader><CardContent className="space-y-4">
                  {current.canManage && current.status === "ACTIVE" && <section className="space-y-3 rounded-md border p-4">
                    <div><h3 className="font-semibold">{ui("Invite members")}</h3><p className="text-xs text-muted-foreground">{ui("Search active members, select the people to invite, and send invitations together.")}</p></div>
                    <Input aria-label={ui("Search members")} placeholder={ui("Search by name, email, or department") as string} value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} />
                    <div className="flex flex-wrap items-center justify-between gap-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleMembers} disabled={!visibleMembers.length} />{allVisibleSelected ? ui("Clear visible selection") : ui("Select visible members")}</label><span className="text-xs text-muted-foreground">{memberIds.length} {ui("selected")}</span></div>
                    <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">{visibleMembers.map((member) => <label key={member.id} className="flex cursor-pointer items-start gap-3 rounded px-2 py-2 text-sm hover:bg-muted"><input className="mt-1" type="checkbox" checked={memberIds.includes(member.id)} onChange={(event) => setMemberIds((ids) => event.target.checked ? [...new Set([...ids, member.id])] : ids.filter((id) => id !== member.id))} /><span><span className="font-medium">{personName(member)}</span><span className="block text-xs text-muted-foreground">{member.email ?? "—"}{member.department ? ` · ${member.department}` : ""}</span></span></label>)}{!visibleMembers.length && <p className="p-3 text-sm text-muted-foreground">{availableMembers.length ? ui("No members match this search.") : ui("Everyone available has already been invited or joined.")}</p>}</div>
                    <Button onClick={() => invite.mutate()} disabled={!memberIds.length || invite.isPending}>{invite.isPending ? ui("Sending invitations…") : `${ui("Send invitations")} (${memberIds.length})`}</Button>
                  </section>}
                  <div className="space-y-2">{(current.members ?? []).map((participant) => <div key={participant.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"><div><p className="font-medium">{personName(participant.member)}</p><p className="text-xs text-muted-foreground">{participant.member.email ?? "—"}{participant.member.department ? ` · ${participant.member.department}` : ""}</p></div><Badge variant={participant.status === "ACCEPTED" ? "secondary" : "outline"}>{membershipStatusLabel(participant.status)}</Badge></div>)}{!current.members?.length && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{current.status === "ACTIVE" ? ui("No one has been invited yet.") : ui("Members can be invited after the project is activated.")}</p>}</div>
                </CardContent></Card>
              </TabsContent>

              <TabsContent value="tasks">
                <Card><CardHeader><CardTitle>{ui("Project tasks")}</CardTitle><CardDescription>{ui("Track owners, due dates, and delivery progress. Tasks stay visible after the project is completed.")}</CardDescription></CardHeader><CardContent className="space-y-4">
                  {current.canManage && current.status === "ACTIVE" && <section className="space-y-3 rounded-md border p-4">
                    <h3 className="font-semibold">{editingTaskId ? ui("Edit task") : ui("Add task")}</h3>
                    <div className="grid gap-3 md:grid-cols-2"><div><Label htmlFor="task-title">{ui("Task title")}</Label><Input id="task-title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></div><div><Label htmlFor="task-assignee">{ui("Assignee")}</Label><select id="task-assignee" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={taskAssignee} onChange={(event) => setTaskAssignee(event.target.value)}><option value="">{ui("Unassigned")}</option>{acceptedMembers.map(({ member }) => <option key={member.id} value={member.id}>{personName(member)}</option>)}</select></div><div><Label htmlFor="task-due-date">{ui("Due date")}</Label><Input id="task-due-date" type="date" value={taskDueAt} onChange={(event) => setTaskDueAt(event.target.value)} /></div><div><Label htmlFor="task-description">{ui("Description")}</Label><Input id="task-description" value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} /></div></div>
                    <div className="flex flex-wrap gap-2"><Button onClick={() => saveTask.mutate()} disabled={!taskTitle.trim() || saveTask.isPending}>{saveTask.isPending ? ui("Saving…") : editingTaskId ? ui("Save task") : ui("Add task")}</Button>{editingTaskId && <Button variant="ghost" onClick={resetTaskEditor} disabled={saveTask.isPending}>{ui("Cancel edit")}</Button>}</div>
                  </section>}
                  {current.status === "ACTIVE" && openTaskCount > 0 && <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">{openTaskCount} {ui("open task(s) must be finished before completion.")}</div>}
                  <div className="space-y-2">{currentTasks.map((task) => <div key={task.id} className="rounded-md border p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium">{task.title}</p>{task.description && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>}<p className="mt-2 text-xs text-muted-foreground">{task.assignee ? personName(task.assignee) : ui("Unassigned")}{task.dueAt ? ` · ${ui("Due")} ${dateLabel(task.dueAt)}` : ` · ${ui("No due date")}`}</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant={task.status === "DONE" ? "secondary" : "outline"}>{ui(task.status === "TODO" ? "To do" : task.status === "IN_PROGRESS" ? "In progress" : "Done")}</Badge>{current.canManage && current.status === "ACTIVE" && <><select aria-label={`${ui("Task status")}: ${task.title}`} className="h-9 rounded-md border bg-background px-2 text-sm" value={task.status} disabled={updateTask.isPending || saveTask.isPending || deleteTask.isPending} onChange={(event) => updateTask.mutate({ id: task.id, body: { status: event.target.value } })}><option value="TODO">{ui("To do")}</option><option value="IN_PROGRESS">{ui("In progress")}</option><option value="DONE">{ui("Done")}</option></select><Button size="sm" variant="outline" onClick={() => editTask(task)} disabled={updateTask.isPending || saveTask.isPending || deleteTask.isPending}>{ui("Edit")}</Button><Button size="sm" variant="ghost" onClick={() => { if (window.confirm(ui("Remove this task from the project?"))) deleteTask.mutate(task.id); }} disabled={deleteTask.isPending || updateTask.isPending || saveTask.isPending}>{ui("Remove")}</Button></>}</div></div></div>)}
                    {!currentTasks.length && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{ui("No tasks have been added yet.")}</p>}
                  </div>
                </CardContent></Card>
              </TabsContent>

              {canViewBudget && <TabsContent value="budget" className="space-y-4">
                <Card><CardHeader><CardTitle>{ui("Project budget")}</CardTitle><CardDescription>{ui("Approved balances and point distributions are visible only to project finance viewers.")}</CardDescription></CardHeader><CardContent className="space-y-2">
                  {(current.budgets ?? []).map((budget) => <div key={budget.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_repeat(3,minmax(6rem,auto))] sm:items-center"><div><p className="font-medium">{budget.pointType.code} · {budget.pointType.name}</p><p className="text-xs text-muted-foreground">{ui("Requested")}: {budget.requestedAmount.toLocaleString()}</p></div><p className="text-sm"><span className="text-muted-foreground">{ui("Approved")}: </span>{budget.approvedAmount.toLocaleString()}</p><p className="text-sm"><span className="text-muted-foreground">{ui("Remaining")}: </span>{budget.remainingAmount.toLocaleString()}</p><p className="text-sm"><span className="text-muted-foreground">{ui("Issued")}: </span>{budget.issuedAmount.toLocaleString()}</p></div>)}
                  {!current.budgets?.length && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{ui("No budget has been requested for this project.")}</p>}
                </CardContent></Card>
                {current.canManage && ["COMPLETED", "ISSUE_REJECTED"].includes(current.status) && <Card><CardHeader><CardTitle>{ui("Member point distribution")}</CardTitle><CardDescription>{ui("Enter points or a percentage of each point type’s approved budget. Review the total against the remaining balance before submitting for approval.")}</CardDescription></CardHeader><CardContent className="space-y-4">
                  {rows.length ? <div className="space-y-2">{rows.map((row) => { const entry = allocationValues[row.key] ?? { mode: "AMOUNT" as const, value: "" }; return <div key={row.key} className="grid items-start gap-2 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_8rem_10rem]"><div className="text-sm"><p className="font-medium">{personName(row.participant.member)} · {row.budget.pointType.code}</p><p className="text-xs text-muted-foreground">{ui("Available")}: {row.budget.remainingAmount.toLocaleString()}</p></div><select aria-label={`${ui("Allocation mode")}: ${personName(row.participant.member)} ${row.budget.pointType.code}`} className="h-10 rounded-md border bg-background px-2 text-sm" value={entry.mode} onChange={(event) => setAllocationValues({ ...allocationValues, [row.key]: { ...entry, mode: event.target.value as AllocationEntry["mode"] } })}><option value="AMOUNT">{ui("Points")}</option><option value="PERCENT">{ui("Percent")}</option></select><div><Input aria-label={`${ui("Allocation value")}: ${personName(row.participant.member)} ${row.budget.pointType.code}`} type="number" min="0" step={entry.mode === "AMOUNT" ? "1" : "0.01"} max={entry.mode === "PERCENT" ? "100" : undefined} value={entry.value} onChange={(event) => setAllocationValues({ ...allocationValues, [row.key]: { ...entry, value: event.target.value } })} aria-invalid={Boolean(allocationReview.issues[row.key])} /><p className="mt-1 min-h-4 text-xs text-destructive">{allocationReview.issues[row.key] ?? " "}</p></div></div>; })}</div> : <p className="text-sm text-muted-foreground">{ui("Only accepted members can receive project points.")}</p>}
                  <div className="space-y-2 rounded-md bg-muted/40 p-3">{allocationReview.budgets.map(({ budget, amount, overLimit }) => <div key={budget.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{budget.pointType.code} · {ui("Allocation total")}</span><span className={overLimit ? "font-semibold text-destructive" : "font-medium"}>{amount.toLocaleString()} / {budget.remainingAmount.toLocaleString()} {ui("remaining")}{overLimit ? ` · ${ui("Over limit")}` : ""}</span></div>)}</div>
                  {current.approvalSummary?.distribution?.comment && current.status === "ISSUE_REJECTED" && <div className="rounded-md border border-destructive/30 p-3"><p className="text-xs font-semibold">{ui("Latest rejection feedback")}</p><p className="mt-1 text-sm">{current.approvalSummary.distribution.comment}</p></div>}
                  <Button onClick={() => issue.mutate()} disabled={!rows.length || !allocationReview.allocations.length || Object.keys(allocationReview.issues).length > 0 || allocationReview.hasOverLimit || issue.isPending}>{issue.isPending ? ui("Submitting…") : ui("Submit point distribution for approval")}</Button>
                </CardContent></Card>}
                {(current.issueBatches ?? []).length > 0 && <Card><CardHeader><CardTitle>{ui("Distribution batches")}</CardTitle></CardHeader><CardContent className="space-y-3">{(current.issueBatches ?? []).map((batch) => <section key={batch.id} className="rounded-md border p-3"><div className="flex items-center justify-between gap-3"><p className="font-semibold">{ui("Distribution batch")}</p><Badge variant="outline">{humanizeEnum(batch.status)}</Badge></div><div className="mt-2 space-y-1 text-sm">{batch.allocations.map((allocation) => <p key={allocation.id}>{personName(allocation.member)} · {allocation.pointType.code} · {allocation.amount.toLocaleString()}</p>)}</div></section>)}</CardContent></Card>}
              </TabsContent>}

              <TabsContent value="history" className="space-y-4">
                <Card><CardHeader><CardTitle>{ui("Approval history")}</CardTitle><CardDescription>{ui("Review the latest plan and distribution decisions for this project.")}</CardDescription></CardHeader><CardContent className="space-y-3">
                  {!canViewBudget ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{ui("Approval details are restricted to project finance viewers.")}</p> : ([ [ui("Project plan"), current.approvalSummary?.plan ?? null], [ui("Point distribution"), current.approvalSummary?.distribution ?? null] ] as const).map(([label, approval]) => <div key={label} className="rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{label}</p><Badge variant="outline">{approval ? humanizeEnum(approval.status) : ui("Not submitted")}</Badge></div>{approval && <><p className="mt-1 text-xs text-muted-foreground">{ui("Requested")}: {new Date(approval.requestedAt).toLocaleString()}{approval.resolvedAt ? ` · ${ui("Resolved")}: ${new Date(approval.resolvedAt).toLocaleString()}` : ""}</p>{approval.decision && <p className="mt-1 text-sm">{ui("Decision")}: {humanizeEnum(approval.decision)}</p>}{approval.comment && <p className="mt-2 rounded bg-muted/50 p-2 text-sm">{approval.comment}</p>}</>}</div>)}
                </CardContent></Card>
                {canViewBudget && (current.budgetTransactions ?? []).length > 0 && <Card><CardHeader><CardTitle>{ui("Project budget history")}</CardTitle></CardHeader><CardContent className="space-y-2">{(current.budgetTransactions ?? []).map((item) => <p key={item.id} className="rounded border p-2 text-sm">{item.createdAt ? new Date(item.createdAt).toLocaleString() : ""} · {item.pointType.code} · {ui(item.type)} · {item.amount.toLocaleString()} · {item.reason}</p>)}</CardContent></Card>}
              </TabsContent>
            </Tabs>
          </>}
        </div>
      </div>
    </div>
  );
}
