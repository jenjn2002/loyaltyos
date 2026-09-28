import { ui } from "@/lib/ui-text";
import { useQuery } from "@tanstack/react-query";
import { History, Search, X } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi } from "@/lib/api-client";

type ActorType = "ADMIN_USER" | "API_KEY" | "MEMBER" | "SYSTEM";

interface AuditActor {
  type: ActorType;
  id: string;
  name: string | null;
  email: string | null;
}

interface AuditEntry {
  id: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  targetLabel?: string | null;
  diff: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
  actor: AuditActor;
}

interface LogsResponse {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface LogsFilterOptions {
  features: string[];
}

const ACTIONS = [
  "ADJUST_POINTS",
  "REVERSE_TRANSACTION",
  "CREATE_COUPON",
  "DELETE_COUPON",
  "UPDATE_CAMPAIGN",
  "UPDATE_REWARD",
  "MERGE_MEMBERS",
  "MANUAL_TIER_CHANGE",
  "CONFIG_CHANGE",
  "OTHER",
  "CREATE_NOTIFICATION_TEMPLATE",
  "UPDATE_NOTIFICATION_TEMPLATE",
  "DELETE_NOTIFICATION_TEMPLATE",
  "CREATE_WEBHOOK",
  "UPDATE_WEBHOOK",
  "DELETE_WEBHOOK",
  "SEND_TEST_NOTIFICATION",
  "PREVIEW_NOTIFICATION_TEMPLATE",
  "CREDIT_GIVE",
  "CREDIT_REDEEM",
  "CREDIT_EXCHANGE",
  "CREDIT_ADJUSTMENT",
  "CREDIT_BULK",
  "CREDIT_BANK",
  "CREDIT_CLEARANCE",
] as const;

const ACTOR_TYPES: ActorType[] = ["ADMIN_USER", "API_KEY", "MEMBER", "SYSTEM"];
const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

function actionLabel(action: string): string {
  return ui(action.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase()));
}

function actorLabel(actor: AuditActor): string {
  if (actor.name && actor.email) return `${actor.name} · ${actor.email}`;
  if (actor.name) return actor.name;
  return `${ui(actor.type)} · ${actor.id}`;
}

