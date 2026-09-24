import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchApi } from "@/lib/api-client";
import { memberFieldLabel, ui } from "@/lib/ui-text";

interface Automation {
  mode: string;
  timezone: string;
  dateField: string;
  offsetDays: number;
  date?: string;
  monthDay?: string;
  leapDayPolicy: string;
}

interface Definition {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  automation: Automation;
  createdBy?: { id: string; name: string; email: string | null } | null;
}

interface MemberField {
  key: string;
  label: string;
  type: string;
  isActive: boolean;
}

const modes = {
  EXTERNAL: "External event",
  MANUAL: "Manual event",
  ONBOARDING: "Onboarding",
  MEMBER_DATE_ANNUAL: "Annual member date",
  ANNUAL_DATE: "Fixed annual date",
  ONCE: "One-time date",
};

const defaults = (): Automation => ({
  mode: "EXTERNAL",
  timezone: "Asia/Ho_Chi_Minh",
  dateField: "joinedAt",
  offsetDays: 0,
  leapDayPolicy: "ONLY_LEAP_YEAR",
});

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
const annualMemberModes = ["MEMBER_DATE_ANNUAL", "ANNIVERSARY"];

function preview(automation: Automation, fields: MemberField[]): string {
  if (automation.mode === "EXTERNAL") {
    return ui("An integration can send this event to the Events API. The event name alone does not issue points.");
  }
  if (automation.mode === "MANUAL") {
    return ui("This event is a manual placeholder for campaigns. The campaign runs once after approval.");
  }
  if (automation.mode === "ONBOARDING") {
    return ui("The scheduler checks new member accounts automatically each day.");
  }
  if (annualMemberModes.includes(automation.mode)) {
    const field = automation.dateField === "joinedAt"
      ? ui("Account creation date")
      : (() => {
        const field = fields.find((item) => `metadata.${item.key}` === automation.dateField);
        return field ? memberFieldLabel(field) : automation.dateField;
      })();
    return `${ui("The scheduler checks this member date every day")}: ${field}.`;
  }
  if (automation.mode === "ANNUAL_DATE") {
    return `${ui("The scheduler checks this fixed date every year")}: ${automation.monthDay ?? "—"}.`;
  }
  return `${ui("The scheduler checks this one-time date")}: ${automation.date ?? "—"}.`;
}

