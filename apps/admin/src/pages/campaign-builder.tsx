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
import { useEffect, useMemo, useRef, useState } from "react";
import i18n from "@/i18n";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
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
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().optional(),
  segmentId: z.string().optional(),
  eventType: z.string().max(80).optional(),
  issuancePolicy: z.enum(["STANDING", "APPROVAL_REQUIRED"]),
  issuanceMode: z.enum(["AUTO", "CLAIM"]),
  justification: z.string().max(2000).optional(),
  maxUsesPerMember: z.union([z.literal(""), z.coerce.number().int().min(0)]).optional().transform((value) => value === "" ? undefined : value),
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

const STEPS = ["Occasion", "Recipients", "Reward", "Schedule", "Review"];
const STEP_FIELDS: Record<string, { step: number; id: string }> = {
  name: { step: 0, id: "name" }, eventType: { step: 0, id: "event-type" },
  issuancePolicy: { step: 0, id: "event-type" }, justification: { step: 0, id: "campaign-reason" },
  segmentId: { step: 1, id: "target-segment" }, maxUsesPerMember: { step: 1, id: "maxUses" },
  pointTypeId: { step: 2, id: "campaign-point-type" }, multiplier: { step: 2, id: "multiplier" },
  maxBudget: { step: 2, id: "budget" }, variants: { step: 2, id: "variant-name-0" },
  startsAt: { step: 3, id: "startsAt" }, endsAt: { step: 3, id: "endsAt" },
};
function campaignText(english: string, vietnamese: string): string {
  return i18n.language.startsWith("vi") ? vietnamese : english;
}

