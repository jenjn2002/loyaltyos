import { memberFieldLabel, ui } from "@/lib/ui-text";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GripVertical, Plus, Save, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";
import type {
  Member,
  PaginatedResponse,
  RuleCondition,
  RuleGroup,
  Segment,
  SegmentMemberCount,
  SegmentType,
} from "@/types";

type FieldValueType = "text" | "number" | "date" | "metadata-date" | "month-day" | "boolean";

interface FieldOption {
  value: string;
  label: string;
  operators: string[];
  valueType: FieldValueType;
}

const BASE_FIELD_OPTIONS: FieldOption[] = [
  { value: "email", label: "Email", operators: ["contains", "eq"], valueType: "text" },
  { value: "phone", label: "Phone", operators: ["contains", "eq"], valueType: "text" },
  { value: "firstName", label: "First Name", operators: ["contains", "eq"], valueType: "text" },
  { value: "lastName", label: "Last Name", operators: ["contains", "eq"], valueType: "text" },
  { value: "department", label: "Department", operators: ["contains", "eq", "neq"], valueType: "text" },
  { value: "status", label: "Status", operators: ["eq", "neq"], valueType: "text" },
  { value: "tags", label: "Tags", operators: ["contains"], valueType: "text" },
  { value: "currentTier", label: "Current Tier", operators: ["eq", "neq"], valueType: "text" },
  { value: "totalSpent", label: "Total Spent", operators: ["gt", "lt", "gte", "lte", "between"], valueType: "number" },
  { value: "joinedAt", label: "Joined At", operators: ["gt", "lt", "between"], valueType: "date" },
  { value: "lastActiveAt", label: "Last Active At", operators: ["gt", "lt", "between"], valueType: "date" },
  { value: "accountAgeDays", label: "Account Age (days)", operators: ["gt", "lt", "gte", "lte", "between"], valueType: "number" },
  { value: "joinedMonthDay", label: "Joined Month / Day", operators: ["eq", "neq"], valueType: "month-day" },
  { value: "todayMonthDay", label: "Today Month / Day", operators: ["eq"], valueType: "month-day" },
];

const OPERATOR_LABELS: Record<string, string> = {
  eq: "equals",
  neq: "not equals",
  gt: "greater than",
  lt: "less than",
  gte: "greater or equal",
  lte: "less or equal",
  in: "in",
  between: "between",
  contains: "contains",
};

interface ConditionRow {
  id: string;
  field: string;
  operator: string;
  value: string;
  value2?: string;
}

