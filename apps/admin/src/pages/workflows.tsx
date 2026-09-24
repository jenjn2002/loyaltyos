import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Save, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { type ChangeEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fetchApi } from "@/lib/api-client";

interface AssignmentDraft { value: string }
interface StepDraft {
  name: string;
  approvalMode: "ANY" | "ALL" | "COUNT";
  requiredApprovalCount: number;
  assignees: AssignmentDraft[];
}
interface WorkflowDraft {
  actionKey: string;
  name: string;
  description: string;
  priority: number;
  scope: WorkflowScope;
  customScopeJson: string;
  selfApprovalPolicy: "DENY" | "ALLOW";
  isActive: boolean;
  steps: StepDraft[];
}
interface WorkflowScope {
  pointTypeIds?: string[];
  minAmount?: number;
  maxAmount?: number;
  minValueMinor?: number;
  maxValueMinor?: number;
  rewardIds?: string[];
  rewardCategories?: string[];
  [key: string]: unknown;
}
type Workflow = Omit<WorkflowDraft, "steps"> & {
  id: string;
  createdBy?: { id: string; name: string; email: string | null } | null;
  steps: (Omit<StepDraft, "assignees"> & {
    id: string;
    stepOrder: number;
    assignees: { adminUserId: string | null; role: string | null }[];
  })[];
};
interface ApproverData {
  users: { id: string; name: string; email: string; role: string }[];
  roles: { value: string; label: string }[];
}
interface ScopeCatalog {
  pointTypes: { id: string; code: string; name: string; isActive: boolean; archivedAt: string | null }[];
  rewards: { id: string; name: string; category: string | null }[];
}

const actionGroups = [
  {
    label: "Point operations",
    options: [
      { value: "POINT_EXCHANGE", description: "Point exchange approvals" },
      { value: "POINT_ISSUANCE_PROPOSAL", description: "Manual point issuance approvals" },
    ],
  },
  {
    label: "Campaign operations",
    options: [
      { value: "CAMPAIGN_ISSUANCE_PROPOSAL", description: "Campaign issuance approvals" },
    ],
  },
  {
    label: "Reward operations",
    options: [
      { value: "REWARD_REDEMPTION", description: "Reward redemption approvals" },
    ],
  },
];

const actionOptions = actionGroups.flatMap((group) => group.options.map((option) => option.value));

function blankStep(): StepDraft {
  return {
    name: "",
    approvalMode: "ANY",
    requiredApprovalCount: 1,
    assignees: [{ value: "" }],
  };
}

function blankDraft(): WorkflowDraft {
  return {
    actionKey: "POINT_EXCHANGE",
    name: "",
    description: "",
    priority: 0,
    scope: {},
    customScopeJson: "{}",
    selfApprovalPolicy: "DENY",
    isActive: false,
    steps: [blankStep()],
  };
}

function scopeDraft(scope: WorkflowScope | null | undefined): Pick<WorkflowDraft, "scope" | "customScopeJson"> {
  const normalized = scope ?? {};
  return { scope: normalized, customScopeJson: JSON.stringify(normalized, null, 2) };
}

function selectedValues(event: ChangeEvent<HTMLSelectElement>): string[] {
  return Array.from(event.target.selectedOptions, (option) => option.value);
}