export function CampaignBuilderPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedCampaignId = useRef<string | null>(null);
  const savedCampaignIdRef = useRef<string | undefined>(id);
  const [policyNotice, setPolicyNotice] = useState(false);

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

  const { data: eventDefinitions, refetch: refreshEvents } = useQuery({
    queryKey: ["event-definitions", "campaign-builder"],
    queryFn: () => fetchApi<{ key: string; name: string; isActive: boolean; automation: { mode: string; dateField?: string; leapDayPolicy?: string } }[]>("/admin/event-definitions"),
  });

  useEffect(() => {
    const onFocus = () => { void refreshEvents(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshEvents]);

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
    if (existingCampaign && loadedCampaignId.current !== existingCampaign.id) {
      loadedCampaignId.current = existingCampaign.id;
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
        maxBudget: existingCampaign.maxBudget ?? undefined,
        maxUsesPerMember: existingCampaign.maxUsesPerMember ?? undefined,
        isStackable: existingCampaign.isStackable,
        abTesting: existingCampaign.abTesting,
        variants: existingCampaign.variants?.filter((variant) => variant.isActive !== false).map((variant) => ({
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
  const standingPolicyAllowed = !selectedDefinition || selectedDefinition.key.toLowerCase() === "purchase" || ["MEMBER_CHECK_IN", "ONBOARDING", "MEMBER_DATE_ANNUAL", "ANNIVERSARY", "ANNUAL_DATE"].includes(selectedMode ?? "");

  // Event refresh may strengthen the policy, never silently remove approval.
  useEffect(() => {
    if (!standingPolicyAllowed && selectedPolicy === "STANDING") {
      form.setValue("issuancePolicy", "APPROVAL_REQUIRED", { shouldDirty: true });
      setPolicyNotice(true);
    }
  }, [standingPolicyAllowed, selectedPolicy, form]);

  const validateThrough = (lastStep: number, draft = false): boolean => {
    const values = form.getValues();
    const parsed = wizardSchema.safeParse({ ...values, variants: values.abTesting ? values.variants : undefined });
    const problems: { field: string; message: string }[] = [];
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]);
        const messages: Record<string, string> = {
          name: campaignText("Enter a campaign name.", "Nhập tên chiến dịch."),
          pointTypeId: campaignText("Choose the point type to award.", "Chọn loại điểm thưởng."),
          maxBudget: campaignText("Budget must be a non-negative whole number, or left empty for unlimited.", "Ngân sách phải là số nguyên không âm; để trống nếu không giới hạn."),
          maxUsesPerMember: campaignText("The per-member limit must be a non-negative whole number, or left empty for unlimited.", "Giới hạn mỗi thành viên phải là số nguyên không âm; để trống nếu không giới hạn."),
          multiplier: campaignText("Enter a valid non-negative reward amount.", "Nhập số điểm thưởng không âm hợp lệ."),
          justification: campaignText("Justification must not exceed 2,000 characters.", "Lý do không được vượt quá 2.000 ký tự."),
          variants: campaignText("Check variant names and traffic percentages (0–100%).", "Kiểm tra tên biến thể và tỷ lệ phân bổ (0–100%)."),
        };
        problems.push({ field, message: messages[field] ?? campaignText("Check this field before continuing.", "Kiểm tra trường này trước khi tiếp tục.") });
      }
    }
    if (!draft && !isEdit && !selectedEventType) problems.push({ field: "eventType", message: campaignText("Choose the occasion that triggers this campaign.", "Chọn sự kiện kích hoạt chiến dịch.") });
    if (selectedEventType && eventDefinitions && !selectedDefinition?.isActive && (!isEdit || selectedEventType !== existingCampaign?.eventType)) problems.push({ field: "eventType", message: campaignText("Choose an active event.", "Chọn một sự kiện đang hoạt động.") });
    if (!draft && values.issuancePolicy === "APPROVAL_REQUIRED" && !values.justification?.trim()) problems.push({ field: "justification", message: campaignText("Explain why this campaign is needed before submitting for approval.", "Nhập lý do cần chiến dịch trước khi gửi phê duyệt.") });
    const award = numericValue(values.multiplier);
    if (!isPurchaseTrigger && (!Number.isSafeInteger(award) || !award || award <= 0)) problems.push({ field: "multiplier", message: campaignText("Points to award must be a positive whole number.", "Số điểm thưởng phải là số nguyên dương.") });
    if (values.abTesting) {
      const entries = values.variants ?? [];
      if (entries.length < 2 || Math.abs(entries.reduce((sum, entry) => sum + (numericValue(entry.trafficPct) ?? 0), 0) - 100) > 0.01) problems.push({ field: "variants", message: campaignText("Use at least two variants with traffic totaling 100%.", "Cần ít nhất hai biến thể với tổng tỷ lệ phân bổ bằng 100%.") });
      if (entries.some((entry) => entry.config?.multiplier !== undefined && (!Number.isSafeInteger(numericValue(entry.config.multiplier)) || (numericValue(entry.config.multiplier) ?? 0) <= 0))) problems.push({ field: "variants", message: campaignText("Each variant award must be a positive whole number.", "Điểm thưởng của mỗi biến thể phải là số nguyên dương.") });
    }
    if (values.scheduleMode === "SPECIFIC_DATE") {
      if (!draft && !values.startsAt) problems.push({ field: "startsAt", message: ui("A specific start date is required.") });
      if (values.startsAt && !Number.isFinite(Date.parse(values.startsAt))) problems.push({ field: "startsAt", message: campaignText("Enter a valid start date.", "Nhập ngày bắt đầu hợp lệ.") });
      if (values.endsAt && !Number.isFinite(Date.parse(values.endsAt))) problems.push({ field: "endsAt", message: campaignText("Enter a valid end date.", "Nhập ngày kết thúc hợp lệ.") });
      if (values.startsAt && values.endsAt && Date.parse(values.endsAt) <= Date.parse(values.startsAt)) problems.push({ field: "endsAt", message: campaignText("End date must be later than start date.", "Ngày kết thúc phải sau ngày bắt đầu.") });
    }
    const first = problems.filter((problem) => (STEP_FIELDS[problem.field]?.step ?? 0) <= lastStep).sort((a, b) => (STEP_FIELDS[a.field]?.step ?? 0) - (STEP_FIELDS[b.field]?.step ?? 0))[0];
    if (first) {
      const location = STEP_FIELDS[first.field] ?? { step: 0, id: "name" };
      form.setError(first.field as keyof WizardData, { type: "manual", message: first.message });
      setError(first.message);
      setStep(location.step);
      window.requestAnimationFrame(() => {
        const field = document.getElementById(location.id);
        const details = field?.closest("details");
        if (details) details.open = true;
        field?.focus();
        field?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      return false;
    }
    form.clearErrors();
    setError(null);
    return true;
  };

  const fieldError = (field: keyof WizardData) => {
    const message = form.formState.errors[field]?.message;
    return typeof message === "string" ? <p role="alert" className="text-sm text-destructive">{message}</p> : null;
  };

  const handleEstimate = async () => {
    const values = form.getValues();
    if (values.abTesting) {
      const currentVariants = values.variants ?? [];
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
    setError(null);
    setEstimating(true);
    try {
      const multiplier = numericValue(values.multiplier) ?? 1;
      const maxBudget = numericValue(values.maxBudget);
      const maxUsesPerMember = numericValue(values.maxUsesPerMember);
      const payload: Record<string, unknown> = {
        multiplier,
        maxUsesPerMember,
        segmentId: values.segmentId ?? null,
        eventType: values.eventType?.trim() || null,
        abTesting: values.abTesting,
        variants: values.abTesting
          ? (values.variants ?? []).map((variant) => ({
              trafficPct: numericValue(variant.trafficPct) ?? 0,
              config: {
                ...(variant.config ?? {}),
                ...(numericValue(variant.config?.multiplier) !== undefined
                  ? { multiplier: numericValue(variant.config?.multiplier) }
                  : {}),
              },
            }))
          : undefined,
      };
      if (maxBudget !== undefined) payload.maxBudget = maxBudget;

      const res = await fetchApi<CampaignEstimate>("/admin/campaigns/estimate", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setEstimate(res);
    } catch {
      setError(ui("Failed to estimate impact"));
    } finally {
      setEstimating(false);
    }
  };

  const handleSave = async (mode: "DRAFT" | "SUBMIT") => {
    if (!validateThrough(STEPS.length - 1, mode === "DRAFT")) return;

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
        name: values.name.trim(),
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

      let savedCampaignId = savedCampaignIdRef.current;
      if (savedCampaignId) {
        await fetchApi<Campaign>(`/admin/campaigns/${savedCampaignId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        const created = await fetchApi<Campaign>("/admin/campaigns", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        savedCampaignId = created.id;
        savedCampaignIdRef.current = created.id;
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
      setError(err instanceof Error ? ui(err.message) : ui("Failed to save campaign"));
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    if (validateThrough(step)) setStep((s) => Math.min(s + 1, STEPS.length - 1));
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
        <h1 className="text-3xl font-bold">{ui(isEdit ? "Edit Campaign" : "New Campaign")}</h1>
      </div>

      {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><p className="font-medium">{campaignText("Please check the campaign details", "Vui lòng kiểm tra thông tin chiến dịch")}</p><p className="mt-1">{error}</p></div>}

      {/* Step indicators */}
      <div className="flex gap-2 overflow-x-auto pb-1" aria-label={ui("Campaign")}>
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            aria-current={i === step ? "step" : undefined}
            disabled={saving}
            onClick={() => {
              if (i <= step || validateThrough(i - 1)) setStep(i);
            }}
            className={cn(
              "flex-1 whitespace-nowrap rounded-md px-3 py-2 text-center text-sm font-medium transition-colors",
              i === step
                ? "bg-primary text-primary-foreground"
                : i < step
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {i < step ? <Check className="mr-1 inline h-3 w-3" /> : null}
            {i + 1}. {campaignText(label, ["Sự kiện", "Đối tượng", "Điểm thưởng", "Lịch chạy", "Kiểm tra"][i] ?? label)}
          </button>
        ))}
      </div>

      {/* Step 1: Occasion and approval policy */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{campaignText("Occasion", "Sự kiện")}</CardTitle>
            <CardDescription>{campaignText("Name the campaign and choose what should trigger the reward.", "Đặt tên chiến dịch và chọn sự kiện kích hoạt điểm thưởng.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                  const requiresApproval = Boolean(nextDefinition && nextDefinition.key.toLowerCase() !== "purchase" && !["MEMBER_CHECK_IN", "ONBOARDING", "MEMBER_DATE_ANNUAL", "ANNIVERSARY", "ANNUAL_DATE"].includes(nextMode ?? ""));
                  const nextPolicy = requiresApproval ? "APPROVAL_REQUIRED" : form.getValues("issuancePolicy");
                  setPolicyNotice(requiresApproval);
                  form.setValue("eventType", value === ANY_EVENT_VALUE ? "" : value, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  form.setValue("issuancePolicy", nextPolicy, { shouldDirty: true });
                }}
              >
                <SelectTrigger id="event-type">
                  <SelectValue placeholder={campaignText("Choose an event", "Chọn sự kiện")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_EVENT_VALUE}>{isEdit && !existingCampaign?.eventType ? campaignText("Legacy purchase campaign", "Chiến dịch mua hàng cũ") : campaignText("Choose an event", "Chọn sự kiện")}</SelectItem>
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
              {fieldError("eventType")}
              <p className="text-sm text-muted-foreground">
                {ui("Choose an event to issue points automatically when it occurs. Leave empty only for legacy purchase campaigns.")}
              </p>
              {selectedDefinition && <div className="rounded-md border p-3 text-sm space-y-2">
                <p>{selectedPolicyLabel}</p>
                <p>{ui(
                  selectedDefinition.automation.mode === "MEMBER_CHECK_IN"
                    ? "Members can check in once per day from Customer Home. This campaign controls the reward and appears in their activity calendar."
                    : selectedDefinition.automation.mode === "EXTERNAL"
                    ? "An integration must report this event. Creating its name alone does not trigger issuance."
                    : selectedDefinition.automation.mode === "MANUAL"
                      ? "This event is a manual placeholder for campaigns. The campaign runs once after approval."
                      : "Scheduled occasions are generated automatically by the scheduler.",
                )}</p>
              </div>}
              <p className="text-sm text-muted-foreground">
                {ui("Need another event? Create it in")} {" "}
                <Link to="/event-definitions" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-4">
                  {campaignText("Event definitions (opens a new tab)", "Định nghĩa sự kiện (mở tab mới)")}
                </Link>
                {" "}{campaignText("Your inputs stay here. Return to this tab to refresh the event list.", "Thông tin đang nhập được giữ tại đây. Quay lại tab này để cập nhật danh sách sự kiện.")}
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

            <section className="space-y-3 rounded-lg border p-4">
              <h3 className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4" />{ui("Campaign policy")}</h3>
              <p className="text-sm text-muted-foreground">{campaignText("The selected event determines whether approval is mandatory. Standing occasions can also be submitted for approval if needed.", "Sự kiện đã chọn quyết định chiến dịch có bắt buộc phê duyệt hay không. Bạn cũng có thể yêu cầu phê duyệt cho sự kiện định kỳ.")}</p>
              {policyNotice && <p role="status" className="text-sm">{campaignText("Approval is required for this event. Your reward amount and other settings have not changed.", "Sự kiện này bắt buộc phê duyệt. Số điểm thưởng và các thiết lập khác được giữ nguyên.")}</p>}
              <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              disabled={!standingPolicyAllowed}
              aria-pressed={selectedPolicy === "STANDING"}
              onClick={() => { form.setValue("issuancePolicy", "STANDING", { shouldDirty: true }); setPolicyNotice(false); }}
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
              onClick={() => { form.setValue("issuancePolicy", "APPROVAL_REQUIRED", { shouldDirty: true }); setPolicyNotice(false); }}
              className={cn("rounded-lg border p-4 text-left transition-colors", selectedPolicy === "APPROVAL_REQUIRED" && "border-primary bg-accent")}
            >
              <h3 className="font-medium">{ui("Approval required")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {ui("For campaigns outside standing occasions, select an approval-required event, add a justification and submit the campaign for approval.")}
              </p>
            </button>
              </div>
            </section>
            {selectedPolicy === "APPROVAL_REQUIRED" && <div className="space-y-2"><Label htmlFor="campaign-reason">{ui("Justification")}</Label><Textarea id="campaign-reason" {...form.register("justification")} />{fieldError("justification")}<p className="text-sm text-muted-foreground">{campaignText("Required when submitting for approval; optional when saving a draft. Changes after approval require a new proposal.", "Bắt buộc khi gửi phê duyệt; tùy chọn khi lưu nháp. Thay đổi sau phê duyệt cần gửi lại đề xuất.")}</p></div>}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Recipients and point delivery */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>{campaignText("Recipients", "Đối tượng nhận điểm")}</CardTitle>
            <CardDescription>{campaignText("Choose who can receive points and how they receive them.", "Chọn người nhận điểm và cách họ nhận điểm.")}</CardDescription>
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
                <SelectTrigger id="target-segment">
                  <SelectValue placeholder={ui("All members")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{ui("All Members")}</SelectItem>
                  {segmentsData?.items.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.type === "STATIC" ? s.memberIds.length : ui("Dynamic")})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <div className="space-y-2">
              <Label htmlFor="maxUses">{ui("Max Uses Per Member")}</Label>
              <Input
                id="maxUses"
                type="number"
                {...form.register("maxUsesPerMember")}
                placeholder={ui("Unlimited")}
              />
              {fieldError("maxUsesPerMember")}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Rules */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>{campaignText("Reward", "Điểm thưởng")}</CardTitle>
            <CardDescription>{campaignText("Choose the point type, award amount and total campaign budget.", "Chọn loại điểm, số điểm thưởng và tổng ngân sách chiến dịch.")}</CardDescription>
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
              {fieldError("multiplier")}
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
              {fieldError("maxBudget")}
            </div>
            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">{campaignText("Advanced: stacking, A/B testing and channels", "Nâng cao: cộng dồn, thử nghiệm A/B và kênh")}</summary>
              <div className="mt-4 space-y-4">
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
                {fieldError("variants")}
                <div>
                  <Label>{ui("Variants")}</Label>
                  <p className="text-sm text-muted-foreground">
                    {ui("Split eligible members between variants. Configure a different award multiplier for each variant; traffic must total 100%.")}
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
                    <div className="w-36 space-y-1">
                      <Label htmlFor={`variant-multiplier-${index}`}>{ui(form.watch("eventType") === "purchase" ? "Purchase multiplier" : "Points awarded")}</Label>
                      <Input
                        id={`variant-multiplier-${index}`}
                        type="number"
                        min={1}
                        step="1"
                        value={typeof variant.config?.multiplier === "number" ? variant.config.multiplier : numericValue(form.watch("multiplier")) ?? 1}
                        onChange={(event) => {
                          const next = [...variants];
                          const current = next[index];
                          if (!current) return;
                          next[index] = { ...current, config: { ...(current.config ?? {}), multiplier: numericValue(event.target.value) ?? 0 } };
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
                <div className="space-y-2">
                  <h3 className="font-medium">{ui("Channels")}</h3>
                  <p className="text-sm text-muted-foreground">{campaignText("Optional channel selection for integrations. This does not configure notification delivery.", "Lựa chọn kênh tùy chọn cho tích hợp. Đây không phải thiết lập gửi thông báo.")}</p>
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
                </div>
              </div>
            </details>
          </CardContent>
        </Card>
      )}

      {/* Step 5: Dates */}
      {step === 3 && (
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
                  {fieldError("startsAt")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endsAt">{ui("End Date")} {ui(" (optional)")}</Label>
                  <Input id="endsAt" type="datetime-local" {...form.register("endsAt")} />
                  {fieldError("endsAt")}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 6: Review */}
      {step === 4 && (
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
                  <dd className="font-medium">{selectedDefinition?.name ?? (form.watch("eventType") || ui("Any event"))}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{ui("Target Segment")}</dt>
                  <dd className="text-right font-medium">{segmentsData?.items.find((segment) => segment.id === form.watch("segmentId"))?.name ?? (form.watch("segmentId") ? campaignText("Selected segment", "Nhóm đã chọn") : ui("All members"))}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{ui("Award point type")}</dt>
                  <dd className="text-right font-medium">{pointTypes?.find((pointType) => pointType.id === form.watch("pointTypeId"))?.name ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{ui("Point delivery")}</dt>
                  <dd className="text-right font-medium">{ui(form.watch("issuanceMode") === "CLAIM" ? "Member claim" : "Automatic issue")}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{ui("Max Uses Per Member")}</dt>
                  <dd className="text-right font-medium">{numericValue(form.watch("maxUsesPerMember")) ?? ui("Unlimited")}</dd>
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
                      : ui("Unlimited")}
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
                  <dd className="font-medium">{form.watch("isStackable") ? ui("Yes") : ui("No")}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{ui("A/B Testing")}</dt>
                  <dd className="font-medium">{form.watch("abTesting") ? ui("Yes") : ui("No")}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{ui("Channels")}</dt>
                  <dd className="font-medium">
                    {(form.watch("channels") ?? []).length > 0
                      ? (form.watch("channels") ?? []).join(", ")
                      : ui("All")}
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

      <p className="text-sm text-muted-foreground">{campaignText("Drafts need a name and a valid point type. Any reward amounts, dates and A/B settings already entered must also be valid. You can add the approval justification later.", "Bản nháp cần tên và loại điểm hợp lệ. Số điểm thưởng, ngày và thiết lập A/B đã nhập cũng phải hợp lệ. Bạn có thể bổ sung lý do phê duyệt sau.")}</p>

      {/* Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={prev} disabled={step === 0 || saving}>
          <ArrowLeft className="mr-2 h-4 w-4" />{ui("Back")}</Button>
        {step < STEPS.length - 1 && <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={saving} onClick={() => { void handleSave("DRAFT"); }}><Save className="mr-2 h-4 w-4" />{ui("Save as draft")}</Button>
          <Button disabled={saving} onClick={next}>{campaignText("Continue", "Tiếp tục")}<ArrowRight className="ml-2 h-4 w-4" /></Button>
        </div>}
      </div>
    </div>
  );
}
