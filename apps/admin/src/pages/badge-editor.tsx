import { ui } from "@/lib/ui-text";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Award, GripVertical, Plus, Save, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";

const badgeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  type: z.enum(["ACHIEVEMENT", "STATUS", "TEMPORAL", "COLLECTIBLE", "SOCIAL"]),
  imageUrl: z.string().optional(),
  conditions: z.string().optional(),
  seriesId: z.string().optional(),
  seriesPosition: z.coerce.number().int().min(1).optional(),
  isActive: z.boolean().default(true),
});

type BadgeFormData = z.infer<typeof badgeSchema>;

interface BadgeDetail {
  id: string;
  name: string;
  description?: string;
  type: string;
  imageUrl?: string;
  tierId?: string;
  conditions?: unknown;
  seriesId?: string;
  seriesPosition?: number;
  isActive: boolean;
}

const BADGE_TYPES = [
  { value: "ACHIEVEMENT", label: "Achievement", desc: "Unlocked by meeting specific criteria" },
  { value: "STATUS", label: "Status", desc: "Reflects a member's current status" },
  { value: "TEMPORAL", label: "Temporal", desc: "Available for a limited time" },
  { value: "COLLECTIBLE", label: "Collectible", desc: "Part of a collectible series" },
  { value: "SOCIAL", label: "Social", desc: "Earned through social or community actions" },
];

type ConditionValueType = "text" | "number";

interface ConditionFieldOption {
  value: string;
  label: string;
  operators: string[];
  valueType: ConditionValueType;
}

interface ConditionRow {
  id: string;
  field: string;
  operator: string;
  value: string;
  eventType?: string;
}

interface EventWindowDraft {
  eventType: string;
  days: string;
  minimum: string;
}

const CONDITION_FIELDS: ConditionFieldOption[] = [
  { value: "totalEarned", label: "Total points earned", operators: ["gte", "gt", "eq", "lte", "lt"], valueType: "number" },
  { value: "totalSpent", label: "Total points spent", operators: ["gte", "gt", "eq", "lte", "lt"], valueType: "number" },
  { value: "totalRedeemed", label: "Total points redeemed", operators: ["gte", "gt", "eq", "lte", "lt"], valueType: "number" },
  { value: "currentBalance", label: "Current balance", operators: ["gte", "gt", "eq", "lte", "lt"], valueType: "number" },
  { value: "daysSinceJoined", label: "Days since joined", operators: ["gte", "gt", "eq", "lte", "lt"], valueType: "number" },
  { value: "daysSinceLastEvent", label: "Days since last activity", operators: ["gte", "gt", "eq", "lte", "lt"], valueType: "number" },
  { value: "eventCounts", label: "Event count (all time)", operators: ["gte", "gt", "eq", "lte", "lt"], valueType: "number" },
  { value: "currentTier", label: "Current tier", operators: ["eq", "neq"], valueType: "text" },
  { value: "tags", label: "Member tag", operators: ["contains"], valueType: "text" },
  { value: "email", label: "Email", operators: ["contains", "eq"], valueType: "text" },
  { value: "phone", label: "Phone", operators: ["contains", "eq"], valueType: "text" },
];

const CONDITION_OPERATOR_LABELS: Record<string, string> = {
  eq: "equals",
  neq: "not equals",
  gt: "greater than",
  lt: "less than",
  gte: "greater or equal",
  lte: "less or equal",
  contains: "contains",
};

function makeConditionId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function parseConditionValue(value: string, field: ConditionFieldOption | undefined): string | number {
  return field?.valueType === "number" ? Number(value) : value;
}

function rowsToConditions(
  rows: ConditionRow[],
  logic: "all" | "any",
): Record<string, unknown> | undefined {
  const conditions = rows
    .filter((row) => row.field && row.value.trim() !== "")
    .map((row): Record<string, unknown> | null => {
      const field = CONDITION_FIELDS.find((item) => item.value === row.field);
      const value = parseConditionValue(row.value.trim(), field);
      if (typeof value === "number" && !Number.isFinite(value)) return null;
      const conditionField = row.field === "eventCounts"
        ? `eventCounts.${row.eventType?.trim() ?? ""}`
        : row.field;
      if (row.field === "eventCounts" && !row.eventType?.trim()) return null;
      return { field: conditionField, [row.operator]: value };
    })
    .filter((condition): condition is Record<string, unknown> => condition !== null);

  if (conditions.length === 0) return undefined;
  return { [logic]: conditions };
}

