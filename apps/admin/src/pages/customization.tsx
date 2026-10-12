import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { CustomForm, type CustomFormField } from "@/components/custom-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadPrivateAttachment, uploadPrivateAttachment } from "@/lib/custom-attachments";
import { fetchApi } from "@/lib/api-client";
import { ui } from "@/lib/ui-text";

type CustomizationContext = { key: string; label: string; readCapability: string; writeCapability: string };
type RoleOption = { value: string; label: string };
type WorkflowOption = { id: string; name: string; actionKey: string; isActive: boolean };
type Catalog = { contexts: CustomizationContext[]; roles: RoleOption[]; workflows: WorkflowOption[]; canConfigure: boolean; canManageDocuments: boolean; canViewDocuments?: boolean };
type BuilderField = CustomFormField & { readRoles?: string[] };
type BuilderState = { key: string; label: string; initial: boolean; terminal: boolean };
type BuilderTransition = { key: string; label: string; from: string; to: string; roles: string[]; workflowId?: string | null };
type Definition = {
  id: string;
  version?: number;
  canManage?: boolean;
  key: string;
  name: string;
  description: string | null;
  context: string;
  fields: BuilderField[];
  states: BuilderState[];
  transitions: BuilderTransition[];
  readRoles: string[];
  writeRoles: string[];
  isActive: boolean;
};
type CustomRecord = {
  id: string;
  definitionId: string;
  recordId?: string | null;
  title: string;
  values: Record<string, unknown>;
  status: string;
  version: number;
  approvalRequestId?: string | null;
  pendingTransition?: unknown;
  availableTransitions?: BuilderTransition[];
  createdAt: string;
  updatedAt: string;
};
type RecordApprovalHistory = {
  id: string;
  status: string;
  requestedAt: string;
  resolvedAt: string | null;
  resolutionComment: string | null;
  steps: { name: string; status: string }[];
  decisions: { decision: string; comment: string | null; createdAt: string; approver: { name: string } | null }[];
};
type Target = { id: string; title: string };

const fieldTypes: BuilderField["type"][] = ["TEXT", "LONG_TEXT", "NUMBER", "BOOLEAN", "DATE", "DATETIME", "SELECT", "MULTI_SELECT", "EMAIL", "URL", "FILE"];
const makeKey = (value: string): string => value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const humanize = (value: string): string => ui(value.toLocaleLowerCase().split("_").map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1)).join(" "));

function createDefinition(context: string): Omit<Definition, "id"> {
  const custom = context === "CUSTOM";
  return {
    key: custom ? "" : context.toLocaleLowerCase(),
    name: "",
    description: "",
    context,
    fields: [],
    states: [{ key: "DRAFT", label: ui("Draft"), initial: true, terminal: false }, { key: "COMPLETE", label: ui("Complete"), initial: false, terminal: true }],
    transitions: custom ? [{ key: "complete", label: ui("Complete"), from: "DRAFT", to: "COMPLETE", roles: ["SUPER_ADMIN"], workflowId: null }] : [],
    readRoles: ["SUPER_ADMIN"],
    writeRoles: ["SUPER_ADMIN"],
    isActive: true,
  };
}

function RolePicker({ label, roles, selected, disabled, onChange }: { label: string; roles: RoleOption[]; selected: string[]; disabled: boolean; onChange: (value: string[]) => void }): JSX.Element {
  return <fieldset className="space-y-2"><legend className="text-sm font-medium">{label}</legend><div className="grid gap-2 sm:grid-cols-2">{roles.map((role) => <label key={role.value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(role.value)} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...new Set([...selected, role.value])] : selected.filter((item) => item !== role.value))} />{role.label}</label>)}</div><p className="text-xs text-muted-foreground">{ui("An empty selection uses the owner-only default; owners always retain access.")}</p></fieldset>;
}