interface RuleGroupRow {
  id: string;
  mode: "all" | "any";
  conditions: ConditionRow[];
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function parseMemberIds(value: string | undefined): string[] {
  return Array.from(new Set((value ?? "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)));
}

function parseConditionValue(value: string, fieldDef: FieldOption | undefined): string | number | boolean {
  if (fieldDef?.valueType === "number") return Number(value);
  if (fieldDef?.valueType === "date") return new Date(`${value}T00:00:00.000Z`).getTime();
  if (fieldDef?.valueType === "boolean") return value === "true";
  return value;
}

function displayConditionValue(value: unknown, fieldDef: FieldOption | undefined): string {
  if (fieldDef?.valueType === "date" && typeof value === "number") {
    return new Date(value).toISOString().slice(0, 10);
  }
  return value == null ? "" : String(value);
}

function rowsToRuleGroup(groups: RuleGroupRow[], fieldOptions: FieldOption[]): RuleGroup | undefined {
  const rules = groups
    .filter((g) => g.conditions.length > 0)
    .map((g) => {
      const conditions: RuleCondition[] = g.conditions
        .filter((c) => c.field && c.value)
        .map((c) => {
          const cond: RuleCondition = { field: c.field };
          const fieldDef = fieldOptions.find((field) => field.value === c.field);
          const val = parseConditionValue(c.value, fieldDef);
          if (c.operator === "between" && c.value2) {
            cond.between = [Number(parseConditionValue(c.value, fieldDef)), Number(parseConditionValue(c.value2, fieldDef))];
          } else if (c.operator === "in") {
            cond.in = c.value.split(",").map((s) => s.trim());
          } else {
            (cond as unknown as Record<string, unknown>)[c.operator] = val;
          }
          return cond;
        });
      if (conditions.length === 0) return null;
      const result: RuleGroup = {};
      result[g.mode] = conditions;
      return result;
    })
    .filter(Boolean) as RuleGroup[];

  if (rules.length === 0) return undefined;
  if (rules.length === 1) return rules[0];
  return { all: rules };
}

function ruleGroupToRows(rule: RuleGroup | null, fieldOptions: FieldOption[]): RuleGroupRow[] {
  if (!rule) return [{ id: makeId(), mode: "all", conditions: [] }];
  const groups: RuleGroupRow[] = [];

  const extractGroup = (rg: RuleGroup): void => {
    if (rg.all) {
      groups.push({
        id: makeId(),
        mode: "all",
        conditions: rg.all.map((item) => {
          if ("field" in item) {
            const c = item;
            const op = Object.keys(c).find((k) => k !== "field") ?? "eq";
            const val = c[op as keyof RuleCondition];
            let valueStr = "";
            const fieldDef = fieldOptions.find((field) => field.value === c.field);
            if (op === "between" && Array.isArray(val)) {
              valueStr = displayConditionValue(val[0], fieldDef);
              return {
                id: makeId(),
                field: c.field,
                operator: op,
                value: valueStr,
                value2: displayConditionValue(val[1], fieldDef),
              };
            }
            if (Array.isArray(val)) {
              valueStr = val.map((item) => displayConditionValue(item, fieldDef)).join(", ");
            } else if (val !== undefined && val !== null) {
              valueStr = displayConditionValue(val, fieldDef);
            }
            return { id: makeId(), field: c.field, operator: op, value: valueStr };
          }
          return { id: makeId(), field: "", operator: "eq", value: "" };
        }),
      });
    }
    if (rg.any) {
      groups.push({
        id: makeId(),
        mode: "any",
        conditions: rg.any.map((item) => {
          if ("field" in item) {
            const c = item;
            const op = Object.keys(c).find((k) => k !== "field") ?? "eq";
            const val = c[op as keyof RuleCondition];
            let valueStr = "";
            const fieldDef = fieldOptions.find((field) => field.value === c.field);
            if (op === "between" && Array.isArray(val)) {
              valueStr = displayConditionValue(val[0], fieldDef);
              return {
                id: makeId(),
                field: c.field,
                operator: op,
                value: valueStr,
                value2: displayConditionValue(val[1], fieldDef),
              };
            }
            if (Array.isArray(val)) {
              valueStr = val.map((item) => displayConditionValue(item, fieldDef)).join(", ");
            } else if (val !== undefined && val !== null) {
              valueStr = displayConditionValue(val, fieldDef);
            }
            return { id: makeId(), field: c.field, operator: op, value: valueStr };
          }
          return { id: makeId(), field: "", operator: "eq", value: "" };
        }),
      });
    }
  };

  extractGroup(rule);
  return groups.length > 0 ? groups : [{ id: makeId(), mode: "all", conditions: [] }];
}

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  type: z.enum(["STATIC", "DYNAMIC"]),
  memberIds: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function SegmentBuilderPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<RuleGroupRow[]>([
    { id: makeId(), mode: "all", conditions: [] },
  ]);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const { data: memberFieldDefinitions } = useQuery({
    queryKey: ["member-fields"],
    queryFn: () => fetchApi<{ key: string; label: string; type: string; isActive: boolean }[]>("/admin/member-fields"),
  });
  const fieldOptions = [
    ...BASE_FIELD_OPTIONS,
    ...(memberFieldDefinitions ?? [])
      .filter((field) => field.isActive)
      .map((field) => ({
        value: `metadata.${field.key}`,
        label: memberFieldLabel(field),
        operators: field.type === "NUMBER" ? ["eq", "neq", "gt", "lt", "gte", "lte", "between"] : field.type === "BOOLEAN" || field.type === "SELECT" ? ["eq", "neq", "in"] : field.type === "DATE" ? ["eq", "neq"] : ["contains", "eq", "neq", "in"],
        valueType: (field.type === "NUMBER" ? "number" : field.type === "BOOLEAN" ? "boolean" : field.type === "DATE" ? "metadata-date" : "text") as FieldValueType,
      })),
  ];

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "", type: "DYNAMIC", memberIds: "" },
  });