function buildBadgeConditions(
  rows: ConditionRow[],
  logic: "all" | "any",
  eventWindow: EventWindowDraft,
  recentActivityDays: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = rowsToConditions(rows, logic) ?? {};
  const eventDays = Number(eventWindow.days);
  const eventMinimum = Number(eventWindow.minimum);
  if (eventWindow.eventType.trim() && Number.isFinite(eventDays) && eventDays > 0 && Number.isFinite(eventMinimum) && eventMinimum > 0) {
    result.count_in_window = {
      eventType: eventWindow.eventType.trim(),
      days: eventDays,
      gte: eventMinimum,
    };
  }
  const recentDays = Number(recentActivityDays);
  if (Number.isFinite(recentDays) && recentDays > 0) {
    result.within = { days: recentDays };
  }
  return result;
}

function parseConditionRows(raw: unknown): {
  logic: "all" | "any";
  rows: ConditionRow[];
  eventWindow: EventWindowDraft;
  recentActivityDays: string;
} {
  const empty = {
    logic: "all" as const,
    rows: [] as ConditionRow[],
    eventWindow: { eventType: "", days: "30", minimum: "1" },
    recentActivityDays: "",
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const source = raw as Record<string, unknown>;
  const logic: "all" | "any" = Array.isArray(source.any) && !Array.isArray(source.all) ? "any" : "all";
  const items = Array.isArray(source[logic]) ? source[logic] : [];
  const rows: ConditionRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const condition = item as Record<string, unknown>;
    const field = typeof condition.field === "string" ? condition.field : "";
    if (!field) continue;
    const eventMatch = field.match(/^eventCounts\.(.+)$/);
    const selectedField = eventMatch ? "eventCounts" : field;
    if (!CONDITION_FIELDS.some((option) => option.value === selectedField)) continue;
    const operator = Object.keys(condition).find((key) => key !== "field") ?? "eq";
    const value = condition[operator];
    rows.push({
      id: makeConditionId(),
      field: selectedField,
      operator,
      value: value == null ? "" : String(value),
      eventType: eventMatch?.[1] ?? "",
    });
  }
  const windowValue = source.count_in_window;
  const eventWindow = { ...empty.eventWindow };
  if (windowValue && typeof windowValue === "object" && !Array.isArray(windowValue)) {
    const window = windowValue as Record<string, unknown>;
    eventWindow.eventType = typeof window.eventType === "string" ? window.eventType : "";
    eventWindow.days = window.days == null ? "30" : String(window.days);
    eventWindow.minimum = String(window.gte ?? window.min ?? 1);
  }
  const within = source.within;
  const recentActivityDays = within && typeof within === "object" && !Array.isArray(within)
    ? String((within as Record<string, unknown>).days ?? "")
    : "";
  return { logic, rows, eventWindow, recentActivityDays };
}

function imageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Unsupported image type"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error("Image must be 5 MB or smaller"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read image"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Unable to decode image"));
      image.onload = () => {
        const maxDimension = 512;
        const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
        const scale = longestSide > maxDimension ? maxDimension / longestSide : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Unable to process image"));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Unable to encode image"));
            return;
          }
          const output = new FileReader();
          output.onerror = () => reject(new Error("Unable to encode image"));
          output.onload = () => resolve(String(output.result));
          output.readAsDataURL(blob);
        }, "image/jpeg", 0.82);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function BadgeEditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: badge, isLoading } = useQuery({
    queryKey: ["badge", id],
    queryFn: () => fetchApi<BadgeDetail>(`/admin/badges/${id ?? ""}`),
    enabled: isEditing,
  });

  const form = useForm<BadgeFormData>({
    resolver: zodResolver(badgeSchema),
    defaultValues: {
      name: "",
      description: "",
      type: "ACHIEVEMENT",
      imageUrl: "",
      conditions: "{}",
      seriesId: "",
      isActive: true,
    },
  });

  const [conditionLogic, setConditionLogic] = useState<"all" | "any">("all");
  const [conditionRows, setConditionRows] = useState<ConditionRow[]>([]);
  const [eventWindow, setEventWindow] = useState<EventWindowDraft>({
    eventType: "",
    days: "30",
    minimum: "1",
  });
  const [recentActivityDays, setRecentActivityDays] = useState("");
  const [imageError, setImageError] = useState<string | null>(null);

  // Load existing badge data into form
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (badge && badge.id !== loadedId) {
    const parsedConditions = parseConditionRows(badge.conditions);
    setLoadedId(badge.id);
    setConditionLogic(parsedConditions.logic);
    setConditionRows(parsedConditions.rows);
    setEventWindow(parsedConditions.eventWindow);
    setRecentActivityDays(parsedConditions.recentActivityDays);
    form.reset({
      name: badge.name,
      description: badge.description ?? "",
      type: badge.type as BadgeFormData["type"],
      imageUrl: badge.imageUrl ?? "",
      conditions: badge.conditions ? JSON.stringify(badge.conditions, null, 2) : "{}",
      seriesId: badge.seriesId ?? "",
      seriesPosition: badge.seriesPosition ?? undefined,
      isActive: badge.isActive,
    });
  }

  const syncVisualConditions = (
    rows: ConditionRow[],
    logic: "all" | "any",
    nextEventWindow: EventWindowDraft = eventWindow,
    nextRecentActivityDays = recentActivityDays,
  ) => {
    const conditions = buildBadgeConditions(rows, logic, nextEventWindow, nextRecentActivityDays);
    form.setValue("conditions", JSON.stringify(conditions, null, 2), { shouldDirty: true });
  };

  const updateConditionRow = (id: string, update: Partial<ConditionRow>) => {
    const nextRows = conditionRows.map((row) => (row.id === id ? { ...row, ...update } : row));
    setConditionRows(nextRows);
    syncVisualConditions(nextRows, conditionLogic);
  };

  const onSubmit = async (data: BadgeFormData) => {
    let conditions: unknown = {};
    try {
      conditions = JSON.parse(data.conditions ?? "{}");
    } catch {
      // Keep as string
    }

    const payload = {
      ...data,
      conditions,
      conditionsStr: undefined,
    };

    if (isEditing) {
      await fetchApi(`/admin/badges/${id ?? ""}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await fetchApi("/admin/badges", {
        method: "POST",
        body: JSON.stringify({ ...payload, isActive: undefined }),
      });
    }
    void queryClient.invalidateQueries({ queryKey: ["badges"] });
    navigate("/badges");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            navigate("/badges");
          }}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-3xl font-bold">{isEditing ? "Edit Badge" : "New Badge"}</h1>
      </div>

      {isEditing && isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            void form.handleSubmit(onSubmit)(e);
          }}
          className="space-y-6"
        >
          <Card>
            <CardHeader>
              <CardTitle>{ui("Badge Details")}</CardTitle>
              <CardDescription>{ui("Configure the badge name, type, and appearance.")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{ui("Name *")}</Label>
                  <Input id="name" {...form.register("name")} placeholder={ui("e.g. First Purchase")} />
                  {form.formState.errors.name && (
                    <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">{ui("Type *")}</Label>
                  <Select
                    value={form.watch("type")}
                    onValueChange={(v) => {
                      form.setValue("type", v as BadgeFormData["type"]);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BADGE_TYPES.map((bt) => (
                        <SelectItem key={bt.value} value={bt.value}>
                          {ui(bt.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">{ui("Description")}</Label>
                <Textarea
                  id="description"
                  {...form.register("description")}
                  placeholder={ui("Brief description of this badge")}
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="imageFile" className="flex items-center gap-2">
                    <Upload className="h-4 w-4" />{ui("Badge image")}
                  </Label>
                  <input type="hidden" {...form.register("imageUrl")} />
                  <Input
                    id="imageFile"
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setImageError(null);
                      void imageFileToDataUrl(file)
                        .then((imageUrl) => {
                          form.setValue("imageUrl", imageUrl, { shouldDirty: true });
                        })
                        .catch((error: unknown) => {
                          setImageError(error instanceof Error ? error.message : ui("Unable to upload image"));
                          event.currentTarget.value = "";
                        });
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    {isEditing && form.watch("imageUrl")
                      ? ui("Choose a new image to replace the current one. Existing images are kept until you save.")
                      : ui("Upload a JPG, PNG, GIF or WebP image. Images are resized automatically.")}
                  </p>
                  {imageError && <p className="text-xs text-destructive">{imageError}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seriesId">{ui("Series ID")}</Label>
                  <Input
                    id="seriesId"
                    {...form.register("seriesId")}
                    placeholder={ui("e.g. mega-saver")}
                  />
                </div>
              </div>
              {form.watch("seriesId") && (
                <div className="space-y-2">
                  <Label htmlFor="seriesPosition">{ui("Series Position")}</Label>
                  <Input
                    id="seriesPosition"
                    type="number"
                    {...form.register("seriesPosition")}
                    placeholder="1"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{ui("Conditions")}</CardTitle>
              <CardDescription>
                {ui("Define when this badge is awarded. Add point, member, tier, tag, or activity conditions. Leave empty for manually-awarded badges.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <input type="hidden" {...form.register("conditions")} />
              <div className="flex flex-wrap items-center gap-3">
                <Label>{ui("Match conditions")}</Label>
                <Select
                  value={conditionLogic}
                  onValueChange={(value) => {
                    const logic = value as "all" | "any";
                    setConditionLogic(logic);
                    syncVisualConditions(conditionRows, logic);
                  }}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{ui("All conditions (AND)")}</SelectItem>
                    <SelectItem value="any">{ui("Any condition (OR)")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                {conditionRows.map((condition) => {
                  const field = CONDITION_FIELDS.find((option) => option.value === condition.field);
                  const operators = field?.operators ?? ["eq"];
                  return (
                    <div key={condition.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                      <Select
                        value={condition.field}
                        onValueChange={(value) => {
                          updateConditionRow(condition.id, {
                            field: value,
                            operator: CONDITION_FIELDS.find((option) => option.value === value)?.operators[0] ?? "eq",
                            value: "",
                            eventType: "",
                          });
                        }}
                      >
                        <SelectTrigger className="w-52">
                          <SelectValue placeholder={ui("Field...")} />
                        </SelectTrigger>
                        <SelectContent>
                          {CONDITION_FIELDS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {ui(option.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {condition.field === "eventCounts" && (
                        <Input
                          className="w-36"
                          placeholder={ui("Event name")}
                          value={condition.eventType ?? ""}
                          onChange={(event) => {
                            updateConditionRow(condition.id, { eventType: event.target.value });
                          }}
                        />
                      )}
                      <Select
                        value={condition.operator}
                        onValueChange={(value) => {
                          updateConditionRow(condition.id, { operator: value });
                        }}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {operators.map((operator) => (
                            <SelectItem key={operator} value={operator}>
                              {ui(CONDITION_OPERATOR_LABELS[operator] ?? operator)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        className="min-w-32 flex-1"
                        type={field?.valueType === "number" ? "number" : "text"}
                        placeholder={ui("Value")}
                        value={condition.value}
                        onChange={(event) => {
                          updateConditionRow(condition.id, { value: event.target.value });
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => {
                          const nextRows = conditionRows.filter((row) => row.id !== condition.id);
                          setConditionRows(nextRows);
                          syncVisualConditions(nextRows, conditionLogic);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const nextRows = [
                      ...conditionRows,
                      {
                        id: makeConditionId(),
                        field: "totalEarned",
                        operator: "gte",
                        value: "",
                      },
                    ];
                    setConditionRows(nextRows);
                    syncVisualConditions(nextRows, conditionLogic);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />{ui("Add condition")}
                </Button>
              </div>

              {isEditing && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.watch("isActive")}
                    onCheckedChange={(v) => {
                      form.setValue("isActive", v);
                    }}
                  />
                  <Label>{ui("Active")}</Label>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{ui("Preview")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 rounded-lg border p-6">
                {form.watch("imageUrl") ? (
                  <img
                    src={form.watch("imageUrl")}
                    alt=""
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <Award className="h-16 w-16 text-muted-foreground" />
                )}
                <div>
                  <p className="text-lg font-semibold">{form.watch("name") || "Badge Name"}</p>
                  <p className="text-sm text-muted-foreground">
                    {form.watch("description") ?? ui("No description")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Type: {form.watch("type")}
                    {form.watch("seriesId") &&
                      ` · Series: ${String(form.watch("seriesId"))} #${String(form.watch("seriesPosition") ?? "-")}`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button type="submit">
              <Save className="mr-2 h-4 w-4" />
              {isEditing ? ui("Update Badge") : ui("Create Badge")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                navigate("/badges");
              }}
            >{ui("Cancel")}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
