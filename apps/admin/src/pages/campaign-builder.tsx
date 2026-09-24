import { ui } from "@/lib/ui-text";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { cn } from "@/lib/utils";
import type { Campaign, CampaignEstimate, PaginatedResponse, Segment } from "@/types";

const CHANNELS = ["EMAIL", "SMS", "PUSH", "IN_APP", "WEBHOOK"] as const;

const ANY_EVENT_VALUE = "__any_event__";

const DEFAULT_VARIANTS = [
  { name: "A", trafficPct: 50 },
  { name: "B", trafficPct: 50 },
];

const variantSchema = z.object({
  name: z.string().min(1),
  trafficPct: z.coerce.number().min(0).max(100),
  config: z.record(z.unknown()).optional(),
});

const wizardSchema = z.object({
  pointTypeId: z.string().min(1, "Point type is required"),
  // The current campaign engine issues fixed Bonus Points. Keep this as an
  // internal compatibility field while policy is defined by the trigger event.
  type: z.literal("BONUS_POINTS"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  segmentId: z.string().optional(),
  eventType: z.string().max(80).optional(),
  issuancePolicy: z.enum(["STANDING", "APPROVAL_REQUIRED"]),
  issuanceMode: z.enum(["AUTO", "CLAIM"]),
  justification: z.string().max(2000).optional(),
  maxUsesPerMember: z.coerce.number().int().min(0).optional(),
  multiplier: z.coerce.number().min(0).optional(),
  maxBudget: z
    .union([z.literal(""), z.coerce.number().int().min(0)])
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
  isStackable: z.boolean().optional(),
  abTesting: z.boolean().optional(),
  variants: z.array(variantSchema).optional(),
  channels: z.array(z.string()).optional(),
  scheduleMode: z.enum(["AUTOMATIC_AFTER_APPROVAL", "SPECIFIC_DATE"]),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

type WizardData = z.infer<typeof wizardSchema>;

function numericValue(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const STEPS = ["Policy", "Audience", "Rules", "Channels", "Dates", "Review"];

export function CampaignBuilderPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<WizardData>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      pointTypeId: "",
      type: "BONUS_POINTS",
      name: "",
      description: "",
      eventType: "",
      issuancePolicy: "STANDING",
      issuanceMode: "AUTO",
      multiplier: 1,
      isStackable: false,
      abTesting: false,
      variants: DEFAULT_VARIANTS,
      channels: [],
      scheduleMode: "AUTOMATIC_AFTER_APPROVAL",
    },
  });

  const { data: segmentsData } = useQuery({
    queryKey: ["segments-list"],
    queryFn: () => fetchApi<PaginatedResponse<Segment>>("/admin/segments?pageSize=100"),
  });

  const { data: eventDefinitions } = useQuery({
    queryKey: ["event-definitions", "campaign-builder"],
    queryFn: () => fetchApi<{ key: string; name: string; isActive: boolean; automation: { mode: string; dateField?: string; leapDayPolicy?: string } }[]>("/admin/event-definitions"),
  });

  const { data: pointTypes } = useQuery({
    queryKey: ["point-types", "campaign-builder"],
    queryFn: () =>
      fetchApi<
        {
          id: string;
          code: string;
          name: string;
          isActive: boolean;
          archivedAt: string | null;
        }[]
      >("/admin/point-types"),
  });
  const activePointTypes = useMemo(
    () => (pointTypes ?? []).filter((pointType) => pointType.isActive && !pointType.archivedAt),
    [pointTypes],
  );

  const { data: existingCampaign } = useQuery({
    queryKey: ["campaign", id],
    queryFn: () => fetchApi<Campaign>(`/admin/campaigns/${id ?? ""}`),
    enabled: isEdit,
  });

  const selectedEventType = form.watch("eventType")?.trim() ?? "";
  const eventOptions = useMemo(() => {
    const options = new Map<string, { key: string; name: string }>();
    for (const event of eventDefinitions ?? []) {
      if (event.isActive) options.set(event.key, { key: event.key, name: event.name });
    }
    // Keep an existing campaign selectable even if its definition was archived later.
    if (selectedEventType && !options.has(selectedEventType)) {
      options.set(selectedEventType, { key: selectedEventType, name: `${selectedEventType} (inactive)` });
    }
    return Array.from(options.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [eventDefinitions, selectedEventType]);

  const isPurchaseTrigger = !selectedEventType || selectedEventType.toLowerCase() === "purchase";
  const selectedDefinition = eventDefinitions?.find((event) => event.key === selectedEventType);

  useEffect(() => {
    if (existingCampaign) {
      form.reset({
        pointTypeId: existingCampaign.pointTypeId ?? "",
        type: "BONUS_POINTS",
        name: existingCampaign.name,
        description: existingCampaign.description ?? "",
        segmentId: existingCampaign.segmentId ?? undefined,
        eventType: existingCampaign.eventType ?? "",
        issuancePolicy: existingCampaign.issuancePolicy ?? (existingCampaign.approvalStatus === "NOT_REQUIRED" ? "STANDING" : "APPROVAL_REQUIRED"),
        issuanceMode: existingCampaign.issuanceMode ?? "AUTO",
        justification: existingCampaign.justification ?? "",
        multiplier: existingCampaign.multiplier,
        maxBudget: existingCampaign.maxBudget && existingCampaign.maxBudget > 0 ? existingCampaign.maxBudget : undefined,
        maxUsesPerMember: existingCampaign.maxUsesPerMember ?? undefined,
        isStackable: existingCampaign.isStackable,
        abTesting: existingCampaign.abTesting,
        variants: existingCampaign.variants?.map((variant) => ({
          name: variant.name,
          trafficPct: variant.trafficPct,
          config: variant.config && typeof variant.config === "object" ? variant.config as Record<string, unknown> : undefined,
        })) ?? DEFAULT_VARIANTS,
        channels: [],
        scheduleMode: existingCampaign.startsAt || existingCampaign.endsAt ? "SPECIFIC_DATE" : "AUTOMATIC_AFTER_APPROVAL",
        startsAt: existingCampaign.startsAt?.slice(0, 16) ?? "",
        endsAt: existingCampaign.endsAt?.slice(0, 16) ?? "",
      });
    } else if (!isEdit && !form.getValues("pointTypeId") && activePointTypes[0]) {
      form.setValue("pointTypeId", activePointTypes[0].id);
    }
  }, [activePointTypes, existingCampaign, form, isEdit]);

  const [estimate, setEstimate] = useState<CampaignEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  const selectedPolicy = form.watch("issuancePolicy");
  const variants = form.watch("variants") ?? [];
  const variantTotal = variants.reduce((sum, variant) => sum + (numericValue(variant.trafficPct) ?? 0), 0);
  const selectedPolicyLabel = selectedPolicy === "APPROVAL_REQUIRED"
    ? ui("Approval required")
    : ui("Standing campaign");
  const selectedMode = selectedDefinition?.automation.mode;
  const standingPolicyAllowed = !selectedDefinition || selectedDefinition.key.toLowerCase() === "purchase" || ["ONBOARDING", "MEMBER_DATE_ANNUAL", "ANNIVERSARY", "ANNUAL_DATE"].includes(selectedMode ?? "");

  const handleEstimate = async () => {
    setEstimating(true);
    try {
      const values = form.getValues();
      const multiplier = numericValue(values.multiplier) ?? 1;
      const maxBudget = numericValue(values.maxBudget);
      const maxUsesPerMember = numericValue(values.maxUsesPerMember);
      const payload: Record<string, unknown> = {
        multiplier,
        maxUsesPerMember,
        segmentId: values.segmentId ?? null,
        eventType: values.eventType?.trim() || null,
      };
      if (maxBudget !== undefined) payload.maxBudget = maxBudget;

      const res = await fetchApi<CampaignEstimate>("/admin/campaigns/estimate", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setEstimate(res);
    } catch {
      setError("Failed to estimate impact");
    } finally {
      setEstimating(false);
    }
  };

  const handleSave = async (mode: "DRAFT" | "SUBMIT") => {
    const valid = await form.trigger();
    if (!valid) return;

    const currentValues = form.getValues();
    if (currentValues.scheduleMode === "SPECIFIC_DATE" && !currentValues.startsAt) {
      setError(ui("A specific start date is required."));
      return;
    }
    if (currentValues.abTesting) {
      const currentVariants = currentValues.variants ?? [];
      const total = currentVariants.reduce((sum, variant) => sum + (numericValue(variant.trafficPct) ?? 0), 0);
      if (currentVariants.length < 2) {
        setError(ui("A/B testing requires at least two variants."));
        return;
      }
      if (Math.abs(total - 100) > 0.01) {
        setError(ui("Traffic split must total 100%."));
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      const values = form.getValues();
      const multiplier = numericValue(values.multiplier) ?? 1;
      const maxBudget = numericValue(values.maxBudget);
      const maxUsesPerMember = numericValue(values.maxUsesPerMember);
      const payload = {
        pointTypeId: values.pointTypeId,
        segmentId: values.segmentId ?? null,
        eventType: values.eventType?.trim() || null,
        issuancePolicy: values.issuancePolicy,
        issuanceMode: values.issuanceMode,
        saveAsDraft: mode === "DRAFT",
        justification: values.justification?.trim() || null,
        name: values.name,
        description: values.description,
        type: values.type,
        multiplier,
        maxBudget: maxBudget ?? null,
        maxUsesPerMember,
        isStackable: values.isStackable ?? false,
        abTesting: values.abTesting ?? false,
        variants: values.abTesting ? values.variants : undefined,
        channels: values.channels ?? [],
        startsAt: values.scheduleMode === "SPECIFIC_DATE" && values.startsAt !== "" ? values.startsAt : null,
        endsAt: values.scheduleMode === "SPECIFIC_DATE" && values.endsAt !== "" ? values.endsAt : null,
      };

      let savedCampaignId = id;
      if (isEdit) {
        await fetchApi<Campaign>(`/admin/campaigns/${String(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        const created = await fetchApi<Campaign>("/admin/campaigns", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        savedCampaignId = created.id;
      }
      if (mode === "SUBMIT" && values.issuancePolicy === "APPROVAL_REQUIRED" && savedCampaignId) {
        await fetchApi(`/admin/campaigns/${savedCampaignId}/propose`, {
          method: "POST",
          body: "{}",
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      navigate("/campaigns");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save campaign");
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const prev = () => {
    setStep((s) => Math.max(s - 1, 0));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            navigate("/campaigns");
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />{ui("Back")}</Button>
        <h1 className="text-3xl font-bold">{isEdit ? "Edit Campaign" : "New Campaign"}</h1>
      </div>

      {/* Step indicators */}
      <div className="flex gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setStep(i);
            }}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors",
              i === step
                ? "bg-primary text-primary-foreground"
                : i < step
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {i < step ? <Check className="mr-1 inline h-3 w-3" /> : null}
            {label}
          </button>
        ))}
      </div>

      {/* Step 1: Policy */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {ui("Campaign policy")}
            </CardTitle>
            <CardDescription>{ui("Choose how this campaign is allowed to issue points. External and one-time events always require approval.")}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <button
              type="button"
              disabled={!standingPolicyAllowed}
              aria-pressed={selectedPolicy === "STANDING"}
              onClick={() => form.setValue("issuancePolicy", "STANDING", { shouldDirty: true })}
              className={cn("rounded-lg border p-4 text-left transition-colors", selectedPolicy === "STANDING" && "border-primary bg-accent", !standingPolicyAllowed && "cursor-not-allowed opacity-50")}
            >
              <h3 className="font-medium">{ui("Standing campaign")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {ui("Use predefined standing occasions such as onboarding, work anniversaries and fixed company dates. These campaigns can run automatically after activation.")}
              </p>
            </button>
            <button
              type="button"
              aria-pressed={selectedPolicy === "APPROVAL_REQUIRED"}
              onClick={() => form.setValue("issuancePolicy", "APPROVAL_REQUIRED", { shouldDirty: true })}
              className={cn("rounded-lg border p-4 text-left transition-colors", selectedPolicy === "APPROVAL_REQUIRED" && "border-primary bg-accent")}
            >
              <h3 className="font-medium">{ui("Approval required")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {ui("For campaigns outside standing occasions, select an approval-required event, add a justification and submit the campaign for approval.")}
              </p>
            </button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Audience */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>{ui("Audience")}</CardTitle>
            <CardDescription>{ui("Select the target segment and per-member limits.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{ui("Target Segment")}</Label>
              <Select
                value={form.watch("segmentId") ?? "all"}
                onValueChange={(v) => {
                  form.setValue("segmentId", v === "all" ? undefined : v);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={ui("All members")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{ui("All Members")}</SelectItem>
                  {segmentsData?.items.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.type === "STATIC" ? s.memberIds.length : "dynamic"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">{ui("Campaign Name")}</Label>
              <Input id="name" {...form.register("name")} placeholder={ui("e.g. Welcome Bonus")} />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-type">{ui("Trigger event")}</Label>
              <Select
                value={selectedEventType || ANY_EVENT_VALUE}
                onValueChange={(value) => {
                  const nextEventType = value === ANY_EVENT_VALUE ? "" : value;
                  const nextDefinition = eventDefinitions?.find((event) => event.key === nextEventType);
                  const nextMode = nextDefinition?.automation.mode;
                  const nextPolicy = !nextDefinition || nextDefinition.key.toLowerCase() === "purchase" || ["ONBOARDING", "MEMBER_DATE_ANNUAL", "ANNIVERSARY", "ANNUAL_DATE"].includes(nextMode ?? "")
                    ? "STANDING"
                    : "APPROVAL_REQUIRED";
                  form.setValue("eventType", value === ANY_EVENT_VALUE ? "" : value, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  form.setValue("issuancePolicy", nextPolicy, { shouldDirty: true });
                }}
              >
                <SelectTrigger id="event-type">
                  <SelectValue placeholder={ui("Any member event")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_EVENT_VALUE}>{ui("Any member event")}</SelectItem>
                  {eventOptions.map((event) => (
                    <SelectItem key={event.key} value={event.key}>
                      <span className="flex items-center justify-between gap-3">
                        <span>{event.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{event.key}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {ui("Choose an event to issue points automatically when it occurs. Leave empty only for legacy purchase campaigns.")}
              </p>
              {selectedDefinition && <div className="rounded-md border p-3 text-sm space-y-2">
                <p>{selectedPolicyLabel}</p>
                <p>{ui(
                  selectedDefinition.automation.mode === "EXTERNAL"
                    ? "An integration must report this event. Creating its name alone does not trigger issuance."
                    : selectedDefinition.automation.mode === "MANUAL"
                      ? "This event is a manual placeholder for campaigns. The campaign runs once after approval."
                      : "Scheduled occasions are generated automatically by the scheduler.",
                )}</p>
              </div>}
              <p className="text-sm text-muted-foreground">
                {ui("Need another event? Create it in")} {" "}
                <Button type="button" variant="link" className="h-auto p-0 align-baseline" onClick={() => navigate("/event-definitions")}>
                  {ui("Event definitions")}
                </Button>
                {" "}{ui("first, then return to this campaign.")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">{ui("Description")}</Label>
              <Textarea
                id="desc"
                {...form.register("description")}
                placeholder={ui("Describe what this campaign does...")}
              />
            </div>
            <div className="space-y-2">
              <Label>{ui("Point delivery")}</Label>
              <p className="text-sm text-muted-foreground">{ui("Choose whether points are added automatically or held for the member to claim after signing in.")}</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={form.watch("issuanceMode") === "AUTO"}
                  onClick={() => form.setValue("issuanceMode", "AUTO", { shouldDirty: true })}
                  className={cn("rounded-lg border p-4 text-left transition-colors", form.watch("issuanceMode") === "AUTO" && "border-primary bg-accent")}
                >
                  <h3 className="font-medium">{ui("Automatic issue")}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{ui("Issue points to eligible members when the event or campaign runs.")}</p>
                </button>
                <button
                  type="button"
                  aria-pressed={form.watch("issuanceMode") === "CLAIM"}
                  onClick={() => form.setValue("issuanceMode", "CLAIM", { shouldDirty: true })}
                  className={cn("rounded-lg border p-4 text-left transition-colors", form.watch("issuanceMode") === "CLAIM" && "border-primary bg-accent")}
                >
                  <h3 className="font-medium">{ui("Member claim")}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{ui("Create a claim for each eligible member. Points are added only after the member signs in and claims it.")}</p>
                </button>
              </div>
            </div>
            {selectedPolicy === "APPROVAL_REQUIRED" && <div className="space-y-2"><Label htmlFor="campaign-reason">{ui("Justification")}</Label><Textarea id="campaign-reason" {...form.register("justification")} /><p className="text-sm text-muted-foreground">{ui("Save the campaign, then submit it for approval. Changes after approval require a new proposal.")}</p></div>}
            <div className="space-y-2">
              <Label htmlFor="maxUses">{ui("Max Uses Per Member")}</Label>
              <Input
                id="maxUses"
                type="number"
                {...form.register("maxUsesPerMember")}
                placeholder={ui("Unlimited")}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Rules */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>{ui("Campaign Rules")}</CardTitle>
            <CardDescription>{ui("Configure the point multiplier, budget, and stacking behavior.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor="campaign-point-type"
                data-help={ui("Point type awarded by this campaign. This removes any dependency on a hard-coded default wallet.")}
              >{ui("Award point type")}</Label>
              <select
                id="campaign-point-type"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.watch("pointTypeId")}
                onChange={(event) => {
                  form.setValue("pointTypeId", event.target.value, { shouldValidate: true });
                }}
              >
                <option value="">{ui("Select point type")}</option>
                {activePointTypes.map((pointType) => (
                  <option key={pointType.id} value={pointType.id}>
                    {pointType.name} ({pointType.code})
                  </option>
                ))}
              </select>
              {form.formState.errors.pointTypeId && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.pointTypeId.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="multiplier">
                {isPurchaseTrigger ? ui("Point Multiplier") : ui("Points to award")}
              </Label>
              <Input id="multiplier" type="number" step={isPurchaseTrigger ? "0.1" : "1"} min="0" {...form.register("multiplier")} />
              <p className="text-sm text-muted-foreground">
                {isPurchaseTrigger
                  ? ui("Earned points are multiplied by this value (1x = no change)")
                  : ui("For this event, the campaign issues this many points to the member.")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="budget">{ui("Max Budget (points)")}</Label>
              <Input
                id="budget"
                type="number"
                {...form.register("maxBudget")}
                placeholder={ui("No limit")}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>{ui("Stackable")}</Label>
                <p className="text-sm text-muted-foreground">{ui("Allow this campaign to stack with others")}</p>
              </div>
              <Switch
                checked={form.watch("isStackable")}
                onCheckedChange={(v) => {
                  form.setValue("isStackable", v);
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>{ui("A/B Testing")}</Label>
                <p className="text-sm text-muted-foreground">{ui("Create variants to test different configurations")}</p>
              </div>
              <Switch
                checked={form.watch("abTesting")}
                onCheckedChange={(v) => {
                  form.setValue("abTesting", v);
                  if (v && (form.getValues("variants") ?? []).length < 2) {
                    form.setValue("variants", DEFAULT_VARIANTS, { shouldDirty: true });
                  }
                }}
              />
            </div>
            {form.watch("abTesting") && (
              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <Label>{ui("Variants")}</Label>
                  <p className="text-sm text-muted-foreground">
                    {ui("Split eligible members between variants. Traffic must total 100%.")}
                  </p>
                </div>
                {variants.map((variant, index) => (
                  <div className="flex items-end gap-2" key={`variant-${index}`}>
                    <div className="flex-1 space-y-1">
                      <Label htmlFor={`variant-name-${index}`}>{ui("Variant name")}</Label>
                      <Input
                        id={`variant-name-${index}`}
                        value={variant.name}
                        onChange={(event) => {
                          const next = [...variants];
                          const current = next[index];
                          if (!current) return;
                          next[index] = { name: event.target.value, trafficPct: current.trafficPct ?? 0, config: current.config };
                          form.setValue("variants", next, { shouldDirty: true, shouldValidate: true });
                        }}
                      />
                    </div>
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`variant-traffic-${index}`}>{ui("Traffic %")}</Label>
                      <Input
                        id={`variant-traffic-${index}`}
                        type="number"
                        min={0}
                        max={100}
                        step="1"
                        value={variant.trafficPct}
                        onChange={(event) => {
                          const next = [...variants];
                          const current = next[index];
                          if (!current) return;
                          next[index] = { name: current.name ?? "", trafficPct: numericValue(event.target.value) ?? 0, config: current.config };
                          form.setValue("variants", next, { shouldDirty: true, shouldValidate: true });
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => form.setValue("variants", variants.filter((_, itemIndex) => itemIndex !== index), { shouldDirty: true })}
                      disabled={variants.length <= 2}
                    >
                      {ui("Remove")}
                    </Button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <span className={cn("text-sm", Math.abs(variantTotal - 100) > 0.01 ? "text-destructive" : "text-muted-foreground")}>
                    {ui("Traffic total")}: {variantTotal}%
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => form.setValue("variants", [...variants, { name: `Variant ${String.fromCharCode(65 + variants.length)}`, trafficPct: 0 }], { shouldDirty: true })}
                    disabled={variants.length >= 5}
                  >
                    {ui("Add variant")}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 4: Channels */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>{ui("Channels")}</CardTitle>
            <CardDescription>{ui("Select which channels this campaign applies to.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {CHANNELS.map((ch) => (
                <div key={ch} className="flex items-center gap-3">
                  <Checkbox
                    id={`ch-${ch}`}
                    checked={(form.watch("channels") ?? []).includes(ch)}
                    onCheckedChange={(checked) => {
                      const current = form.watch("channels") ?? [];
                      if (checked) {
                        form.setValue("channels", [...current, ch]);
                      } else {
                        form.setValue(
                          "channels",
                          current.filter((c) => c !== ch),
                        );
                      }
                    }}
                  />
                  <Label htmlFor={`ch-${ch}`}>{ch}</Label>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 5: Dates */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>{ui("Schedule")}</CardTitle>
            <CardDescription>{ui("Choose whether the campaign runs automatically after approval or on a specific date.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className={cn("cursor-pointer rounded-lg border p-4", form.watch("scheduleMode") === "AUTOMATIC_AFTER_APPROVAL" && "border-primary bg-accent")}>
                <input
                  className="mr-2"
                  type="radio"
                  value="AUTOMATIC_AFTER_APPROVAL"
                  checked={form.watch("scheduleMode") === "AUTOMATIC_AFTER_APPROVAL"}
                  onChange={() => {
                    form.setValue("scheduleMode", "AUTOMATIC_AFTER_APPROVAL", { shouldDirty: true });
                    form.setValue("startsAt", "", { shouldDirty: true });
                    form.setValue("endsAt", "", { shouldDirty: true });
                  }}
                />
                <span className="font-medium">{ui("Run automatically after approval")}</span>
                <p className="mt-1 text-sm text-muted-foreground">{ui("No fixed date; the campaign becomes eligible when approved or activated.")}</p>
              </label>
              <label className={cn("cursor-pointer rounded-lg border p-4", form.watch("scheduleMode") === "SPECIFIC_DATE" && "border-primary bg-accent")}>
                <input
                  className="mr-2"
                  type="radio"
                  value="SPECIFIC_DATE"
                  checked={form.watch("scheduleMode") === "SPECIFIC_DATE"}
                  onChange={() => form.setValue("scheduleMode", "SPECIFIC_DATE", { shouldDirty: true })}
                />
                <span className="font-medium">{ui("Specific date")}</span>
                <p className="mt-1 text-sm text-muted-foreground">{ui("Start the campaign at a defined date and optionally end it later.")}</p>
              </label>
            </div>
            {form.watch("scheduleMode") === "SPECIFIC_DATE" && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="startsAt">{ui("Start Date")}</Label>
                  <Input id="startsAt" type="datetime-local" {...form.register("startsAt")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endsAt">{ui("End Date")} {ui(" (optional)")}</Label>
                  <Input id="endsAt" type="datetime-local" {...form.register("endsAt")} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 6: Review */}
      {step === 5 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{ui("Review Campaign")}</CardTitle>
              <CardDescription>{ui("Verify all details before creating.")}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{ui("Policy")}</dt>
                  <dd className="font-medium">{selectedPolicyLabel}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{ui("Name")}</dt>
                  <dd className="font-medium">{form.watch("name") || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{ui("Trigger event")}</dt>
                  <dd className="font-medium">{form.watch("eventType") || ui("Any event")}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{ui(isPurchaseTrigger ? "Multiplier" : "Points to award")}</dt>
                  <dd className="font-medium">{form.watch("multiplier") ?? 1}{isPurchaseTrigger ? "x" : ""}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{ui("Budget")}</dt>
                  <dd className="font-medium">
                    {numericValue(form.watch("maxBudget")) !== undefined
                      ? `${(numericValue(form.watch("maxBudget")) ?? 0).toLocaleString()} pts`
                      : "Unlimited"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{ui("Schedule")}</dt>
                  <dd className="font-medium">
                    {form.watch("scheduleMode") === "SPECIFIC_DATE"
                      ? form.watch("startsAt") || ui("Specific date")
                      : ui("Run automatically after approval")}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{ui("Stackable")}</dt>
                  <dd className="font-medium">{form.watch("isStackable") ? "Yes" : "No"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{ui("A/B Testing")}</dt>
                  <dd className="font-medium">{form.watch("abTesting") ? "Yes" : "No"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{ui("Channels")}</dt>
                  <dd className="font-medium">
                    {(form.watch("channels") ?? []).length > 0
                      ? (form.watch("channels") ?? []).join(", ")
                      : "All"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Impact estimation */}
          <Card>
            <CardHeader>
              <CardTitle>{ui("Estimated Impact")}</CardTitle>
            </CardHeader>
            <CardContent>
              {estimating ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ) : estimate ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="rounded-lg border p-3 text-center">
                      <p className="text-2xl font-bold">
                        {estimate.estimatedMembers.toLocaleString()}
                      </p>
                      <p className="text-sm text-muted-foreground">{ui("Eligible Members")}</p>
                    </div>
                    <div className="rounded-lg border p-3 text-center">
                      <p className="text-2xl font-bold">
                        {estimate.estimatedPoints.toLocaleString()}
                      </p>
                      <p className="text-sm text-muted-foreground">{ui("Projected Points")}</p>
                    </div>
                    <div className="rounded-lg border p-3 text-center">
                      <p className="text-2xl font-bold">{estimate.estimatedCost.toLocaleString()}</p>
                      <p className="text-sm text-muted-foreground">{ui("Est. Cost (pts)")}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ui("Projected points are calculated for one grant per eligible member; max per member is not a campaign-wide total.")}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void handleEstimate();
                    }}
                    disabled={estimating}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />{ui("Recalculate")}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    void handleEstimate();
                  }}
                >{ui("Calculate Estimate")}</Button>
              )}
            </CardContent>
          </Card>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="grid gap-3 md:grid-cols-2">
            <Button
              variant="outline"
              onClick={() => {
                void handleSave("DRAFT");
              }}
              disabled={saving}
            >
              <Save className="mr-2 h-4 w-4" />{ui("Save as draft")}
            </Button>
            <Button
              onClick={() => {
                void handleSave("SUBMIT");
              }}
              disabled={saving}
            >
              <Save className="mr-2 h-4 w-4" />
              {saving ? ui("Saving...") : selectedPolicy === "APPROVAL_REQUIRED" ? ui("Submit for approval") : isEdit ? ui("Save changes") : ui("Create Campaign")}
            </Button>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={prev} disabled={step === 0}>
          <ArrowLeft className="mr-2 h-4 w-4" />{ui("Back")}</Button>
        {step < STEPS.length - 1 && (
          <Button onClick={next}>{ui("Next")}<ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