  const segmentType = form.watch("type");
  const memberIdsValue = form.watch("memberIds") ?? "";
  const selectedMemberIds = useMemo(() => new Set(parseMemberIds(memberIdsValue)), [memberIdsValue]);
  const [memberSearch, setMemberSearch] = useState("");
  const [debouncedMemberSearch, setDebouncedMemberSearch] = useState("");
  const [memberDepartment, setMemberDepartment] = useState("");
  const [memberStatus, setMemberStatus] = useState<"ACTIVE" | "INACTIVE" | "">("ACTIVE");
  const [memberPage, setMemberPage] = useState(1);
  const [selectingAllMembers, setSelectingAllMembers] = useState(false);
  const memberSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (memberSearchTimer.current) clearTimeout(memberSearchTimer.current);
    memberSearchTimer.current = setTimeout(() => {
      setDebouncedMemberSearch(memberSearch);
      setMemberPage(1);
    }, 300);
    return () => {
      if (memberSearchTimer.current) clearTimeout(memberSearchTimer.current);
    };
  }, [memberSearch]);

  const { data: memberPicker, isLoading: loadingMembers } = useQuery({
    queryKey: ["segment-member-picker", memberPage, debouncedMemberSearch, memberStatus, memberDepartment],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(memberPage));
      params.set("pageSize", "100");
      if (debouncedMemberSearch) params.set("search", debouncedMemberSearch);
      if (memberStatus) params.set("status", memberStatus);
      if (memberDepartment) params.set("department", memberDepartment);
      return fetchApi<PaginatedResponse<Member>>(`/members?${params.toString()}`);
    },
    enabled: segmentType === "STATIC",
  });

  const visibleMembers = memberPicker?.items ?? [];
  const allVisibleSelected =
    visibleMembers.length > 0 && visibleMembers.every((member) => selectedMemberIds.has(member.id));
  const someVisibleSelected = visibleMembers.some((member) => selectedMemberIds.has(member.id));

  function applySelectedMemberIds(next: Set<string>): void {
    form.setValue("memberIds", Array.from(next).join("\n"), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function toggleMember(memberId: string, checked: boolean): void {
    const next = new Set(selectedMemberIds);
    if (checked) next.add(memberId);
    else next.delete(memberId);
    applySelectedMemberIds(next);
  }

  function toggleVisibleMembers(checked: boolean): void {
    const next = new Set(selectedMemberIds);
    for (const member of visibleMembers) {
      if (checked) next.add(member.id);
      else next.delete(member.id);
    }
    applySelectedMemberIds(next);
  }

  async function selectAllMatchingMembers(): Promise<void> {
    if (!memberPicker || memberPicker.total === 0) return;
    setSelectingAllMembers(true);
    setError(null);
    try {
      const next = new Set(selectedMemberIds);
      for (let page = 1; page <= memberPicker.totalPages; page += 1) {
        if (page === memberPage) {
          for (const member of visibleMembers) next.add(member.id);
          continue;
        }
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", "100");
        if (debouncedMemberSearch) params.set("search", debouncedMemberSearch);
        if (memberStatus) params.set("status", memberStatus);
        if (memberDepartment) params.set("department", memberDepartment);
        const response = await fetchApi<PaginatedResponse<Member>>(`/members?${params.toString()}`);
        for (const member of response.items) next.add(member.id);
      }
      applySelectedMemberIds(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : ui("Failed to load members."));
    } finally {
      setSelectingAllMembers(false);
    }
  }

  const { data: segmentData } = useQuery({
    queryKey: ["segment", id],
    queryFn: () => fetchApi<Segment>(`/admin/segments/${String(id)}`),
    enabled: isEdit && Boolean(id),
  });

  // Pre-fill form when editing
  const [prefilled, setPrefilled] = useState(false);
  if (isEdit && segmentData && memberFieldDefinitions !== undefined && !prefilled) {
    setPrefilled(true);
    form.reset({
      name: segmentData.name,
      description: segmentData.description ?? "",
      type: segmentData.type,
      memberIds: segmentData.memberIds.join("\n"),
    });
    if (segmentData.type === "DYNAMIC") {
      setGroups(ruleGroupToRows(segmentData.rules, fieldOptions));
    }
  }

  const addCondition = (groupId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              conditions: [...g.conditions, { id: makeId(), field: "", operator: "eq", value: "" }],
            }
          : g,
      ),
    );
  };

  const removeCondition = (groupId: string, condId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, conditions: g.conditions.filter((c) => c.id !== condId) } : g,
      ),
    );
  };

  const updateCondition = (
    groupId: string,
    condId: string,
    field: keyof ConditionRow,
    value: string,
  ) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              conditions: g.conditions.map((c) =>
                c.id === condId
                  ? { ...c, [field]: value, ...(field === "field" ? { operator: "eq" } : {}) }
                  : c,
              ),
            }
          : g,
      ),
    );
  };

  const addGroup = () => {
    setGroups((prev) => [
      ...prev,
      {
        id: makeId(),
        mode: "all",
        conditions: [{ id: makeId(), field: "", operator: "eq", value: "" }],
      },
    ]);
  };

  const removeGroup = (groupId: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
  };

  const toggleGroupMode = (groupId: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, mode: g.mode === "all" ? "any" : "all" } : g)),
    );
  };

  const handleEstimate = async () => {
    setCounting(true);
    try {
      const rules = rowsToRuleGroup(groups, fieldOptions);
      const res = await fetchApi<SegmentMemberCount>("/admin/segments/estimate", {
        method: "POST",
        body: JSON.stringify({ rules }),
      });
      setMemberCount(res.count);
    } catch {
      // ignore
    } finally {
      setCounting(false);
    }
  };

  const handleSave = async () => {
    const valid = await form.trigger();
    if (!valid) return;

    setSaving(true);
    setError(null);
    try {
      const values = form.getValues();
      const rules = values.type === "DYNAMIC" ? rowsToRuleGroup(groups, fieldOptions) : undefined;
      const selectedIds = values.type === "STATIC" ? parseMemberIds(values.memberIds) : [];
      if (values.type === "STATIC" && selectedIds.length === 0) {
        setError(ui("Select at least one member."));
        setSaving(false);
        return;
      }
      const memberIds = values.type === "STATIC" ? selectedIds : undefined;

      const payload = {
        name: values.name,
        description: values.description,
        type: values.type,
        rules,
        memberIds,
      };

      if (isEdit) {
        await fetchApi(`/admin/segments/${String(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await fetchApi("/admin/segments", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["segments"] });
      navigate("/segments");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save segment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            navigate("/segments");
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />{ui("Back")}</Button>
        <h1 className="text-3xl font-bold">{isEdit ? "Edit Segment" : "New Segment"}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{ui("Segment Details")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">{ui("Name")}</Label>
              <Input id="name" {...form.register("name")} placeholder={ui("e.g. High Spenders")} />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{ui("Type")}</Label>
              <Tabs
                value={segmentType}
                onValueChange={(v) => {
                  form.setValue("type", v as SegmentType);
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="DYNAMIC" className="flex-1">{ui("Dynamic")}</TabsTrigger>
                  <TabsTrigger value="STATIC" className="flex-1">{ui("Static")}</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">{ui("Description")}</Label>
            <Textarea
              id="desc"
              {...form.register("description")}
              placeholder={ui("Describe this segment...")}
            />
          </div>
        </CardContent>
      </Card>

      {segmentType === "DYNAMIC" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{ui("Rule Builder")}</CardTitle>
              <CardDescription>{ui("Define conditions that members must match.")}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void handleEstimate();
                }}
                disabled={counting}
              >
                <Users className="mr-2 h-4 w-4" />
                {counting
                  ? "Counting..."
                  : memberCount != null
                    ? `${String(memberCount)} members`
                    : "Estimate Count"}
              </Button>
              <Button variant="outline" size="sm" onClick={addGroup}>
                <Plus className="mr-2 h-4 w-4" />{ui("Add Group")}</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Accordion type="multiple" defaultValue={groups.map((g) => g.id)}>
              {groups.map((group, gi) => (
                <AccordionItem key={group.id} value={group.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs font-bold uppercase"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleGroupMode(group.id);
                        }}
                      >
                        {group.mode === "all" ? "AND" : "OR"}
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {ui("Group")} {gi + 1} —{" "}
                        {group.mode === "all"
                          ? ui("All conditions must match")
                          : ui("Any condition must match")}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 px-1 pt-2">
                    {group.conditions.map((cond) => {
                      const fieldDef = fieldOptions.find((f) => f.value === cond.field);
                      const operators = fieldDef?.operators ?? ["eq"];
                      const calendarField = fieldDef?.valueType === "date" || fieldDef?.valueType === "metadata-date";

                      return (
                        <div key={cond.id} className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                          <Select
                            value={cond.field}
                            onValueChange={(v) => {
                              updateCondition(group.id, cond.id, "field", v);
                            }}
                          >
                            <SelectTrigger className="w-36">
                              <SelectValue placeholder={ui("Field...")} />
                            </SelectTrigger>
                            <SelectContent>
                              {fieldOptions.map((f) => (
                                <SelectItem key={f.value} value={f.value}>
                                  {ui(f.label)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={cond.operator}
                            onValueChange={(v) => {
                              updateCondition(group.id, cond.id, "operator", v);
                            }}
                          >
                            <SelectTrigger className="w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {operators.map((op) => (
                                <SelectItem key={op} value={op}>
                                  {ui(OPERATOR_LABELS[op] ?? op)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            className="flex-1"
                            placeholder={ui("Value")}
                            type={calendarField ? "date" : "text"}
                            value={cond.value}
                            onChange={(e) => {
                              updateCondition(group.id, cond.id, "value", e.target.value);
                            }}
                          />
                          {cond.operator === "between" && (
                            <Input
                              className="w-24"
                              placeholder={ui("To")}
                              type={calendarField ? "date" : "text"}
                              value={cond.value2 ?? ""}
                              onChange={(e) => {
                                setGroups((prev) =>
                                  prev.map((g) =>
                                    g.id === group.id
                                      ? {
                                          ...g,
                                          conditions: g.conditions.map((c) =>
                                            c.id === cond.id ? { ...c, value2: e.target.value } : c,
                                          ),
                                        }
                                      : g,
                                  ),
                                );
                              }}
                            />
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => {
                              removeCondition(group.id, cond.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        addCondition(group.id);
                      }}
                    >
                      <Plus className="mr-2 h-3 w-3" />{ui("Add Condition")}</Button>
                    {groups.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-2 text-destructive"
                        onClick={() => {
                          removeGroup(group.id);
                        }}
                      >
                        <Trash2 className="mr-2 h-3 w-3" />{ui("Remove Group")}</Button>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {segmentType === "STATIC" && (
        <Card>
          <CardHeader>
            <CardTitle>{ui("Select members")}</CardTitle>
            <CardDescription>
              {ui("Choose members for this static segment. Search and filter without losing selections.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <Input
                value={memberSearch}
                onChange={(event) => setMemberSearch(event.target.value)}
                placeholder={ui("Search name, email, external ID or member ID")}
              />
              <Select
                value={memberStatus || "ALL"}
                onValueChange={(value) => {
                  setMemberStatus(value === "ALL" ? "" : (value as "ACTIVE" | "INACTIVE"));
                  setMemberPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={ui("Status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{ui("All statuses")}</SelectItem>
                  <SelectItem value="ACTIVE">{ui("ACTIVE")}</SelectItem>
                  <SelectItem value="INACTIVE">{ui("INACTIVE")}</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={memberDepartment}
                onChange={(event) => {
                  setMemberDepartment(event.target.value);
                  setMemberPage(1);
                }}
                placeholder={ui("Department")}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selectingAllMembers || !memberPicker?.total}
                  onClick={() => {
                    void selectAllMatchingMembers();
                  }}
                >
                  {selectingAllMembers ? ui("Loading...") : ui("Select all search results")}
                  {memberPicker?.total ? ` (${String(memberPicker.total)})` : ""}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={selectedMemberIds.size === 0}
                  onClick={() => applySelectedMemberIds(new Set())}
                >
                  {ui("Clear selected members")}
                </Button>
              </div>
              <span className="text-sm text-muted-foreground">
                {String(selectedMemberIds.size)} {ui("selected")}
              </span>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label={ui("Select all visible members")}
                        checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                        onCheckedChange={(checked) => toggleVisibleMembers(checked === true)}
                      />
                    </TableHead>
                    <TableHead>{ui("Name")}</TableHead>
                    <TableHead>{ui("Email")}</TableHead>
                    <TableHead>{ui("Department")}</TableHead>
                    <TableHead>{ui("Status")}</TableHead>
                    <TableHead>{ui("Member ID")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingMembers ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <TableRow key={index}>
                        <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      </TableRow>
                    ))
                  ) : visibleMembers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {ui("No members found.")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleMembers.map((member) => {
                      const name = [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email || member.id;
                      return (
                        <TableRow key={member.id}>
                          <TableCell>
                            <Checkbox
                              aria-label={`${ui("Select member")} ${member.id}`}
                              checked={selectedMemberIds.has(member.id)}
                              onCheckedChange={(checked) => toggleMember(member.id, checked === true)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{name}</TableCell>
                          <TableCell>{member.email}</TableCell>
                          <TableCell>{member.department || "—"}</TableCell>
                          <TableCell>{member.status ? ui(member.status) : "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{member.id}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                {memberPicker?.total ? `${String(memberPicker.total)} ${ui("members")}` : ui("No members found.")}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={memberPage <= 1 || loadingMembers}
                  onClick={() => setMemberPage((page) => Math.max(1, page - 1))}
                >
                  {ui("Previous")}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {ui("Page")} {String(memberPage)} {ui("of")} {String(memberPicker?.totalPages ?? 1)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={memberPage >= (memberPicker?.totalPages ?? 1) || loadingMembers}
                  onClick={() => setMemberPage((page) => page + 1)}
                >
                  {ui("Next")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        onClick={() => {
          void handleSave();
        }}
        disabled={saving}
        size="lg"
      >
        <Save className="mr-2 h-4 w-4" />
        {saving ? "Saving..." : isEdit ? ui("Update Segment") : ui("Create Segment")}
      </Button>
    </div>
  );
}