export function EventDefinitionsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [automation, setAutomation] = useState<Automation>(defaults);
  const [notice, setNotice] = useState<string | null>(null);
  const [eventStatusTab, setEventStatusTab] = useState("active");

  const definitions = useQuery({
    queryKey: ["event-definitions"],
    queryFn: () => fetchApi<Definition[]>("/admin/event-definitions"),
  });
  const fields = useQuery({
    queryKey: ["member-fields", "occasions"],
    queryFn: () => fetchApi<MemberField[]>("/admin/member-fields"),
  });
  const activeDateFields = (fields.data ?? []).filter((field) => field.type === "DATE" && field.isActive);
  const set = (patch: Partial<Automation>) => setAutomation((current) => ({ ...current, ...patch }));
  const reset = () => {
    setEditing(null);
    setKey("");
    setName("");
    setDescription("");
    setAutomation(defaults());
  };

  const save = useMutation({
    mutationFn: () => fetchApi<Definition>(`/admin/event-definitions${editing ? `/${editing}` : ""}`, {
      method: editing ? "PATCH" : "POST",
      body: JSON.stringify({
        ...(editing ? {} : { key: key.trim().toLowerCase() }),
        name: name.trim(),
        description: description.trim() || undefined,
        automation,
      }),
    }),
    onSuccess: async () => {
      reset();
      setNotice(ui("Event saved."));
      await queryClient.invalidateQueries({ queryKey: ["event-definitions"] });
      await queryClient.invalidateQueries({ queryKey: ["event-definitions", "campaign-builder"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const toggle = useMutation({
    mutationFn: (definition: Definition) => fetchApi(`/admin/event-definitions/${definition.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !definition.isActive }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["event-definitions"] }),
    onError: (error: Error) => setNotice(error.message),
  });

  const dateFieldRequired = annualMemberModes.includes(automation.mode) && automation.dateField !== "joinedAt";
  const canSave = Boolean(name.trim() && (editing || key.trim()) && (!dateFieldRequired || automation.dateField));
  const activeDefinitions = (definitions.data ?? []).filter((definition) => definition.isActive);
  const inactiveDefinitions = (definitions.data ?? []).filter((definition) => !definition.isActive);

  const renderDefinition = (definition: Definition): JSX.Element => (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3" key={definition.id}>
      <div>
        <p>{definition.name} <code className="text-xs">{definition.key}</code></p>
        <p className="text-sm text-muted-foreground">
          {ui(modes[definition.automation.mode as keyof typeof modes] ?? "External event")} · {ui(definition.isActive ? "Active" : "Inactive")}
        </p>
        <p className="text-xs text-muted-foreground">{ui("Created by")}: {definition.createdBy ? `${definition.createdBy.name}${definition.createdBy.email ? ` · ${definition.createdBy.email}` : ""}` : ui("System / legacy")}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => { setEditing(definition.id); setKey(definition.key); setName(definition.name); setDescription(definition.description ?? ""); setAutomation({ ...defaults(), ...definition.automation, mode: definition.automation.mode === "ANNIVERSARY" ? "MEMBER_DATE_ANNUAL" : definition.automation.mode }); }}>{ui("Edit")}</Button>
        <Button variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(definition)}>{ui(definition.isActive ? "Deactivate" : "Activate")}</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="text-3xl font-bold">{ui("Event definitions")}</h1>
        <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
          {ui("Define when an event occurs. Campaigns decide how many points to issue and whether approval is required.")}
        </p>
      </div>
      {(notice || definitions.error) && <p role="status" className="rounded-md border p-3">{notice || definitions.error?.message}</p>}

      <Card>
        <CardHeader>
          <CardTitle>{ui(editing ? "Edit event" : "Create event definition")}</CardTitle>
          <CardDescription>{ui("Choose an internal schedule or an external integration source.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="event-key">{ui("Event key")}</Label>
              <Input id="event-key" disabled={Boolean(editing)} value={key} onChange={(event) => setKey(event.target.value)} placeholder="member.birthday" />
            </div>
            <div>
              <Label htmlFor="event-name">{ui("Display name")}</Label>
              <Input id="event-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={ui("Birthday")} />
            </div>
            <div>
              <Label htmlFor="occasion-mode">{ui("How does this event occur?")}</Label>
              <select id="occasion-mode" className={selectClass} value={automation.mode} onChange={(event) => set({ mode: event.target.value })}>
                {Object.entries(modes).map(([value, label]) => <option key={value} value={value}>{ui(label)}</option>)}
              </select>
            </div>
            {automation.mode !== "EXTERNAL" && automation.mode !== "MANUAL" && (
              <div>
                <Label htmlFor="occasion-timezone">{ui("Timezone")}</Label>
                <Input id="occasion-timezone" value={automation.timezone} onChange={(event) => set({ timezone: event.target.value })} />
              </div>
            )}
            {annualMemberModes.includes(automation.mode) && (
              <div>
                <Label htmlFor="occasion-field">{ui("Member date field")}</Label>
                <select id="occasion-field" className={selectClass} value={automation.dateField} onChange={(event) => set({ dateField: event.target.value })}>
                  <option value="joinedAt">{ui("Account creation date")}</option>
                  {activeDateFields.map((field) => <option key={field.key} value={`metadata.${field.key}`}>{memberFieldLabel(field)}</option>)}
                </select>
                {!activeDateFields.length && <p className="mt-1 text-xs text-muted-foreground">{ui("Create a DATE member field first for birthday or another personal date.")}</p>}
              </div>
            )}
            {automation.mode === "ONBOARDING" && (
              <div>
                <Label htmlFor="occasion-offset">{ui("Days after starting")}</Label>
                <Input id="occasion-offset" type="number" min={0} value={automation.offsetDays} onChange={(event) => set({ offsetDays: Number(event.target.value) })} />
              </div>
            )}
            {automation.mode === "ANNUAL_DATE" && (
              <div>
                <Label htmlFor="occasion-annual">{ui("Annual day and month")}</Label>
                <Input id="occasion-annual" type="date" value={automation.monthDay ? `2000-${automation.monthDay}` : ""} onChange={(event) => set({ monthDay: event.target.value.slice(5) })} />
              </div>
            )}
            {automation.mode === "ONCE" && (
              <div>
                <Label htmlFor="occasion-date">{ui("Event date")}</Label>
                <Input id="occasion-date" type="date" value={automation.date ?? ""} onChange={(event) => set({ date: event.target.value })} />
              </div>
            )}
            {(annualMemberModes.includes(automation.mode) || automation.mode === "ANNUAL_DATE") && (
              <div>
                <Label htmlFor="leap-day-policy">{ui("February 29 handling")}</Label>
                <select id="leap-day-policy" className={selectClass} value={automation.leapDayPolicy} onChange={(event) => set({ leapDayPolicy: event.target.value })}>
                  <option value="ONLY_LEAP_YEAR">{ui("Only run in leap years")}</option>
                  <option value="FEB_28">{ui("Run on February 28 in non-leap years")}</option>
                  <option value="MAR_01">{ui("Run on March 1 in non-leap years")}</option>
                </select>
              </div>
            )}
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{ui("Schedule preview")}</p>
            <p className="mt-1 text-muted-foreground">{preview(automation, activeDateFields)}</p>
            {automation.mode === "EXTERNAL" && <p className="mt-1 font-mono text-xs text-muted-foreground">POST /api/v1/events · type: {key || "your.event.key"}</p>}
          </div>

          {annualMemberModes.includes(automation.mode) && !activeDateFields.length && (
            <Button type="button" variant="link" className="h-auto p-0" onClick={() => navigate("/member-fields")}>
              {ui("Open member fields")}
            </Button>
          )}
          <Label htmlFor="event-description">{ui("Description")}</Label>
          <Textarea id="event-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          <div className="flex gap-2">
            <Button disabled={save.isPending || !canSave} onClick={() => save.mutate()}>{ui("Save event")}</Button>
            {editing && <Button variant="outline" onClick={reset}>{ui("Cancel")}</Button>}
          </div>
        </CardContent>
      </Card>

      {definitions.isLoading && <Card><CardContent className="pt-6"><p>{ui("Loading...")}</p></CardContent></Card>}
      {!definitions.isLoading && (
        <Tabs value={eventStatusTab} onValueChange={setEventStatusTab} className="space-y-4">
          <TabsList className="grid w-full max-w-xl grid-cols-2">
            <TabsTrigger value="active">
              {ui("Active events")} <span className="ml-1 text-xs text-muted-foreground">({activeDefinitions.length})</span>
            </TabsTrigger>
            <TabsTrigger value="inactive">
              {ui("Inactive events")} <span className="ml-1 text-xs text-muted-foreground">({inactiveDefinitions.length})</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="active">
            <Card>
              <CardHeader>
                <CardTitle>{ui("Active events")}</CardTitle>
                <CardDescription>{ui("Events available for campaign triggers and automation.")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {activeDefinitions.length > 0 ? activeDefinitions.map(renderDefinition) : <p className="text-sm text-muted-foreground">{ui("No active events configured.")}</p>}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="inactive">
            <Card>
              <CardHeader>
                <CardTitle>{ui("Inactive events")}</CardTitle>
                <CardDescription>{ui("Inactive events remain available for review but cannot trigger campaigns.")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {inactiveDefinitions.length > 0 ? inactiveDefinitions.map(renderDefinition) : <p className="text-sm text-muted-foreground">{ui("No inactive events.")}</p>}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