export function CustomizationPage(): JSX.Element {
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [context, setContext] = useState("CUSTOM");
  const [selectedDefinitionId, setSelectedDefinitionId] = useState("");
  const [creatingDefinition, setCreatingDefinition] = useState(false);
  const [draft, setDraft] = useState<Omit<Definition, "id"> | Definition>(() => createDefinition("CUSTOM"));
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [recordTitle, setRecordTitle] = useState("");
  const [recordValues, setRecordValues] = useState<Record<string, unknown>>({});
  const [targetSearch, setTargetSearch] = useState("");
  const [recordTargetId, setRecordTargetId] = useState("");
  const [recordErrors, setRecordErrors] = useState<Record<string, string>>({});
  const deepLinkRecordId = searchParams.get("record") ?? "";

  const catalog = useQuery({ queryKey: ["customization", "catalog"], queryFn: () => fetchApi<Catalog>("/admin/customization/catalog") });
  const definitions = useQuery({
    queryKey: ["customization", "definitions", context],
    queryFn: () => fetchApi<Definition[]>(`/admin/customization/definitions?context=${encodeURIComponent(context)}`),
  });
  const deepLinkedRecord = useQuery({
    queryKey: ["customization", "record", deepLinkRecordId],
    queryFn: () => fetchApi<CustomRecord & { definition: Definition }>(`/admin/customization/records/${encodeURIComponent(deepLinkRecordId)}`),
    enabled: Boolean(deepLinkRecordId),
    retry: false,
  });
  const definition = (definitions.data ?? []).find((item) => item.id === selectedDefinitionId) ?? null;
  const activeDefinition = creatingDefinition ? null : definition;
  const savedDefinitionId = activeDefinition?.id ?? "";
  const records = useQuery({
    queryKey: ["customization", "records", savedDefinitionId],
    queryFn: () => fetchApi<CustomRecord[]>(`/admin/customization/definitions/${encodeURIComponent(savedDefinitionId)}/records`),
    enabled: Boolean(savedDefinitionId && (catalog.data?.canViewDocuments ?? catalog.data?.canManageDocuments)),
  });
  const record = (records.data ?? []).find((item) => item.id === selectedRecordId) ?? null;
  const isRecordNew = !selectedRecordId;
  const recordHistory = useQuery({
    queryKey: ["customization", "record-history", record?.id],
    queryFn: () => fetchApi<RecordApprovalHistory[]>(`/admin/customization/records/${encodeURIComponent(record?.id ?? "")}/history`),
    enabled: Boolean(record?.id && (catalog.data?.canViewDocuments ?? catalog.data?.canManageDocuments)),
  });
  const recordTargets = useQuery({
    queryKey: ["customization", "targets", savedDefinitionId, targetSearch],
    queryFn: () => fetchApi<Target[]>(`/admin/customization/definitions/${encodeURIComponent(savedDefinitionId)}/targets?search=${encodeURIComponent(targetSearch.trim())}`),
    enabled: Boolean(savedDefinitionId && activeDefinition?.context !== "CUSTOM" && (catalog.data?.canViewDocuments ?? catalog.data?.canManageDocuments)),
  });
  const activeRoles = catalog.data?.roles ?? [];
  const activeWorkflows = (catalog.data?.workflows ?? []).filter((workflow) => workflow.isActive && workflow.actionKey === "CUSTOM_DOCUMENT_APPROVAL");
  useEffect(() => {
    if (deepLinkRecordId) return;
    setSelectedDefinitionId("");
    setCreatingDefinition(false);
    setDraft(createDefinition(context));
    setSelectedRecordId("");
    setRecordTitle("");
    setRecordValues({});
    setRecordTargetId("");
  }, [context]);

  useEffect(() => {
    if (!definition || creatingDefinition) return;
    setDraft(structuredClone(definition));
  }, [definition?.id, definition?.name, definition?.context, definition?.version, creatingDefinition]);

  useEffect(() => {
    const existing = record;
    setRecordTitle(existing?.title ?? "");
    setRecordValues(existing?.values ?? {});
    setRecordTargetId(existing?.recordId ?? "");
    setRecordErrors({});
  }, [selectedRecordId, record?.version]);

  useEffect(() => {
    const linked = deepLinkedRecord.data;
    if (!linked || linked.id !== deepLinkRecordId) return;
    setContext(linked.definition.context);
    setSelectedDefinitionId(linked.definitionId);
    setSelectedRecordId(linked.id);
    setNotice(null);
  }, [deepLinkedRecord.data?.id, deepLinkRecordId]);

  const saveDefinition = useMutation({
    mutationFn: () => {
      if (!draft.name.trim()) throw new Error(ui("Enter a name for this function."));
      if (draft.context === "CUSTOM" && !/^[a-z][a-z0-9_]{1,62}$/.test(draft.key)) throw new Error(ui("Use a function key with lowercase letters, numbers, and underscores; start with a letter."));
      if (!draft.states.length || draft.states.filter((state) => state.initial).length !== 1) throw new Error(ui("Define at least one state and exactly one initial state."));
      if (draft.fields.some((field) => !field.key.trim() || !field.label.trim())) throw new Error(ui("Every field needs a key and label."));
      const fieldKeys = draft.fields.map((field) => field.key);
      if (new Set(fieldKeys).size !== fieldKeys.length) throw new Error(ui("Field keys must be unique."));
      if (draft.fields.some((field) => ["SELECT", "MULTI_SELECT"].includes(field.type) && !(field.options ?? []).length)) throw new Error(ui("Choice fields need at least one option."));
      if (draft.fields.some((field) => new Set(field.options ?? []).size !== (field.options ?? []).length)) throw new Error(ui("Field options must not be duplicated."));
      if (draft.writeRoles.some((role) => role !== "SUPER_ADMIN" && !draft.readRoles.includes(role))) throw new Error(ui("Every writer must also have view access."));
      if (draft.fields.some((field) => field.required && field.readRoles?.length && draft.writeRoles.some((role) => role !== "SUPER_ADMIN" && !field.readRoles?.includes(role)))) throw new Error(ui("Every writer must be able to view required fields."));
      if (draft.context === "CUSTOM") {
        const stateKeys = draft.states.map((state) => makeKey(state.key).toLocaleUpperCase());
        const transitionKeys = draft.transitions.map((transition) => makeKey(transition.key));
        if (new Set(stateKeys).size !== stateKeys.length) throw new Error(ui("State keys must be unique."));
        if (new Set(transitionKeys).size !== transitionKeys.length) throw new Error(ui("Action keys must be unique."));
        if (draft.transitions.some((transition) => {
          const from = makeKey(transition.from).toLocaleUpperCase();
          const to = makeKey(transition.to).toLocaleUpperCase();
          return from === to || !stateKeys.includes(from) || !stateKeys.includes(to) || draft.states.some((state) => makeKey(state.key).toLocaleUpperCase() === from && state.terminal);
        })) throw new Error(ui("Each action needs different valid states, and terminal states cannot have outgoing actions."));
        if (draft.transitions.some((transition) => transition.roles.some((role) => role !== "SUPER_ADMIN" && !draft.writeRoles.includes(role)))) throw new Error(ui("Action roles must also have record write access."));
      }
      if (draft.fields.some((field) => ["SELECT", "MULTI_SELECT"].includes(field.type) && !(field.options ?? []).length)) throw new Error(ui("Choice fields need at least one option."));
      if (draft.fields.some((field) => new Set(field.options ?? []).size !== (field.options ?? []).length)) throw new Error(ui("Field options must not be duplicated."));
      if (draft.writeRoles.some((role) => role !== "SUPER_ADMIN" && !draft.readRoles.includes(role))) throw new Error(ui("Every writer must also have view access."));
      if (draft.fields.some((field) => field.required && field.readRoles?.length && draft.writeRoles.some((role) => role !== "SUPER_ADMIN" && !field.readRoles?.includes(role)))) throw new Error(ui("Every writer must be able to view required fields."));
      if (draft.context === "CUSTOM") {
        const stateKeys = draft.states.map((state) => makeKey(state.key).toLocaleUpperCase());
        const transitionKeys = draft.transitions.map((transition) => makeKey(transition.key));
        if (new Set(stateKeys).size !== stateKeys.length) throw new Error(ui("State keys must be unique."));
        if (new Set(transitionKeys).size !== transitionKeys.length) throw new Error(ui("Action keys must be unique."));
        if (draft.transitions.some((transition) => {
          const from = makeKey(transition.from).toLocaleUpperCase();
          const to = makeKey(transition.to).toLocaleUpperCase();
          return from === to || !stateKeys.includes(from) || !stateKeys.includes(to) || draft.states.some((state) => makeKey(state.key).toLocaleUpperCase() === from && state.terminal);
        })) throw new Error(ui("Each action needs different valid states, and terminal states cannot have outgoing actions."));
        if (draft.transitions.some((transition) => transition.roles.some((role) => role !== "SUPER_ADMIN" && !draft.writeRoles.includes(role)))) throw new Error(ui("Action roles must also have record write access."));
      }
      const body = {
        ...draft,
        ...(!creatingDefinition ? { version: (draft as Definition).version } : {}),
        key: draft.context === "CUSTOM" ? draft.key : draft.context.toLocaleLowerCase(),
        fields: draft.fields.map((field, index) => ({ ...field, sortOrder: index, options: field.options ?? [] })),
        states: draft.states.map((state) => ({ ...state, key: makeKey(state.key).toLocaleUpperCase() })),
        transitions: draft.transitions.map((transition) => ({ ...transition, key: makeKey(transition.key), roles: transition.roles.length ? transition.roles : ["SUPER_ADMIN"], workflowId: transition.workflowId || null })),
        readRoles: draft.readRoles.length ? draft.readRoles : ["SUPER_ADMIN"],
        writeRoles: draft.writeRoles.length ? draft.writeRoles : ["SUPER_ADMIN"],
      };
      return creatingDefinition
        ? fetchApi<Definition>("/admin/customization/definitions", { method: "POST", body: JSON.stringify(body) })
        : fetchApi<Definition>(`/admin/customization/definitions/${encodeURIComponent((draft as Definition).id)}`, { method: "PATCH", body: JSON.stringify(body) });
    },
    onSuccess: async (saved) => {
      setNotice(ui("Function configuration saved."));
      setCreatingDefinition(false);
      setDraft(structuredClone(saved));
      setSelectedDefinitionId(saved.id);
      await client.invalidateQueries({ queryKey: ["customization", "definitions"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });
  const archiveDefinition = useMutation({
    mutationFn: (id: string) => fetchApi(`/admin/customization/definitions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: async () => {
      setSelectedDefinitionId("");
      setNotice(ui("Function archived."));
      await client.invalidateQueries({ queryKey: ["customization", "definitions"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });
  const refreshRecords = async (): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["customization", "records", savedDefinitionId] }),
      client.invalidateQueries({ queryKey: ["customization", "record-history"] }),
    ]);
  };
  const saveRecord = useMutation({
    mutationFn: () => {
      if (!activeDefinition) throw new Error(ui("Select a configured function first."));
      if (!recordTitle.trim()) throw new Error(ui("Enter a record title."));
      const errors: Record<string, string> = {};
      for (const field of activeDefinition.fields) {
        if (!field.isActive || !field.required) continue;
        const value = recordValues[field.key];
        const present = field.type === "BOOLEAN" || (field.type === "MULTI_SELECT" ? Array.isArray(value) && value.length > 0 : field.type === "FILE" ? Boolean(value && typeof value === "object" && "attachmentId" in value) : value !== undefined && value !== null && value !== "");
        if (record && !isDraftRecord && !present) errors[field.key] = ui("This field is required.");
      }
      setRecordErrors(errors);
      if (Object.keys(errors).length) throw new Error(ui("Complete all required fields before saving."));
      if (activeDefinition.context !== "CUSTOM" && !recordTargetId && !record) throw new Error(ui("Select the related record before creating this document."));
      const body = { title: recordTitle.trim(), values: recordValues, ...(recordTargetId ? { recordId: recordTargetId } : {}) };
      return record
        ? fetchApi<CustomRecord>(`/admin/customization/records/${encodeURIComponent(record.id)}`, { method: "PATCH", body: JSON.stringify({ title: body.title, values: body.values, version: record.version }) })
        : fetchApi<CustomRecord>(`/admin/customization/definitions/${encodeURIComponent(activeDefinition.id)}/records`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: async (saved) => {
      setSelectedRecordId(saved.id);
      setNotice(ui("Record saved."));
      await refreshRecords();
    },
    onError: (error: Error) => setNotice(error.message),
  });
  const deleteRecord = useMutation({
    mutationFn: (id: string) => fetchApi(`/admin/customization/records/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: async () => {
      setSelectedRecordId("");
      setRecordTitle("");
      setRecordValues({});
      setNotice(ui("Draft record deleted."));
      await refreshRecords();
    },
    onError: (error: Error) => setNotice(error.message),
  });
  const transitionRecord = useMutation({
    mutationFn: ({ transitionKey, version }: { transitionKey: string; version: number }) => {
      const errors: Record<string, string> = {};
      for (const field of activeDefinition?.fields ?? []) {
        const value = recordValues[field.key];
        const present = field.type === "BOOLEAN" || (field.type === "MULTI_SELECT" ? Array.isArray(value) && value.length > 0 : field.type === "FILE" ? Boolean(value && typeof value === "object" && "attachmentId" in value) : value !== undefined && value !== null && value !== "");
        if (field.isActive !== false && field.required && !present) errors[field.key] = ui("This field is required.");
      }
      setRecordErrors(errors);
      if (Object.keys(errors).length) throw new Error(ui("Complete all required fields before changing the record status."));
      return fetchApi<CustomRecord>(`/admin/customization/records/${encodeURIComponent(selectedRecordId)}/transitions`, { method: "POST", body: JSON.stringify({ transitionKey, version }) });
    },
    onSuccess: async (updated) => {
      setNotice(updated.pendingTransition ? ui("Transition submitted for approval.") : ui("Record status updated."));
      await refreshRecords();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const changeContext = (value: string): void => {
    if (deepLinkRecordId) {
      const next = new URLSearchParams(searchParams);
      next.delete("record");
      setSearchParams(next, { replace: true });
    }
    setContext(value);
    setNotice(null);
  };
  const startCreateDefinition = (): void => {
    setSelectedDefinitionId("");
    setCreatingDefinition(true);
    setDraft(createDefinition(context));
  };
  const updateField = (index: number, update: Partial<BuilderField>): void => setDraft((current) => ({ ...current, fields: current.fields.map((field, itemIndex) => itemIndex === index ? { ...field, ...update } : field) }));
  const moveField = (index: number, step: number): void => setDraft((current) => {
    const fields = [...current.fields];
    const destination = index + step;
    if (destination < 0 || destination >= fields.length) return current;
    const sourceField = fields[index];
    const destinationField = fields[destination];
    if (!sourceField || !destinationField) return current;
    [fields[index], fields[destination]] = [destinationField, sourceField];
    return { ...current, fields };
  });
  const addField = (): void => setDraft((current) => ({ ...current, fields: [...current.fields, { key: `field_${current.fields.length + 1}`, label: "", type: "TEXT", required: false, options: [], sortOrder: current.fields.length, isActive: true, readRoles: [] }] }));
  const updateState = (index: number, update: Partial<BuilderState>): void => setDraft((current) => {
    const previousKey = current.states[index]?.key;
    const states = current.states.map((state, itemIndex) => ({ ...state, ...(itemIndex === index ? update : {}), ...(update.initial && itemIndex !== index ? { initial: false } : {}) }));
    const nextKey = states[index]?.key;
    const transitions = update.key && previousKey && nextKey !== previousKey
      ? current.transitions.map((transition) => ({ ...transition, from: transition.from === previousKey ? nextKey! : transition.from, to: transition.to === previousKey ? nextKey! : transition.to }))
      : current.transitions;
    return { ...current, states, transitions };
  });
  const addState = (): void => setDraft((current) => {
    const index = current.states.length + 1;
    const key = `STATE_${index}`;
    return { ...current, states: [...current.states, { key, label: `${ui("State")} ${index}`, initial: false, terminal: false }] };
  });
  const addTransition = (): void => setDraft((current) => {
    const from = current.states[0]?.key ?? "DRAFT";
    const to = current.states.find((state) => state.key !== from)?.key ?? from;
    const index = current.transitions.length + 1;
    return { ...current, transitions: [...current.transitions, { key: `action_${index}`, label: `${ui("Action")} ${index}`, from, to, roles: ["SUPER_ADMIN"], workflowId: null }] };
  });
  const updateTransition = (index: number, update: Partial<BuilderTransition>): void => setDraft((current) => ({ ...current, transitions: current.transitions.map((transition, itemIndex) => itemIndex === index ? { ...transition, ...update } : transition) }));
  const startNewRecord = (): void => { setSelectedRecordId(""); setRecordTitle(""); setRecordValues({}); setRecordTargetId(""); setRecordErrors({}); };
  const isTerminalRecord = Boolean(record && activeDefinition?.states.some((state) => state.terminal && state.key === record.status));
  const isDraftRecord = Boolean(record && activeDefinition?.states.some((state) => state.initial && state.key === record.status));
  const currentStateTransitions = record?.availableTransitions ?? (record ? (activeDefinition?.transitions ?? []).filter((transition) => transition.from === record.status) : []);
  const recordCanBeDeleted = isDraftRecord && !record?.pendingTransition;

  if (catalog.isLoading) return <div className="p-6 text-sm text-muted-foreground">{ui("Loading configurable functions…")}</div>;
  if (catalog.isError) return <div className="space-y-3 p-6"><p role="alert" className="text-sm text-destructive">{ui("Function configuration could not be loaded.")}</p><Button variant="outline" onClick={() => void catalog.refetch()}>{ui("Retry")}</Button></div>;

  const catalogData = catalog.data;
  if (!catalogData) return <div role="alert" className="p-6 text-sm text-destructive">{ui("Function configuration could not be loaded.")}</div>;
  const contextOptions = [{ key: "CUSTOM", label: ui("Custom function"), readCapability: "", writeCapability: "" }, ...catalogData.contexts];
  const selectedContext = contextOptions.find((item) => item.key === context) ?? { key: context, label: context, readCapability: "", writeCapability: "" };
  const canEditDefinitions = catalogData.canConfigure;
  const canEditRecords = Boolean(catalogData.canManageDocuments && activeDefinition?.canManage);

  return <div className="space-y-5 pb-12">
    <header><h1 className="text-2xl font-bold">{ui("Forms & workflows")}</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{ui("Configure extra fields, document states, and role-based transitions without changing reserved system or financial fields.")}</p></header>
    {notice && <div role="status" className="rounded-md border bg-muted p-3 text-sm">{notice}</div>}
    {deepLinkRecordId && deepLinkedRecord.isLoading && <p className="text-sm text-muted-foreground">{ui("Loading linked record…")}</p>}
    {deepLinkRecordId && deepLinkedRecord.isError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 p-3 text-sm"><span>{ui("The linked record is unavailable or you do not have permission to view it.")}</span><Button size="sm" variant="outline" onClick={() => void deepLinkedRecord.refetch()}>{ui("Retry")}</Button></div>}
    {!canEditDefinitions && <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{ui("You can view these configurations, but your role cannot change them.")}</div>}

    <Card><CardHeader><CardTitle>{ui("Choose a function")}</CardTitle><CardDescription>{ui("Built-in modules keep their existing core fields. Add optional fields and documents here, or define a new custom function.")}</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[minmax(12rem,0.8fr)_minmax(18rem,1.2fr)_auto] md:items-end">
        <div><Label htmlFor="customization-context">{ui("Function area")}</Label><select id="customization-context" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={context} onChange={(event) => changeContext(event.target.value)}>{contextOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></div>
        <div><Label htmlFor="customization-definition">{ui("Configured form / function")}</Label><select id="customization-definition" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={creatingDefinition ? "__new__" : selectedDefinitionId} onChange={(event) => event.target.value === "__new__" ? startCreateDefinition() : (setCreatingDefinition(false), setSelectedDefinitionId(event.target.value))}><option value="">{ui("Select a configuration")}</option>{(definitions.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.isActive ? ui("Active") : ui("Archived")}</option>)}{creatingDefinition && <option value="__new__">{ui("New configuration")}</option>}</select></div>
        {canEditDefinitions && <Button variant="outline" onClick={startCreateDefinition} disabled={context !== "CUSTOM" && Boolean(definitions.data?.length)}>{context === "CUSTOM" ? ui("New function") : ui("Add extra fields")}</Button>}
      </div>
      {selectedContext.key !== "CUSTOM" && <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{ui("These are extra attributes only. Existing system fields, point balances, and financial rules are managed by their dedicated screens and are not replaced here.")}</div>}
      {definitions.isLoading && <p className="text-sm text-muted-foreground">{ui("Loading configurations…")}</p>}
      {definitions.isError && <div className="flex items-center justify-between gap-3 text-sm"><p className="text-destructive">{ui("Configurations could not be loaded.")}</p><Button size="sm" variant="outline" onClick={() => void definitions.refetch()}>{ui("Retry")}</Button></div>}
    </CardContent></Card>

    {(activeDefinition || creatingDefinition) && <Card><CardHeader><CardTitle>{creatingDefinition ? context === "CUSTOM" ? ui("Create a custom function") : ui("Configure extra fields") : ui("Function configuration")}</CardTitle><CardDescription>{ui("Build a simple form with typed fields and define which states and actions are available. Selecting an approval workflow makes that transition wait for approval; no workflow means an immediate transition.")}</CardDescription></CardHeader><CardContent className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2">
        <div><Label htmlFor="definition-name">{ui("Name")}</Label><Input id="definition-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} disabled={!canEditDefinitions} /></div>
        {draft.context === "CUSTOM" && <div><Label htmlFor="definition-key">{ui("Function key")}</Label><Input id="definition-key" value={draft.key} onChange={(event) => setDraft({ ...draft, key: makeKey(event.target.value) })} placeholder="wellbeing_request" disabled={!canEditDefinitions || (!creatingDefinition && Boolean((draft as Definition).id))} /><p className="mt-1 text-xs text-muted-foreground">{ui("Lowercase letters, numbers, and underscores; the key is stable after creation.")}</p></div>}
        <div className="md:col-span-2"><Label htmlFor="definition-description">{ui("Description")}</Label><Textarea id="definition-description" value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} disabled={!canEditDefinitions} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} disabled={!canEditDefinitions} />{ui("Function is active")}</label>
      </section>

      <section className="space-y-3 border-t pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">{ui("Form fields")}</h3><p className="text-xs text-muted-foreground">{ui("Choose data types, required fields, choices, visibility roles, and display order.")}</p></div><Button size="sm" variant="outline" onClick={addField} disabled={!canEditDefinitions}>{ui("Add field")}</Button></div>
        {!draft.fields.length && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{ui("No extra fields yet.")}</p>}
        {draft.fields.map((field, index) => <div key={`${field.key}-${index}`} className="space-y-3 rounded-md border p-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_10rem_auto]">
            <div><Label>{ui("Field key")}</Label><Input value={field.key} onChange={(event) => updateField(index, { key: makeKey(event.target.value) })} disabled={!canEditDefinitions} placeholder="project_code" /></div>
            <div><Label>{ui("Label")}</Label><Input value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} disabled={!canEditDefinitions} /></div>
            <div><Label>{ui("Type")}</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={field.type} onChange={(event) => updateField(index, { type: event.target.value as BuilderField["type"] })} disabled={!canEditDefinitions}>{fieldTypes.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}</select></div>
            <div className="flex items-end gap-1"><Button type="button" size="sm" variant="outline" onClick={() => moveField(index, -1)} disabled={!canEditDefinitions || index === 0} aria-label={ui("Move field up")}>↑</Button><Button type="button" size="sm" variant="outline" onClick={() => moveField(index, 1)} disabled={!canEditDefinitions || index === draft.fields.length - 1} aria-label={ui("Move field down")}>↓</Button><Button type="button" size="sm" variant="ghost" onClick={() => setDraft((current) => ({ ...current, fields: current.fields.filter((_, itemIndex) => itemIndex !== index) }))} disabled={!canEditDefinitions}>{ui("Remove")}</Button></div>
          </div>
          <div className="grid gap-3 md:grid-cols-2"><div><Label>{ui("Help text (optional)")}</Label><Input value={field.description ?? ""} onChange={(event) => updateField(index, { description: event.target.value })} disabled={!canEditDefinitions} /></div><div><Label>{ui("Options, separated by commas")}</Label><Input value={(field.options ?? []).join(", ")} onChange={(event) => updateField(index, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })} disabled={!canEditDefinitions || !["SELECT", "MULTI_SELECT"].includes(field.type)} /></div></div>
          <div className="flex flex-wrap gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(field.required)} onChange={(event) => updateField(index, { required: event.target.checked })} disabled={!canEditDefinitions} />{ui("Required")}</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={field.isActive !== false} onChange={(event) => updateField(index, { isActive: event.target.checked })} disabled={!canEditDefinitions} />{ui("Active")}</label></div>
          <RolePicker label={ui("Field visible to roles")} roles={activeRoles} selected={field.readRoles ?? []} disabled={!canEditDefinitions} onChange={(readRoles) => updateField(index, { readRoles })} />
        </div>)}
      </section>

      {draft.context === "CUSTOM" ? <section className="space-y-3 border-t pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">{ui("States")}</h3><p className="text-xs text-muted-foreground">{ui("Set one starting state and mark any end states.")}</p></div><Button size="sm" variant="outline" onClick={addState} disabled={!canEditDefinitions}>{ui("Add state")}</Button></div>
        {draft.states.map((state, index) => <div key={`${state.key}-${index}`} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto_auto_auto] sm:items-end"><div><Label>{ui("State key")}</Label><Input value={state.key} onChange={(event) => updateState(index, { key: makeKey(event.target.value).toLocaleUpperCase() })} disabled={!canEditDefinitions} /></div><div><Label>{ui("State label")}</Label><Input value={state.label} onChange={(event) => updateState(index, { label: event.target.value })} disabled={!canEditDefinitions} /></div><label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={state.initial} onChange={(event) => updateState(index, { initial: event.target.checked })} disabled={!canEditDefinitions} />{ui("Initial")}</label><label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={state.terminal} onChange={(event) => updateState(index, { terminal: event.target.checked })} disabled={!canEditDefinitions} />{ui("Terminal")}</label><Button size="sm" variant="ghost" onClick={() => setDraft((current) => { const key = current.states[index]?.key; return { ...current, states: current.states.filter((_, itemIndex) => itemIndex !== index), transitions: current.transitions.filter((transition) => transition.from !== key && transition.to !== key) }; })} disabled={!canEditDefinitions || draft.states.length <= 1}>{ui("Remove")}</Button></div>)}
      </section> : <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{ui("The selected built-in module keeps its existing workflow. This form adds fields only.")}</div>}

      {draft.context === "CUSTOM" && <section className="space-y-3 border-t pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">{ui("Transitions / actions")}</h3><p className="text-xs text-muted-foreground">{ui("Choose who may move a record between states and which workflow, if any, must approve it.")}</p></div><Button size="sm" variant="outline" onClick={addTransition} disabled={!canEditDefinitions}>{ui("Add action")}</Button></div>
        {!draft.transitions.length && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{ui("No transitions. Records can still be saved in their initial state.")}</p>}
        {draft.transitions.map((transition, index) => <div key={`${transition.key}-${index}`} className="space-y-3 rounded-md border p-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><Label>{ui("Action key")}</Label><Input value={transition.key} onChange={(event) => updateTransition(index, { key: makeKey(event.target.value) })} disabled={!canEditDefinitions} /></div><div><Label>{ui("Action label")}</Label><Input value={transition.label} onChange={(event) => updateTransition(index, { label: event.target.value })} disabled={!canEditDefinitions} /></div><div><Label>{ui("From state")}</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={transition.from} onChange={(event) => updateTransition(index, { from: event.target.value })} disabled={!canEditDefinitions}>{draft.states.map((state) => <option key={state.key} value={state.key}>{state.label || state.key}</option>)}</select></div><div><Label>{ui("To state")}</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={transition.to} onChange={(event) => updateTransition(index, { to: event.target.value })} disabled={!canEditDefinitions}>{draft.states.map((state) => <option key={state.key} value={state.key}>{state.label || state.key}</option>)}</select></div></div>
          <RolePicker label={ui("Who can use this action")} roles={activeRoles} selected={transition.roles} disabled={!canEditDefinitions} onChange={(roles) => updateTransition(index, { roles })} />
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]"><div><Label>{ui("Approval workflow (optional)")}</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={transition.workflowId ?? ""} onChange={(event) => updateTransition(index, { workflowId: event.target.value || null })} disabled={!canEditDefinitions}><option value="">{ui("No approval — update immediately")}</option>{activeWorkflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select><p className="mt-1 text-xs text-muted-foreground">{activeWorkflows.length ? ui("Only active custom-document approval workflows are listed.") : ui("No active custom document approval workflow is configured; transitions will be immediate until one is set up.")}</p></div><Button size="sm" variant="ghost" onClick={() => setDraft((current) => ({ ...current, transitions: current.transitions.filter((_, itemIndex) => itemIndex !== index) }))} disabled={!canEditDefinitions}>{ui("Remove action")}</Button></div>
        </div>)}
      </section>}

      <section className="grid gap-4 border-t pt-5 md:grid-cols-2"><RolePicker label={ui("Who can view records")} roles={activeRoles} selected={draft.readRoles} disabled={!canEditDefinitions} onChange={(readRoles) => setDraft({ ...draft, readRoles })} /><RolePicker label={ui("Who can create and edit records")} roles={activeRoles} selected={draft.writeRoles} disabled={!canEditDefinitions} onChange={(writeRoles) => setDraft({ ...draft, writeRoles })} /></section>
      <div className="flex flex-wrap gap-2"><Button onClick={() => saveDefinition.mutate()} disabled={!canEditDefinitions || saveDefinition.isPending}>{saveDefinition.isPending ? ui("Saving…") : ui("Save configuration")}</Button>{activeDefinition && canEditDefinitions && <Button variant="outline" onClick={() => { if (window.confirm(ui("Archive this configuration? Records are retained, but the form will no longer be active."))) archiveDefinition.mutate(activeDefinition.id); }} disabled={archiveDefinition.isPending}>{ui("Archive configuration")}</Button>}</div>
    </CardContent></Card>}

    {activeDefinition && <Card><CardHeader><CardTitle>{ui("Records")}</CardTitle><CardDescription>{ui("Create and manage records using this form. Server permissions and configured transitions are enforced when saving.")}</CardDescription></CardHeader><CardContent className="space-y-5">
      {!canEditRecords && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{ui("You can view records, but your role cannot create or edit them.")}</p>}
      {canEditRecords && <div className="grid gap-4 lg:grid-cols-[minmax(14rem,0.75fr)_minmax(0,1.25fr)]">
      <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{ui("Saved records")}</h3>{canEditRecords && <Button size="sm" variant="outline" onClick={startNewRecord}>{ui("New record")}</Button>}</div>{records.isLoading && <p className="text-sm text-muted-foreground">{ui("Loading records…")}</p>}{records.isError && <div className="space-y-2 text-sm"><p className="text-destructive">{ui("Records could not be loaded.")}</p><Button size="sm" variant="outline" onClick={() => void records.refetch()}>{ui("Retry")}</Button></div>}<div className="max-h-[32rem] space-y-2 overflow-y-auto">{(records.data ?? []).map((item) => <button type="button" key={item.id} onClick={() => setSelectedRecordId(item.id)} className={`w-full rounded-md border p-3 text-left ${selectedRecordId === item.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}><span className="flex items-start justify-between gap-2"><span className="font-medium">{item.title}</span><Badge variant="outline">{humanize(item.status)}</Badge></span><span className="mt-1 block text-xs text-muted-foreground">{new Date(item.updatedAt).toLocaleString()}</span>{Boolean(item.pendingTransition) && <span className="mt-1 block text-xs text-primary underline">{ui("Approval request pending")}</span>}</button>)}{!records.isLoading && !(records.data ?? []).length && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{ui("No records yet.")}</p>}</div></section>
        <section className="space-y-4 rounded-md border p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{isRecordNew ? ui("New record") : ui("Edit record")}</h3>{record && <p className="mt-1 text-xs text-muted-foreground">{ui("Current state")}: {humanize(record.status)}{record.pendingTransition ? ` · ${ui("An action is awaiting approval")}` : ""}</p>}</div>{record?.approvalRequestId && <a className="text-sm text-primary underline" href={`/approvals?request=${encodeURIComponent(record.approvalRequestId)}`}>{ui("View approval")}</a>}</div>
          <div><Label htmlFor="record-title">{ui("Record title")}</Label><Input id="record-title" value={recordTitle} onChange={(event) => setRecordTitle(event.target.value)} disabled={!canEditRecords || Boolean(record && (isTerminalRecord || record.pendingTransition))} /></div>
          {activeDefinition.context !== "CUSTOM" && <div className="space-y-2"><Label htmlFor="record-target-search">{ui("Related record")}</Label><Input id="record-target-search" value={targetSearch} onChange={(event) => setTargetSearch(event.target.value)} placeholder={ui("Search available records") as string} /><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={recordTargetId} onChange={(event) => setRecordTargetId(event.target.value)} disabled={!canEditRecords || Boolean(record)}><option value="">{ui("Select a related record")}</option>{(recordTargets.data ?? []).map((target) => <option key={target.id} value={target.id}>{target.title}</option>)}</select>{recordTargets.isError && <p className="text-xs text-destructive">{ui("Related records could not be loaded.")}</p>}</div>}
          <CustomForm idPrefix="custom-record" fields={activeDefinition.fields} value={recordValues} onChange={setRecordValues} errors={recordErrors} disabled={!canEditRecords || Boolean(record && (isTerminalRecord || record.pendingTransition))} fileUploadDisabled={!record || !canEditRecords || isTerminalRecord || Boolean(record?.pendingTransition)} onFileUpload={async (_key, file) => {
            if (!record) throw new Error(ui("Save this record as a draft before attaching files."));
            const attachment = await uploadPrivateAttachment("CUSTOM_DOCUMENT", record.id, file);
            return { kind: "FILE", attachmentId: attachment.id, name: attachment.name };
          }} onFileDownload={(file) => { void downloadPrivateAttachment(file.attachmentId, file.name || ui("download")).catch((error: unknown) => setNotice(error instanceof Error ? error.message : ui("Unable to download the attached file."))); }} />
          {!record && activeDefinition.fields.some((field) => field.type === "FILE" && field.isActive !== false) && <p className="text-xs text-muted-foreground">{ui("Save a draft first; private files can be attached to an existing record.")}</p>}
          <div className="flex flex-wrap gap-2"><Button onClick={() => saveRecord.mutate()} disabled={!canEditRecords || saveRecord.isPending || Boolean(record && (isTerminalRecord || record.pendingTransition))}>{saveRecord.isPending ? ui("Saving…") : ui("Save draft")}</Button>{canEditRecords && record && recordCanBeDeleted && <Button variant="outline" onClick={() => { if (window.confirm(ui("Delete this draft record?"))) deleteRecord.mutate(record.id); }} disabled={deleteRecord.isPending}>{ui("Delete draft")}</Button>}</div>
          {record && currentStateTransitions.length > 0 && <div className="space-y-2 border-t pt-4"><p className="text-sm font-medium">{ui("Available actions")}</p>{currentStateTransitions.map((transition) => <div key={transition.key} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"><span className="text-sm">{transition.label}{transition.workflowId ? ` · ${ui("Approval required")}` : ` · ${ui("Immediate")}`}</span><Button size="sm" variant="outline" onClick={() => transitionRecord.mutate({ transitionKey: transition.key, version: record.version })} disabled={!canEditRecords || transitionRecord.isPending || Boolean(record.pendingTransition) || isTerminalRecord}>{transitionRecord.isPending ? ui("Submitting…") : ui("Run action")}</Button></div>)}{Boolean(record.pendingTransition) && <p className="text-xs text-muted-foreground">{ui("This record is waiting for an approval decision.")}</p>}</div>}
          {record && activeDefinition.context === "CUSTOM" && <div className="space-y-2 border-t pt-4"><p className="text-sm font-medium">{ui("Approval history")}</p>{recordHistory.isLoading && <p className="text-xs text-muted-foreground">{ui("Loading approval history…")}</p>}{recordHistory.isError && <p className="text-xs text-destructive">{ui("Approval history could not be loaded.")}</p>}{recordHistory.data?.map((approval) => <div key={approval.id} className="space-y-2 rounded border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span>{new Date(approval.requestedAt).toLocaleString()}</span><Badge variant="outline">{humanize(approval.status)}</Badge></div>{approval.steps.length > 0 && <p className="text-xs text-muted-foreground">{approval.steps.map((step) => `${step.name}: ${humanize(step.status)}`).join(" · ")}</p>}{approval.resolvedAt && <p className="text-xs text-muted-foreground">{ui("Resolved")}: {new Date(approval.resolvedAt).toLocaleString()}</p>}{approval.resolutionComment && <p className="rounded bg-muted/50 p-2">{approval.resolutionComment}</p>}{approval.decisions.map((decision, index) => <div key={`${decision.createdAt}-${index}`} className="border-t pt-2"><p className="text-xs text-muted-foreground">{decision.approver?.name ?? ui("Approver")} · {new Date(decision.createdAt).toLocaleString()} · {humanize(decision.decision)}</p>{decision.comment && <p className="mt-1">{decision.comment}</p>}</div>)}</div>)}{!recordHistory.isLoading && !recordHistory.isError && !recordHistory.data?.length && <p className="text-xs text-muted-foreground">{ui("No approval history yet.")}</p>}</div>}
        </section>
      </div>}
    </CardContent></Card>}
  </div>;
}