function numericScopeValue(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function builtInScope(actionKey: string, scope: WorkflowScope): WorkflowScope {
  const keys = ["POINT_EXCHANGE", "POINT_ISSUANCE_PROPOSAL", "CAMPAIGN_ISSUANCE_PROPOSAL"].includes(actionKey)
    ? ["pointTypeIds", "minAmount", "maxAmount", "minValueMinor", "maxValueMinor"]
    : ["rewardIds", "rewardCategories"];
  const result: WorkflowScope = {};
  for (const key of keys) {
    if (scope[key] !== undefined) result[key] = scope[key];
  }
  return result;
}

function assignmentValue(assignee: { adminUserId: string | null; role: string | null }): string {
  return assignee.adminUserId ? `user:${assignee.adminUserId}` : assignee.role ? `role:${assignee.role}` : "";
}

export function WorkflowsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft>(blankDraft);
  const [notice, setNotice] = useState<string | null>(null);

  const workflows = useQuery({
    queryKey: ["admin", "workflows"],
    queryFn: () => fetchApi<Workflow[]>('/admin/workflows'),
  });
  const approvers = useQuery({
    queryKey: ["admin", "workflow-approvers"],
    queryFn: () => fetchApi<ApproverData>("/admin/workflow-approvers"),
  });
  const detail = useQuery({
    queryKey: ["admin", "workflow", editingId],
    queryFn: () => fetchApi<Workflow>(`/admin/workflows/${editingId ?? ""}`),
    enabled: Boolean(editingId),
  });
  const scopeCatalog = useQuery({
    queryKey: ["admin", "workflow-scope-catalog"],
    queryFn: () => fetchApi<ScopeCatalog>("/admin/workflow-scope-options"),
  });

  useEffect(() => {
    if (!editingId || !detail.data || detail.data.id !== editingId) return;
    setDraft({
      actionKey: detail.data.actionKey,
      name: detail.data.name,
      description: detail.data.description,
      priority: detail.data.priority,
      ...scopeDraft(detail.data.scope),
      selfApprovalPolicy: detail.data.selfApprovalPolicy,
      isActive: detail.data.isActive,
      steps: detail.data.steps.map((step) => ({
        name: step.name,
        approvalMode: step.approvalMode,
        requiredApprovalCount: step.requiredApprovalCount,
        assignees: step.assignees.map((assignee) => ({ value: assignmentValue(assignee) })),
      })),
    });
  }, [detail.data, editingId]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...draft,
        actionKey: draft.actionKey.trim().toUpperCase(),
        scope:
          draft.actionKey.trim().toUpperCase() === "CUSTOM"
            ? (JSON.parse(draft.customScopeJson) as WorkflowScope)
            : builtInScope(draft.actionKey.trim().toUpperCase(), draft.scope),
        steps: draft.steps.map((step) => ({
          ...step,
          requiredApprovalCount: step.approvalMode === "ALL" ? 1 : step.requiredApprovalCount,
          assignees: step.assignees.map((assignee) => {
            if (assignee.value.startsWith("user:")) return { adminUserId: assignee.value.slice(5) };
            return { role: assignee.value.slice(5) };
          }),
        })),
      };
      return fetchApi<Workflow>(editingId ? `/admin/workflows/${editingId}` : "/admin/workflows", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async (workflow) => {
      setEditingId(workflow.id);
      setNotice("Workflow saved. Existing requests keep their original snapshot.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "workflows"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "workflow", workflow.id] });
    },
    onError: (error: Error) => { setNotice(error.message); },
  });
  const activate = useMutation({
    mutationFn: (isActive: boolean) =>
      fetchApi<Workflow>(`/admin/workflows/${editingId ?? ""}/activate`, {
        method: "POST",
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: async (workflow) => {
      setDraft((current) => ({ ...current, isActive: workflow.isActive }));
      setNotice(workflow.isActive ? "Workflow activated." : "Workflow deactivated.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "workflows"] });
    },
    onError: (error: Error) => { setNotice(error.message); },
  });
  const remove = useMutation({
    mutationFn: () => fetchApi<unknown>(`/admin/workflows/${editingId ?? ""}`, { method: "DELETE" }),
    onSuccess: async () => {
      setEditingId(null);
      setDraft(blankDraft());
      setNotice("Workflow deleted.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "workflows"] });
    },
    onError: (error: Error) => { setNotice(error.message); },
  });

  function updateStep(index: number, update: Partial<StepDraft>): void {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => (stepIndex === index ? { ...step, ...update } : step)),
    }));
  }

  function moveStep(index: number, direction: -1 | 1): void {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      const currentStep = steps[index];
      const targetStep = steps[target];
      if (!currentStep || !targetStep) return current;
      steps[index] = targetStep;
      steps[target] = currentStep;
      return { ...current, steps };
    });
  }

  function updateScope(key: string, value: unknown): void {
    setDraft((current) => {
      const scope = { ...current.scope };
      if (value === undefined || (Array.isArray(value) && value.length === 0)) {
        const withoutKey: WorkflowScope = {};
        for (const [scopeKey, scopeValue] of Object.entries(scope)) {
          if (scopeKey !== key) withoutKey[scopeKey] = scopeValue;
        }
        return { ...current, scope: withoutKey };
      }
      scope[key] = value;
      return { ...current, scope };
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold"><WorkflowIcon />{ui("Approval workflows")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{ui("Configure ordered approval layers per program and action. Requests snapshot assignees at creation time.")}</p>
        </div>
        <Button onClick={() => { setEditingId(null); setDraft(blankDraft()); setNotice(null); }}>
          <Plus className="mr-2 h-4 w-4" />{ui("New workflow")}</Button>
      </div>
      {notice && <div role="status" className="rounded-md border bg-muted p-3 text-sm">{notice}</div>}
      <div className="grid gap-6 xl:grid-cols-[minmax(16rem,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader><CardTitle>{ui("Configured workflows")}</CardTitle><CardDescription>{ui("Multiple definitions per action are allowed; priority and scope select the match.")}</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {workflows.isLoading && <p className="text-sm text-muted-foreground">{ui("Loading workflows…")}</p>}
            {(workflows.data ?? []).map((workflow) => (
              <button
                type="button"
                key={workflow.id}
                className={`w-full rounded-md border p-3 text-left ${editingId === workflow.id ? "border-primary bg-accent" : ""}`}
                onClick={() => { setEditingId(workflow.id); }}
              >
                <p className="font-medium">{workflow.name}</p>
                <p className="text-xs text-muted-foreground">{workflow.actionKey} · {workflow.steps.length} layer(s)</p>
                <p className="mt-1 text-xs">{workflow.isActive ? ui("Active") : ui("Inactive")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{ui("Created by")}: {workflow.createdBy ? `${workflow.createdBy.name}${workflow.createdBy.email ? ` · ${workflow.createdBy.email}` : ""}` : ui("System / legacy")}</p>
              </button>
            ))}
            {!workflows.isLoading && !(workflows.data ?? []).length && <p className="text-sm text-muted-foreground">{ui("No workflows yet.")}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{editingId ? ui("Edit workflow") : ui("Create workflow")}</CardTitle>
            <CardDescription>{ui("Save inactive while building, then activate after all layers have valid active assignees.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="workflow-action" data-help={ui("Unique program-scoped trigger key used by modules to select this workflow.")}>{ui("Action key")}</Label>
                <select
                  id="workflow-action"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={draft.actionKey}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, actionKey: event.target.value }));
                  }}
                >
                  {(!actionOptions.includes(draft.actionKey) && draft.actionKey) && (
                    <option value={draft.actionKey}>{draft.actionKey}</option>
                  )}
                  {actionGroups.map((group) => (
                    <optgroup key={group.label} label={ui(group.label)}>
                      {group.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.value} — {ui(option.description)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ui("Only actions currently connected to an approval flow are listed here. Create, update and delete actions will be added when their approval handlers are connected.")}
                </p>
              </div>
              <div>
                <Label htmlFor="workflow-name" data-help={ui("Human-readable name shown to administrators in configuration and approval history.")}>{ui("Name")}</Label>
                <Input id="workflow-name" value={draft.name} onChange={(event) => { setDraft((current) => ({ ...current, name: event.target.value })); }} />
              </div>
            </div>
            <div>
              <Label htmlFor="workflow-description" data-help={ui("Optional business explanation; it is copied into the workflow definition, not the request snapshot payload.")}>{ui("Description")}</Label>
              <textarea id="workflow-description" className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={draft.description} onChange={(event) => { setDraft((current) => ({ ...current, description: event.target.value })); }} />
            </div>
            <div>
              <Label htmlFor="workflow-priority" data-help={ui("Higher priority wins when more than one active workflow matches the same action and scope. Equal-priority overlapping scopes are rejected.")}>{ui("Priority")}</Label>
              <Input id="workflow-priority" type="number" step={1} value={draft.priority} onChange={(event) => { setDraft((current) => ({ ...current, priority: Number(event.target.value) })); }} />
            </div>
            {draft.actionKey === "POINT_EXCHANGE" && <div className="space-y-3 rounded-md border bg-muted/20 p-4"><div><h3 className="font-semibold">{ui("Point exchange scope")}</h3><p className="text-xs text-muted-foreground">{ui("Empty point type selection matches all active point types. Amount and value limits are inclusive.")}</p></div><div><Label htmlFor="workflow-point-types" data-help={ui("Select point types for this workflow. Leave empty to match every point type.")}>{ui("Point types")}</Label><select id="workflow-point-types" multiple size={4} className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm" value={draft.scope.pointTypeIds ?? []} onChange={(event) => { updateScope("pointTypeIds", selectedValues(event)); }}>{(scopeCatalog.data?.pointTypes ?? []).map((pointType) => <option key={pointType.id} value={pointType.id}>{pointType.code} · {pointType.name}</option>)}</select></div><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="workflow-min-amount" data-help={ui("Minimum source point amount required for a match.")}>{ui("Minimum amount")}</Label><Input id="workflow-min-amount" type="number" min={0} value={draft.scope.minAmount ?? ""} onChange={(event) => { updateScope("minAmount", numericScopeValue(event.target.value)); }} /></div><div><Label htmlFor="workflow-max-amount" data-help={ui("Maximum source point amount allowed for a match.")}>{ui("Maximum amount")}</Label><Input id="workflow-max-amount" type="number" min={0} value={draft.scope.maxAmount ?? ""} onChange={(event) => { updateScope("maxAmount", numericScopeValue(event.target.value)); }} /></div><div><Label htmlFor="workflow-min-value" data-help={ui("Minimum exchange value in minor currency units, such as cents.")}>{ui("Minimum value (minor units)")}</Label><Input id="workflow-min-value" type="number" min={0} value={draft.scope.minValueMinor ?? ""} onChange={(event) => { updateScope("minValueMinor", numericScopeValue(event.target.value)); }} /></div><div><Label htmlFor="workflow-max-value" data-help={ui("Maximum exchange value in minor currency units, such as cents.")}>{ui("Maximum value (minor units)")}</Label><Input id="workflow-max-value" type="number" min={0} value={draft.scope.maxValueMinor ?? ""} onChange={(event) => { updateScope("maxValueMinor", numericScopeValue(event.target.value)); }} /></div></div></div>}
            {(draft.actionKey === "POINT_ISSUANCE_PROPOSAL" || draft.actionKey === "CAMPAIGN_ISSUANCE_PROPOSAL") && <div className="space-y-3 rounded-md border bg-muted/20 p-4"><div><h3 className="font-semibold">{ui(draft.actionKey === "CAMPAIGN_ISSUANCE_PROPOSAL" ? "Campaign issuance proposal scope" : "Point issuance proposal scope")}</h3><p className="text-xs text-muted-foreground">{ui(draft.actionKey === "CAMPAIGN_ISSUANCE_PROPOSAL" ? "Match campaign-level proposals for exceptional events; the campaign remains inactive until approved." : "Leave point types and amount limits empty to match every manual member grant proposal.")}</p></div><div><Label htmlFor="workflow-issuance-point-types">{ui("Point types")}</Label><select id="workflow-issuance-point-types" multiple size={4} className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm" value={draft.scope.pointTypeIds ?? []} onChange={(event) => { updateScope("pointTypeIds", selectedValues(event)); }}>{(scopeCatalog.data?.pointTypes ?? []).map((pointType) => <option key={pointType.id} value={pointType.id}>{pointType.code} · {pointType.name}</option>)}</select></div><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="workflow-issuance-min-amount">{ui("Minimum amount")}</Label><Input id="workflow-issuance-min-amount" type="number" min={0} value={draft.scope.minAmount ?? ""} onChange={(event) => { updateScope("minAmount", numericScopeValue(event.target.value)); }} /></div><div><Label htmlFor="workflow-issuance-max-amount">{ui("Maximum amount")}</Label><Input id="workflow-issuance-max-amount" type="number" min={0} value={draft.scope.maxAmount ?? ""} onChange={(event) => { updateScope("maxAmount", numericScopeValue(event.target.value)); }} /></div></div></div>}
            {draft.actionKey === "REWARD_REDEMPTION" && <div className="space-y-3 rounded-md border bg-muted/20 p-4"><div><h3 className="font-semibold">{ui("Reward redemption scope")}</h3><p className="text-xs text-muted-foreground">{ui("Empty reward or category selections match all rewards. Categories come from the reward’s current category field.")}</p></div><div><Label htmlFor="workflow-rewards" data-help={ui("Select individual rewards for this workflow. Leave empty to match every reward.")}>{ui("Rewards")}</Label><select id="workflow-rewards" multiple size={4} className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm" value={draft.scope.rewardIds ?? []} onChange={(event) => { updateScope("rewardIds", selectedValues(event)); }}>{(scopeCatalog.data?.rewards ?? []).map((reward) => <option key={reward.id} value={reward.id}>{reward.name}</option>)}</select></div><div><Label htmlFor="workflow-reward-categories" data-help={ui("Select reward categories. A reward matches when its category is one of the selected values.")}>{ui("Reward categories")}</Label><select id="workflow-reward-categories" multiple size={4} className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm" value={draft.scope.rewardCategories ?? []} onChange={(event) => { updateScope("rewardCategories", selectedValues(event)); }}>{Array.from(new Set((scopeCatalog.data?.rewards ?? []).map((reward) => reward.category).filter((category): category is string => Boolean(category)))).map((category) => <option key={category} value={category}>{category}</option>)}</select></div></div>}
            {draft.actionKey === "CUSTOM" && <div><Label htmlFor="workflow-custom-scope" data-help={ui("JSON object passed to the generic matcher. Future modules can supply matching attributes without another schema change.")}>{ui("Custom scope JSON")}</Label><textarea id="workflow-custom-scope" className="min-h-32 w-full rounded-md border bg-background p-2 font-mono text-sm" value={draft.customScopeJson} onChange={(event) => { setDraft((current) => ({ ...current, customScopeJson: event.target.value })); }} /><p className="mt-1 text-xs text-muted-foreground">{ui("Use an empty object to match all CUSTOM requests.")}</p></div>}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="workflow-self-approval" data-help={ui("Deny prevents an administrator requester from approving their own request; this is the safe default.")}>{ui("Self-approval policy")}</Label>
                <select id="workflow-self-approval" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.selfApprovalPolicy} onChange={(event) => { setDraft((current) => ({ ...current, selfApprovalPolicy: event.target.value as WorkflowDraft["selfApprovalPolicy"] })); }}>
                  <option value="DENY">{ui("Deny requester self-approval")}</option>
                  <option value="ALLOW">{ui("Allow requester self-approval")}</option>
                </select>
              </div>
              {editingId && <div className="flex items-center gap-3 pt-6"><Switch id="workflow-active" checked={draft.isActive} disabled={activate.isPending} onCheckedChange={(checked) => { activate.mutate(checked); }} /><Label htmlFor="workflow-active" data-help={ui("Only active workflows receive new requests. In-flight requests remain on their stored snapshot.")}>{ui("Active")}</Label></div>}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between"><div><h3 className="font-semibold">{ui("Approval layers")}</h3><p className="text-xs text-muted-foreground">{ui("Layers run sequentially; the next layer opens only after the current requirement is met.")}</p></div><Button type="button" variant="outline" onClick={() => { setDraft((current) => ({ ...current, steps: [...current.steps, blankStep()] })); }}><Plus className="mr-2 h-4 w-4" />{ui("Add layer")}</Button></div>
              {draft.steps.map((step, index) => (
                <div key={`step-${String(index)}`} className="space-y-3 rounded-md border p-4">
                  <div className="flex items-center justify-between gap-2"><p className="font-medium">{ui("Layer")} {index + 1}</p><div className="flex gap-1"><Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => { moveStep(index, -1); }} aria-label={ui("Move layer up")}><ArrowUp className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" disabled={index === draft.steps.length - 1} onClick={() => { moveStep(index, 1); }} aria-label={ui("Move layer down")}><ArrowDown className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" disabled={draft.steps.length === 1} onClick={() => { setDraft((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) })); }} aria-label={ui("Remove layer")}><Trash2 className="h-4 w-4" /></Button></div></div>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(10rem,1fr)_minmax(8rem,0.7fr)]">
                    <div><Label htmlFor={`workflow-step-name-${String(index)}`} data-help={ui("Label for this approval layer shown in request progress.")}>{ui("Layer name")}</Label><Input id={`workflow-step-name-${String(index)}`} value={step.name} onChange={(event) => { updateStep(index, { name: event.target.value }); }} /></div>
                    <div><Label htmlFor={`workflow-step-mode-${String(index)}`} data-help={ui("ANY needs one approval, ALL needs every resolved assignee, COUNT needs the configured number.")}>{ui("Requirement")}</Label><select id={`workflow-step-mode-${String(index)}`} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={step.approvalMode} onChange={(event) => { updateStep(index, { approvalMode: event.target.value as StepDraft["approvalMode"], requiredApprovalCount: event.target.value === "ANY" ? 1 : step.requiredApprovalCount }); }}><option value="ANY">ANY (1)</option><option value="ALL">ALL</option><option value="COUNT">{ui("Specific count")}</option></select></div>
                    <div><Label htmlFor={`workflow-step-count-${String(index)}`} data-help={ui("Minimum number of approvals required before this layer advances.")}>{ui("Required count")}</Label><Input id={`workflow-step-count-${String(index)}`} type="number" min={1} max={100} disabled={step.approvalMode !== "COUNT"} value={step.approvalMode === "ALL" ? ui("All") : step.requiredApprovalCount} onChange={(event) => { updateStep(index, { requiredApprovalCount: Number(event.target.value) }); }} /></div>
                  </div>
                  <div className="space-y-2"><Label data-help={ui("Choose active users or roles. Role assignments are expanded to active users and snapshotted when a request is created.")}>{ui("Approvers")}</Label>{step.assignees.map((assignee, assigneeIndex) => <div className="flex gap-2" key={`assignee-${String(index)}-${String(assigneeIndex)}`}><select className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" aria-label={`Layer ${String(index + 1)} approver ${String(assigneeIndex + 1)}`} value={assignee.value} onChange={(event) => { updateStep(index, { assignees: step.assignees.map((item, itemIndex) => itemIndex === assigneeIndex ? { value: event.target.value } : item) }); }}><option value="">{ui("Select a user or role")}</option><optgroup label={ui("Users")}>{(approvers.data?.users ?? []).map((user) => <option key={user.id} value={`user:${user.id}`}>{user.name} · {user.email}</option>)}</optgroup><optgroup label={ui("Roles")}>{(approvers.data?.roles ?? []).map((role) => <option key={role.value} value={`role:${role.value}`}>{role.label}</option>)}</optgroup></select><Button type="button" variant="ghost" size="icon" disabled={step.assignees.length === 1} onClick={() => { updateStep(index, { assignees: step.assignees.filter((_, itemIndex) => itemIndex !== assigneeIndex) }); }} aria-label={ui("Remove approver")}><Trash2 className="h-4 w-4" /></Button></div>)}<Button type="button" variant="outline" size="sm" onClick={() => { updateStep(index, { assignees: [...step.assignees, { value: "" }] }); }}><Plus className="mr-2 h-3 w-3" />{ui("Add approver")}</Button></div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2"><Button disabled={save.isPending} onClick={() => { save.mutate(); }}><Save className="mr-2 h-4 w-4" />{save.isPending ? ui("Saving…") : ui("Save workflow")}</Button>{editingId && <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => { if (window.confirm(ui("Delete this workflow definition? Historical requests prevent deletion."))) remove.mutate(); }}><Trash2 className="mr-2 h-4 w-4" />{ui("Delete")}</Button>}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
