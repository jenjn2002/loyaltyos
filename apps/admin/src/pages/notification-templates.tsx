import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Eye, Pencil, Plus, Save, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";

type Channel = "EMAIL" | "SMS" | "PUSH" | "IN_APP" | "WEBHOOK";

interface NotificationTemplate {
  id: string;
  name: string;
  locale: string;
  channel: Channel;
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  triggerEvent: string | null;
  transactional: boolean;
  fallbackChannel: Channel | null;
  createdAt: string;
  createdBy?: { id: string; name: string; email: string | null } | null;
}

interface TemplatePage {
  items: NotificationTemplate[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface VariableInfo {
  path: string;
  description: string;
}

interface TriggerOption {
  key: string;
  label: string;
  description: string;
  variables: VariableInfo[];
}

const MEMBER_IDENTITY: VariableInfo[] = [
  { path: "member.id", description: "Member's unique ID." },
  { path: "member.email", description: "Member's email address." },
  { path: "member.phone", description: "Member's phone number." },
  { path: "member.firstName", description: "Member's first name." },
  { path: "member.lastName", description: "Member's last name." },
];

const MEMBER_WITH_TIER: VariableInfo[] = [
  ...MEMBER_IDENTITY,
  { path: "member.currentTier", description: "Member's current tier, when assigned." },
];

const POINT_TYPE: VariableInfo[] = [
  { path: "pointType.id", description: "Point type ID." },
  { path: "pointType.code", description: "Point type code, for example P-CREDIT." },
  { path: "pointType.name", description: "Display name of the point type." },
  { path: "pointType.unitLabel", description: "Point unit label, for example points." },
];

const TRIGGERS: TriggerOption[] = [
  {
    key: "registration",
    label: "New member registration",
    description: "Sent when a registration event is processed.",
    variables: [
      ...MEMBER_WITH_TIER,
      { path: "bonus", description: "Registration bonus points awarded, if any." },
      { path: "points", description: "Points awarded by the registration event." },
      { path: "balance", description: "Balance after the first registration reward, if any." },
    ],
  },
  {
    key: "auth.magic_link",
    label: "Sign-in link",
    description: "Sent when a member requests a sign-in link.",
    variables: [
      ...MEMBER_WITH_TIER,
      { path: "program.name", description: "Name of the loyalty program." },
      { path: "magicLinkUrl", description: "One-time sign-in URL." },
    ],
  },
  {
    key: "points.earned",
    label: "Points earned",
    description: "Sent after a purchase event earns points.",
    variables: [
      ...MEMBER_WITH_TIER,
      { path: "points", description: "Total points awarded by the event." },
      { path: "balances", description: "Balances after each points transaction." },
      { path: "amount", description: "Purchase amount supplied with the event." },
      { path: "transactionIds", description: "IDs of the points transactions." },
    ],
  },
  {
    key: "check_in",
    label: "Member check-in",
    description: "Sent after a member checks in and receives campaign points.",
    variables: [
      ...MEMBER_WITH_TIER,
      { path: "eventKey", description: "The configured check-in event key." },
      { path: "checkInDate", description: "Member-local check-in date (YYYY-MM-DD)." },
      { path: "points", description: "Points issued immediately (pending claims are excluded)." },
      { path: "rewards", description: "Campaign rewards, including point type and claim status." },
    ],
  },
  {
    key: "credit.received",
    label: "Recognition received",
    description: "Sent when a member receives recognition points.",
    variables: [
      { path: "member.email", description: "Recipient's email address." },
      { path: "member.phone", description: "Recipient's phone number." },
      { path: "member.firstName", description: "Recipient's first name." },
      { path: "member.lastName", description: "Recipient's last name." },
      { path: "amount", description: "Amount received in the destination point type." },
      { path: "sourceAmount", description: "Amount deducted from the source point type." },
      { path: "message", description: "Recognition message from the sender." },
      { path: "category", description: "Recognition category, if selected." },
      { path: "sourcePointTypeId", description: "ID of the source point type." },
      { path: "destinationPointTypeId", description: "ID of the destination point type." },
      ...POINT_TYPE,
    ],
  },
  {
    key: "credit.expiring",
    label: "Points expiring",
    description: "Sent by the expiry reminder job.",
    variables: [
      ...MEMBER_IDENTITY,
      { path: "amount", description: "Remaining points in the expiring lot." },
      ...POINT_TYPE,
      { path: "expiresAt", description: "Expiry date and time in ISO format." },
      { path: "days", description: "Configured number of days before expiry." },
    ],
  },
  {
    key: "credit.exchange",
    label: "Exchange requested",
    description: "Sent after a member submits an exchange request.",
    variables: [
      { path: "amount", description: "Amount included in the exchange request." },
      { path: "status", description: "Current request status." },
    ],
  },
  {
    key: "credit.exchange.approved",
    label: "Exchange approved",
    description: "Sent when an exchange request is approved.",
    variables: [
      { path: "member.email", description: "Member's email address." },
      { path: "member.phone", description: "Member's phone number." },
      { path: "amount", description: "Amount included in the exchange request." },
      { path: "documentNumber", description: "Exchange request reference number." },
      ...POINT_TYPE,
      { path: "status", description: "Final request status (APPROVED)." },
    ],
  },
  {
    key: "credit.exchange.rejected",
    label: "Exchange rejected",
    description: "Sent when an exchange request is rejected.",
    variables: [
      { path: "member.email", description: "Member's email address." },
      { path: "member.phone", description: "Member's phone number." },
      { path: "amount", description: "Amount included in the exchange request." },
      { path: "documentNumber", description: "Exchange request reference number." },
      ...POINT_TYPE,
      { path: "status", description: "Final request status (REJECTED)." },
    ],
  },
  {
    key: "credit.redeemed",
    label: "Reward redeemed",
    description: "Sent after a member redeems a reward.",
    variables: [
      ...MEMBER_IDENTITY,
      { path: "rewardId", description: "ID of the redeemed reward." },
      { path: "amount", description: "Points spent on the redemption." },
      { path: "pointTypeId", description: "ID of the point type used." },
    ],
  },
  {
    key: "reward.fulfillment_changed",
    label: "Reward fulfillment updated",
    description: "Sent when an admin updates a redemption's fulfillment status.",
    variables: [
      ...MEMBER_IDENTITY,
      { path: "redemptionId", description: "ID of the reward redemption." },
      { path: "status", description: "New fulfillment status." },
    ],
  },
  {
    key: "campaign.claim.available",
    label: "Campaign points ready to claim",
    description: "Sent when a campaign grant is waiting for a member to claim.",
    variables: [
      { path: "member.email", description: "Member's email address." },
      { path: "member.phone", description: "Member's phone number." },
      { path: "amount", description: "Points available to claim." },
      { path: "campaign.name", description: "Name of the campaign." },
      ...POINT_TYPE,
    ],
  },
  {
    key: "tier.changed",
    label: "Tier upgraded",
    description: "Sent when an event raises a member's tier.",
    variables: [
      ...MEMBER_WITH_TIER,
      { path: "previousTier", description: "Tier held before the change." },
      { path: "currentTier", description: "New tier after the change." },
      { path: "direction", description: "Change direction, for example upgrade." },
    ],
  },
  {
    key: "badge.unlocked",
    label: "Badge unlocked",
    description: "Sent when an event unlocks a badge.",
    variables: [
      ...MEMBER_WITH_TIER,
      { path: "badgeId", description: "ID of the unlocked badge." },
      { path: "badgeName", description: "Display name of the unlocked badge." },
      { path: "badgeType", description: "Badge category/type." },
    ],
  },
];

const CHANNELS: Channel[] = ["IN_APP", "EMAIL", "SMS", "PUSH", "WEBHOOK"];
const LOCALES = [
  { code: "vi-VN", label: "Vietnamese" },
  { code: "en-US", label: "English" },
];
const CUSTOM_TRIGGER = "__custom__";
const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

interface LocalizedDraft {
  id: string | null;
  included: boolean;
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

interface TemplateDraft {
  name: string;
  triggerChoice: string;
  customTrigger: string;
  channel: Channel;
  localized: Record<string, LocalizedDraft>;
  transactional: boolean;
  fallbackChannel: "" | Channel;
}

interface TemplateGroup {
  key: string;
  templates: NotificationTemplate[];
}

function emptyLocalizedDraft(included: boolean): LocalizedDraft {
  return { id: null, included, subject: "", bodyText: "", bodyHtml: "" };
}

function emptyDraft(): TemplateDraft {
  return {
    name: "",
    triggerChoice: "registration",
    customTrigger: "",
    channel: "IN_APP",
    localized: Object.fromEntries(LOCALES.map(({ code }) => [code, emptyLocalizedDraft(true)])),
    transactional: true,
    fallbackChannel: "",
  };
}

function triggerKey(draft: TemplateDraft): string {
  return draft.triggerChoice === CUSTOM_TRIGGER ? draft.customTrigger.trim() : draft.triggerChoice;
}

function sampleVariables(): string {
  return JSON.stringify({
    member: {
      id: "member-001", email: "member@example.com", phone: "+84123456789",
      firstName: "Nguyễn Tiến", lastName: "Hưng", currentTier: "Gold",
    },
    program: { name: "LoyaltyOS" },
    campaign: { name: "Welcome Onboard" },
    pointType: { id: "point-type-001", code: "P-CREDIT", name: "P-credit", unitLabel: "điểm" },
    amount: 1000,
    sourceAmount: 1000,
    points: 1000,
    balances: [2000],
    balance: 2000,
    bonus: 1000,
    days: 7,
    expiresAt: "2026-10-01T00:00:00.000Z",
    status: "APPROVED",
    message: "Cảm ơn bạn đã hỗ trợ!",
    magicLinkUrl: "https://example.com/sign-in",
    badgeId: "badge-001",
    badgeName: "First recognition",
    previousTier: "Silver",
    currentTier: "Gold",
    redemptionId: "redemption-001",
  }, null, 2);
}

function groupKey(template: NotificationTemplate): string {
  return `${template.name.toLocaleLowerCase()}\u0000${template.triggerEvent ?? ""}\u0000${template.channel}`;
}

function languageLabel(locale: string): string {
  return LOCALES.find((language) => language.code === locale)?.label ?? locale;
}

function getTemplateByLocale(group: TemplateGroup, locale: string): NotificationTemplate | undefined {
  return group.templates.find((template) => template.locale === locale);
}

export function NotificationTemplatesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft);
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [filterTrigger, setFilterTrigger] = useState("");
  const [templatePage, setTemplatePage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [variables, setVariables] = useState(sampleVariables);
  const [preview, setPreview] = useState<{ subject: string | null; bodyHtml: string | null; bodyText: string | null } | null>(null);
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);

  const admin = useQuery({
    queryKey: ["admin-me-notification-templates"],
    queryFn: () => fetchApi<{ capabilities: Record<string, boolean> }>("/admin/me"),
  });
  const templates = useQuery({
    queryKey: ["notification-templates", templatePage, filterTrigger],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(templatePage), pageSize: "100" });
      if (filterTrigger) params.set("triggerEvent", filterTrigger);
      return fetchApi<TemplatePage>(`/admin/notification-templates?${params.toString()}`);
    },
  });
  const availableTriggers = useQuery({
    queryKey: ["notification-template-triggers"],
    queryFn: () => fetchApi<string[]>("/admin/notification-templates/triggers"),
  });
  const canManage = admin.data?.capabilities["notification.manage"] === true;

  const triggerOptions = useMemo(() => {
    const known = new Map(TRIGGERS.map((trigger) => [trigger.key, trigger.label]));
    for (const trigger of availableTriggers.data ?? []) {
      if (!known.has(trigger)) known.set(trigger, trigger);
    }
    return [...known].map(([key, label]) => ({ key, label }));
  }, [availableTriggers.data]);

  const templateGroups = useMemo(() => {
    const groups = new Map<string, TemplateGroup>();
    for (const template of templates.data?.items ?? []) {
      const key = groupKey(template);
      const group = groups.get(key) ?? { key, templates: [] };
      group.templates.push(template);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.templates[0]!.name.localeCompare(b.templates[0]!.name));
  }, [templates.data]);

  const visibleGroups = templateGroups.filter((group) =>
    !filterTrigger || group.templates.some((template) => template.triggerEvent === filterTrigger),
  );

  const resetEditor = (): void => {
    setDraft(emptyDraft());
    setEditingGroupKey(null);
    setPreview(null);
    setPreviewTemplateId(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      const eventKey = triggerKey(draft);
      if (!draft.name.trim() || !eventKey) {
        throw new Error(ui("Name, trigger event and at least one message body are required."));
      }
      const selectedLocales = LOCALES.filter(({ code }) => draft.localized[code]?.included);
      if (selectedLocales.length === 0) {
        throw new Error(ui("Select at least one language to save."));
      }
      for (const { code } of selectedLocales) {
        const content = draft.localized[code]!;
        if (!content.bodyText.trim() && !content.bodyHtml.trim()) {
          throw new Error(ui("Add a message body for each selected language."));
        }
      }

      const editingIds = new Set(
        Object.values(draft.localized).map((content) => content.id).filter((id): id is string => Boolean(id)),
      );
      const duplicates = (templates.data?.items ?? []).filter((template) =>
        !editingIds.has(template.id) &&
        selectedLocales.some(({ code }) => code === template.locale) &&
        template.name.toLocaleLowerCase() === draft.name.trim().toLocaleLowerCase(),
      );
      if (duplicates.length > 0) {
        throw new Error(ui("A template with this name already exists for one of the selected languages."));
      }

      const removedIds = Object.values(draft.localized)
        .filter((content) => content.id && !content.included)
        .map((content) => content.id!);
      const upserts = [];
      for (const { code } of selectedLocales) {
        const content = draft.localized[code]!;
        upserts.push({
          ...(content.id ? { id: content.id } : {}),
          name: draft.name.trim(),
          locale: code,
          triggerEvent: eventKey,
          channel: draft.channel,
          subject: content.subject,
          bodyText: content.bodyText,
          bodyHtml: content.bodyHtml,
          transactional: draft.transactional,
          fallbackChannel: content.id ? draft.fallbackChannel || null : draft.fallbackChannel || undefined,
        });
      }
      await fetchApi("/admin/notification-templates/bulk", {
        method: "POST",
        body: JSON.stringify({ upserts, deleteIds: removedIds }),
      });
    },
    onSuccess: async () => {
      setNotice(ui("Notification templates saved for selected languages."));
      resetEditor();
      await queryClient.invalidateQueries({ queryKey: ["notification-templates"] });
      await queryClient.invalidateQueries({ queryKey: ["notification-template-triggers"] });
    },
    onError: async (error: Error) => {
      setNotice(error.message);
      await queryClient.invalidateQueries({ queryKey: ["notification-templates"] });
      await queryClient.invalidateQueries({ queryKey: ["notification-template-triggers"] });
    },
  });

  const previewTemplate = useMutation({
    mutationFn: async (templateId: string) => {
      let parsedVariables: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(variables);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        parsedVariables = parsed as Record<string, unknown>;
      } catch {
        throw new Error(ui("Preview data must be a JSON object."));
      }
      return fetchApi<{ subject: string | null; bodyHtml: string | null; bodyText: string | null }>(
        `/admin/notification-templates/${templateId}/preview`,
        { method: "POST", body: JSON.stringify({ variables: parsedVariables }) },
      );
    },
    onSuccess: (data, templateId) => {
      setPreview(data);
      setPreviewTemplateId(templateId);
    },
    onError: (error: Error) => setNotice(error.message),
  });

  function editGroup(group: TemplateGroup): void {
    const first = group.templates[0]!;
    const known = TRIGGERS.some((trigger) => trigger.key === first.triggerEvent);
    const localized = Object.fromEntries(LOCALES.map(({ code }) => {
      const template = getTemplateByLocale(group, code);
      return [code, template
        ? {
          id: template.id,
          included: true,
          subject: template.subject ?? "",
          bodyText: template.bodyText ?? "",
          bodyHtml: template.bodyHtml ?? "",
        }
        : emptyLocalizedDraft(false)];
    }));
    setEditingGroupKey(group.key);
    setDraft({
      name: first.name,
      triggerChoice: known ? first.triggerEvent ?? "registration" : CUSTOM_TRIGGER,
      customTrigger: known ? "" : first.triggerEvent ?? "",
      channel: first.channel,
      localized,
      transactional: first.transactional,
      fallbackChannel: first.fallbackChannel ?? "",
    });
    setPreview(null);
    setPreviewTemplateId(null);
    setNotice(null);
  }

  function startNewTemplate(): void {
    resetEditor();
    setNotice(null);
    document.getElementById("template-name")?.focus();
  }

  const selectedTrigger = TRIGGERS.find((trigger) => trigger.key === triggerKey(draft));
  const triggerDescription = selectedTrigger?.description;
  const availableVariables = selectedTrigger?.variables ?? MEMBER_IDENTITY;

  function updateLocalized(locale: string, update: Partial<LocalizedDraft>): void {
    setDraft((current) => ({
      ...current,
      localized: {
        ...current.localized,
        [locale]: { ...current.localized[locale]!, ...update },
      },
    }));
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{ui("Notification templates")}</h1>
          <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
            {ui("Configure translated versions of a notification together, with the variables available for its trigger.")}
          </p>
        </div>
        {canManage && <Button variant="outline" onClick={startNewTemplate}><Plus className="mr-2 h-4 w-4" />{ui("Create notification template")}</Button>}
      </div>

      <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        <div className="flex gap-2"><Bell className="mt-0.5 h-4 w-4 shrink-0" /><p>{ui("A trigger key only selects a template; the application must emit that trigger for a notification to be sent. Custom trigger keys work only when an integration or system feature emits them.")}</p></div>
      </div>

      {notice && <p role="status" className="rounded-md border p-3 text-sm">{notice}</p>}
      {(templates.error || admin.error) && <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{templates.error?.message ?? admin.error?.message}</p>}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>{ui(editingGroupKey ? "Edit notification template" : "Create notification template")}</CardTitle>
            <CardDescription>{ui("Edit several language versions in one form. Each selected language is saved as its own localized template.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div><Label htmlFor="template-name">{ui("Template name")}</Label><Input id="template-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="credit-received" /></div>
              <div>
                <Label htmlFor="template-trigger">{ui("Notification type")}</Label>
                <select id="template-trigger" className={selectClass} value={draft.triggerChoice} onChange={(event) => setDraft({ ...draft, triggerChoice: event.target.value, customTrigger: event.target.value === CUSTOM_TRIGGER ? draft.customTrigger : "" })}>
                  {TRIGGERS.map((trigger) => <option key={trigger.key} value={trigger.key}>{ui(trigger.label)} · {trigger.key}</option>)}
                  <option value={CUSTOM_TRIGGER}>{ui("Custom trigger key")}</option>
                </select>
                {triggerDescription && <p className="mt-1 text-xs text-muted-foreground">{ui(triggerDescription)}</p>}
              </div>
              {draft.triggerChoice === CUSTOM_TRIGGER && <div><Label htmlFor="custom-trigger">{ui("Custom trigger key")}</Label><Input id="custom-trigger" value={draft.customTrigger} onChange={(event) => setDraft({ ...draft, customTrigger: event.target.value })} placeholder="integration.event-name" /></div>}
              <div><Label htmlFor="template-channel">{ui("Delivery channel")}</Label><select id="template-channel" className={selectClass} value={draft.channel} onChange={(event) => setDraft({ ...draft, channel: event.target.value as Channel })}>{CHANNELS.map((channel) => <option key={channel} value={channel}>{ui(channelLabel(channel))}</option>)}</select></div>
              <div><Label htmlFor="template-fallback">{ui("Fallback channel")}</Label><select id="template-fallback" className={selectClass} value={draft.fallbackChannel} onChange={(event) => setDraft({ ...draft, fallbackChannel: event.target.value as "" | Channel })}><option value="">{ui("No fallback")}</option>{CHANNELS.map((channel) => <option key={channel} value={channel}>{ui(channelLabel(channel))}</option>)}</select></div>
            </div>

            <section className="space-y-3" aria-labelledby="template-variables-title">
              <div>
                <h3 id="template-variables-title" className="text-sm font-semibold">{ui("Available variables for this notification")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedTrigger
                    ? ui("This list updates when you change the notification type. Insert a variable in a message with double braces, for example {{member.firstName}}.")
                    : ui("Custom triggers can provide their own payload fields. The list below shows common member fields; check your integration payload for additional variables.")}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {availableVariables.map((variable) => (
                  <div key={variable.path} className="min-w-0 rounded-md border bg-muted/20 p-2">
                    <code className="break-all text-xs font-semibold">{`{{${variable.path}}}`}</code>
                    <p className="mt-1 text-xs text-muted-foreground">{ui(variable.description)}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold">{ui("Languages")}</h3>
              <div className="grid gap-4 xl:grid-cols-2">
                {LOCALES.map(({ code, label }) => {
                  const content = draft.localized[code]!;
                  const alreadyExists = Boolean(content.id);
                  return (
                    <section key={code} className="space-y-3 rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-3 border-b pb-3">
                        <div>
                          <h4 className="font-medium">{ui(label)} <span className="text-xs text-muted-foreground">({code})</span></h4>
                          <p className="text-xs text-muted-foreground">{alreadyExists ? ui("Translation already configured") : ui("Add this language version")}</p>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={content.included}
                            onChange={(event) => updateLocalized(code, { included: event.target.checked })}
                          />
                          {ui("Include")}
                        </label>
                      </div>
                      <fieldset disabled={!content.included} className="space-y-3 disabled:opacity-50">
                        <div><Label htmlFor={`template-subject-${code}`}>{ui("Subject")}</Label><Input id={`template-subject-${code}`} value={content.subject} onChange={(event) => updateLocalized(code, { subject: event.target.value })} placeholder={ui("Optional subject")} /></div>
                        <div><Label htmlFor={`template-body-text-${code}`}>{ui("Message text")}</Label><Textarea id={`template-body-text-${code}`} rows={5} value={content.bodyText} onChange={(event) => updateLocalized(code, { bodyText: event.target.value })} placeholder={'Hello {{member.firstName}}, you received {{amount}} points.'} /></div>
                        <div><Label htmlFor={`template-body-html-${code}`}>{ui("HTML message (optional)")}</Label><Textarea id={`template-body-html-${code}`} rows={4} value={content.bodyHtml} onChange={(event) => updateLocalized(code, { bodyHtml: event.target.value })} placeholder={'<p>Hello {{member.firstName}}</p>'} /></div>
                      </fieldset>
                    </section>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.transactional} onChange={(event) => setDraft({ ...draft, transactional: event.target.checked })} />{ui("Transactional — ignore member channel opt-outs")}</label>
            <div className="flex flex-wrap gap-2">
              <Button disabled={save.isPending || !draft.name.trim() || !triggerKey(draft) || !LOCALES.some(({ code }) => draft.localized[code]?.included)} onClick={() => save.mutate()}><Save className="mr-2 h-4 w-4" />{save.isPending ? ui("Saving…") : ui("Save selected languages")}</Button>
              {editingGroupKey && <Button variant="outline" onClick={resetEditor}><X className="mr-2 h-4 w-4" />{ui("Cancel edit")}</Button>}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div><CardTitle>{ui("Configured notification templates")}</CardTitle><CardDescription>{ui("Templates are matched by notification type and member language.")}</CardDescription></div>
          <div className="min-w-56"><Label htmlFor="filter-trigger" className="sr-only">{ui("Filter by notification type")}</Label><select id="filter-trigger" className={selectClass} value={filterTrigger} onChange={(event) => { setFilterTrigger(event.target.value); setTemplatePage(1); }}><option value="">{ui("All notification types")}</option>{triggerOptions.map((trigger) => <option key={trigger.key} value={trigger.key}>{ui(trigger.label)} · {trigger.key}</option>)}</select></div>
        </CardHeader>
        <CardContent>
          {templates.isLoading ? <p className="text-sm text-muted-foreground">{ui("Loading…")}</p> : visibleGroups.length === 0 ? <p className="text-sm text-muted-foreground">{ui("No notification templates found.")}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">{ui("Notification type")}</th><th className="p-2">{ui("Template")}</th><th className="p-2">{ui("Languages / channel")}</th><th className="p-2">{ui("Created by")}</th><th className="p-2 text-right">{ui("Actions")}</th></tr></thead>
                <tbody>
                  {visibleGroups.map((group) => {
                    const template = group.templates[0]!;
                    const trigger = TRIGGERS.find((item) => item.key === template.triggerEvent);
                    const creators = [...new Set(group.templates.map((item) => item.createdBy?.name).filter((name): name is string => Boolean(name)))];
                    return <tr key={group.key} className="border-b align-top last:border-0">
                      <td className="p-2"><p className="font-medium">{ui(trigger?.label ?? template.triggerEvent ?? "No trigger")}</p><code className="text-xs text-muted-foreground">{template.triggerEvent || "—"}</code></td>
                      <td className="p-2"><p className="font-medium">{template.name}</p><p className="max-w-sm truncate text-xs text-muted-foreground">{template.subject || template.bodyText || template.bodyHtml || "—"}</p></td>
                      <td className="p-2">
                        {group.templates.map((localized) => <div key={localized.id} className="flex items-center justify-between gap-2 py-0.5"><span>{ui(languageLabel(localized.locale))} · {ui(channelLabel(localized.channel))}</span><Button size="sm" variant="ghost" disabled={previewTemplate.isPending} onClick={() => previewTemplate.mutate(localized.id)}><Eye className="mr-1 h-3.5 w-3.5" />{ui("Preview")}</Button></div>)}
                        {template.transactional && <p className="text-xs text-muted-foreground">{ui("Transactional")}</p>}
                      </td>
                      <td className="p-2">{creators.length > 0 ? creators.join(", ") : ui("System / legacy")}</td>
                      <td className="p-2"><div className="flex justify-end">{canManage && <Button size="sm" variant="outline" onClick={() => editGroup(group)}><Pencil className="mr-1 h-4 w-4" />{ui("Edit translations")}</Button>}</div></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
          {templates.data && templates.data.totalPages > 1 && <div className="mt-4 flex items-center justify-between"><Button variant="outline" size="sm" disabled={templatePage <= 1} onClick={() => setTemplatePage((value) => value - 1)}>{ui("Previous")}</Button><span className="text-sm text-muted-foreground">{templatePage} / {templates.data.totalPages}</span><Button variant="outline" size="sm" disabled={templatePage >= templates.data.totalPages} onClick={() => setTemplatePage((value) => value + 1)}>{ui("Next")}</Button></div>}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader><CardTitle>{ui("Template preview")}</CardTitle><CardDescription>{ui("Preview uses sample values. Update the JSON to try your own values.")}</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div><Label htmlFor="preview-variables">{ui("Preview data (JSON)")}</Label><Textarea id="preview-variables" rows={8} className="font-mono text-xs" value={variables} onChange={(event) => setVariables(event.target.value)} /></div>
            {preview.subject && <div><p className="mb-1 text-xs font-medium text-muted-foreground">{ui("Subject")}</p><p className="rounded-md border p-3">{preview.subject}</p></div>}
            {(preview.bodyText || preview.bodyHtml) && <div><p className="mb-1 text-xs font-medium text-muted-foreground">{ui("Rendered message")}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">{preview.bodyText || preview.bodyHtml}</pre></div>}
            <Button variant="outline" disabled={previewTemplate.isPending || !previewTemplateId} onClick={() => { if (previewTemplateId) previewTemplate.mutate(previewTemplateId); }}>{ui("Refresh preview")}</Button>
          </CardContent>
        </Card>
      )}

      {canManage && !templates.isLoading && !(templates.data?.items.length) && <Card><CardContent className="pt-6"><Button variant="outline" onClick={startNewTemplate}><Plus className="mr-2 h-4 w-4" />{ui("Create the first template")}</Button></CardContent></Card>}
    </div>
  );
}

function channelLabel(channel: Channel): string {
  const labels: Record<Channel, string> = {
    EMAIL: "Email",
    SMS: "SMS",
    PUSH: "Push notification",
    IN_APP: "In-app",
    WEBHOOK: "Webhook",
  };
  return labels[channel];
}