function dateParam(value: string, endOfDay = false): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`).toISOString();
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function dataSummary(value: Record<string, unknown> | null): string {
  if (!value) return "";
  return Object.entries(value)
    .filter(([key]) => !key.toLowerCase().endsWith("id"))
    .filter(([, item]) => item !== null && item !== undefined && typeof item !== "object")
    .slice(0, 4)
    .map(([key, item]) => {
      const label = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ");
      const valueLabel = typeof item === "string" ? item : String(item);
      return `${ui(label)}: ${valueLabel}`;
    })
    .join(" · ");
}

function featureLabel(value: string): string {
  return ui(value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase()));
}

export function LogsPage(): JSX.Element {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [actorInput, setActorInput] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [actorType, setActorType] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pageSize = 25;
  const invalidDateRange = Boolean(from && to && from > to);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setActor(actorInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [actorInput]);

  const filterOptions = useQuery({
    queryKey: ["admin-log-filter-options"],
    queryFn: () => fetchApi<LogsFilterOptions>("/admin/logs/filters"),
  });

  const logs = useQuery({
    queryKey: ["admin-logs", page, search, actor, action, actorType, entityType, from, to],
    enabled: !invalidDateRange,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("q", search.trim());
      if (actor.trim()) params.set("actor", actor.trim());
      if (action) params.set("action", action);
      if (actorType) params.set("actorType", actorType);
      if (entityType) params.set("entityType", entityType);
      const fromValue = dateParam(from);
      const toValue = dateParam(to, true);
      if (fromValue) params.set("from", fromValue);
      if (toValue) params.set("to", toValue);
      return fetchApi<LogsResponse>(`/admin/logs?${params.toString()}`);
    },
  });

  const updateFilter = (setter: (value: string) => void, value: string): void => {
    setter(value);
    setPage(1);
  };

  const clearFilters = (): void => {
    setSearchInput("");
    setSearch("");
    setActorInput("");
    setActor("");
    setAction("");
    setActorType("");
    setEntityType("");
    setFrom("");
    setTo("");
    setPage(1);
  };

  const data = invalidDateRange ? undefined : logs.data;
  const entries = data?.items ?? [];

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><History className="h-7 w-7" />{ui("Logs")}</h1>
        <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
          {ui("Review actions performed in the system, who performed them, the affected feature and recorded data.")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{ui("Filter logs")}</CardTitle>
          <CardDescription>{ui("Use filters to narrow the audit trail by actor, action, feature or date.")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="md:col-span-2 xl:col-span-2">
            <Label htmlFor="logs-search">{ui("Search")}</Label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input id="logs-search" className="pl-9" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={ui("Target name, reason, ID or recorded data")} />
            </div>
          </div>
          <div>
            <Label htmlFor="logs-actor">{ui("Actor")}</Label>
            <Input id="logs-actor" className="mt-1" value={actorInput} onChange={(event) => setActorInput(event.target.value)} placeholder={ui("Name, email or ID")} />
          </div>
          <div>
            <Label htmlFor="logs-action">{ui("Action")}</Label>
            <select id="logs-action" className={`${selectClass} mt-1`} value={action} onChange={(event) => updateFilter(setAction, event.target.value)}>
              <option value="">{ui("All actions")}</option>
              {ACTIONS.map((value) => <option key={value} value={value}>{actionLabel(value)}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="logs-actor-type">{ui("Actor type")}</Label>
            <select id="logs-actor-type" className={`${selectClass} mt-1`} value={actorType} onChange={(event) => updateFilter(setActorType, event.target.value)}>
              <option value="">{ui("All actors")}</option>
              {ACTOR_TYPES.map((value) => <option key={value} value={value}>{ui(value)}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="logs-entity">{ui("Feature")}</Label>
            <select id="logs-entity" className={`${selectClass} mt-1`} value={entityType} onChange={(event) => updateFilter(setEntityType, event.target.value)}>
              <option value="">{ui("All features")}</option>
              {entityType && !filterOptions.data?.features.includes(entityType) && <option value={entityType}>{featureLabel(entityType)}</option>}
              {(filterOptions.data?.features ?? []).map((value) => <option key={value} value={value}>{featureLabel(value)}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="logs-from">{ui("From")}</Label>
            <Input id="logs-from" className="mt-1" type="date" value={from} onChange={(event) => updateFilter(setFrom, event.target.value)} />
          </div>
          <div>
            <Label htmlFor="logs-to">{ui("To")}</Label>
            <Input id="logs-to" className="mt-1" type="date" value={to} onChange={(event) => updateFilter(setTo, event.target.value)} />
          </div>
          <div className="flex items-end">
            <Button type="button" variant="outline" onClick={clearFilters}><X className="mr-2 h-4 w-4" />{ui("Clear filters")}</Button>
          </div>
        </CardContent>
      </Card>

      {invalidDateRange && <p role="alert" className="text-sm text-destructive">{ui("The end date must be on or after the start date.")}</p>}

      <Card>
        <CardHeader>
          <CardTitle>{ui("System activity")}</CardTitle>
          <CardDescription>{data ? `${String(data.total)} ${ui("log entries")}` : ui("Loading logs…")}</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.isError && !invalidDateRange && <p className="text-destructive">{ui("Failed to load logs.")}</p>}
          {logs.isLoading && <p className="text-sm text-muted-foreground">{ui("Loading logs…")}</p>}
          {!logs.isLoading && !logs.isError && !entries.length && <p className="text-sm text-muted-foreground">{ui("No log entries found.")}</p>}
          {!logs.isLoading && !logs.isError && entries.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{ui("Date")}</TableHead>
                    <TableHead>{ui("Actor")}</TableHead>
                    <TableHead>{ui("Action")}</TableHead>
                    <TableHead>{ui("Feature")}</TableHead>
                    <TableHead>{ui("Target")}</TableHead>
                    <TableHead>{ui("Data")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <Fragment key={entry.id}>
                      <TableRow key={entry.id} className="cursor-pointer" onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</TableCell>
                        <TableCell className="min-w-48"><p className="font-medium">{actorLabel(entry.actor)}</p><p className="text-xs text-muted-foreground">{ui(entry.actorType)}</p></TableCell>
                        <TableCell className="whitespace-nowrap">{actionLabel(entry.action)}</TableCell>
                        <TableCell><code className="text-xs">{featureLabel(entry.entityType)}</code></TableCell>
                        <TableCell className="max-w-56 truncate text-xs" title={entry.targetLabel ?? entry.entityId ?? undefined}>
                          <span>{entry.targetLabel ?? entry.entityId ?? "—"}</span>
                          {entry.targetLabel && entry.entityId && <span className="ml-1 text-muted-foreground">({entry.entityId})</span>}
                        </TableCell>
                        <TableCell className="max-w-80 text-xs">
                          <p className="truncate" title={dataSummary(entry.diff)}>{dataSummary(entry.diff) || (entry.diff ? ui("View details") : "—")}</p>
                          {entry.reason && <p className="truncate text-muted-foreground" title={entry.reason}>{ui("Reason")}: {entry.reason}</p>}
                        </TableCell>
                      </TableRow>
                      {expandedId === entry.id && (
                        <TableRow key={`${entry.id}-details`}>
                          <TableCell colSpan={6} className="bg-muted/30">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{ui("Recorded data")}</p><pre className="max-h-64 overflow-auto rounded-md border bg-background p-3 text-xs">{prettyJson(entry.diff)}</pre></div>
                              <div className="space-y-2 text-sm"><p><strong>{ui("Actor ID")}:</strong> {entry.actorId}</p><p><strong>{ui("Feature")}:</strong> {featureLabel(entry.entityType)}</p><p><strong>{ui("Target")}:</strong> {entry.targetLabel ?? "—"}</p><p><strong>{ui("Target ID")}:</strong> {entry.entityId ?? "—"}</p><p><strong>{ui("Reason")}:</strong> {entry.reason ?? "—"}</p></div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
              {data && data.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { setPage((value) => value - 1); setExpandedId(null); }}>{ui("Previous")}</Button>
                  <span className="text-sm text-muted-foreground">{ui("Page")} {page} {ui("of")} {data.totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => { setPage((value) => value + 1); setExpandedId(null); }}>{ui("Next")}</Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
