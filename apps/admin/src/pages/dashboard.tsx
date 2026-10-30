import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, GripVertical, Plus, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardActions } from "@/components/dashboard-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi } from "@/lib/api-client";
import type { DashboardStats, GiftCardMetrics } from "@/types";

type WidgetMetric = "activeMembers" | "inactiveMembers" | "newMembersLast30Days" | "recentTransactions" | "totalPointsIssued" | "totalPointsRedeemed" | "pointExchanged" | "currentPointBalance" | "recognitionVolume" | "giftCardsActive" | "giftCardsOutstanding" | "pointTypeBalance" | "pointTypeIssued" | "recognitionTrend";
interface DashboardWidget { id: string; metric: WidgetMetric; title: string }
interface DashboardLayout { widgets: DashboardWidget[]; order: string[] }
interface DetailRow { id: string; title: string; description?: string; amount?: number; unit?: string; date?: string | null }
interface DetailPage { items: DetailRow[]; total: number; page: number }
interface DashboardItem { id: string; title: string; metric: string; pointTypeId?: string; snapshot?: boolean; description?: string; value?: string; chart?: { name: string; value: number; secondary?: number }[]; chartLabels?: [string, string?] }
const WIDGET_OPTIONS: Array<{ metric: WidgetMetric; label: string; chart?: boolean; snapshot?: boolean }> = [
  { metric: "activeMembers", label: "Active members", snapshot: true }, { metric: "inactiveMembers", label: "Inactive members", snapshot: true },
  { metric: "newMembersLast30Days", label: "New members" }, { metric: "recentTransactions", label: "Transactions" },
  { metric: "totalPointsIssued", label: "Points issued" }, { metric: "totalPointsRedeemed", label: "Points redeemed" },
  { metric: "pointExchanged", label: "Points exchanged" }, { metric: "currentPointBalance", label: "Primary point balance", snapshot: true },
  { metric: "recognitionVolume", label: "Recognition volume" }, { metric: "giftCardsActive", label: "Active gift cards", snapshot: true },
  { metric: "giftCardsOutstanding", label: "Gift card balance", snapshot: true }, { metric: "pointTypeBalance", label: "Balance by point type", chart: true, snapshot: true },
  { metric: "pointTypeIssued", label: "Issued by point type", chart: true }, { metric: "recognitionTrend", label: "Recognition over time", chart: true },
];
function localDate(value: Date): string { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
function readStoredWidgets(key: string): DashboardWidget[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is DashboardWidget => Boolean(item && typeof item.id === "string" && typeof item.title === "string" && WIDGET_OPTIONS.some((option) => option.metric === item.metric))).slice(0, 30) : [];
  } catch { return []; }
}

function DetailList({ metric, pointTypeId, from, to }: { metric: string; pointTypeId?: string; from: string; to: string }): JSX.Element {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [from, to, metric, pointTypeId]);
  const params = new URLSearchParams({ metric, from, to, page: String(page) });
  if (pointTypeId) params.set("pointTypeId", pointTypeId);
  const query = useQuery({ queryKey: ["dashboard-details", metric, pointTypeId, from, to, page], queryFn: () => fetchApi<DetailPage>(`/stats/dashboard/details?${params.toString()}`) });
  if (query.isLoading) return <p className="text-sm text-muted-foreground">{ui("Loading details…")}</p>;
  if (query.isError) return <p role="alert" className="text-sm text-destructive">{ui("Details could not be loaded. Check your access or try again.")} <button type="button" className="underline" onClick={() => void query.refetch()}>{ui("Try again")}</button></p>;
  const data = query.data;
  return <div className="space-y-2">
    {!data?.items.length ? <p className="text-sm text-muted-foreground">{ui("No matching records.")}</p> : <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">{data.items.map((row) => <li key={row.id} className="flex items-start justify-between gap-3 p-2 text-sm"><div className="min-w-0"><p className="break-words font-medium">{row.title}</p>{row.description && <p className="break-words text-xs text-muted-foreground">{row.description}</p>}{row.date && <p className="text-xs text-muted-foreground">{new Date(row.date).toLocaleString()}</p>}</div>{row.amount !== undefined && <span className="shrink-0 font-semibold tabular-nums">{row.amount.toLocaleString()} {row.unit}</span>}</li>)}</ul>}
    {data && data.total > 20 && <div className="flex items-center justify-between text-xs text-muted-foreground"><button type="button" className="underline disabled:opacity-40" disabled={page === 1} onClick={() => setPage(page - 1)}>{ui("Previous")}</button><span>{ui("Page")} {page} / {Math.ceil(data.total / 20)} · {data.total.toLocaleString()}</span><button type="button" className="underline disabled:opacity-40" disabled={page * 20 >= data.total} onClick={() => setPage(page + 1)}>{ui("Next")}</button></div>}
  </div>;
}

export function DashboardPage(): JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [customizing, setCustomizing] = useState(false);
  const [widgetMetric, setWidgetMetric] = useState<WidgetMetric>("activeMembers");
  const [widgetTitle, setWidgetTitle] = useState("");
  const [from, setFrom] = useState(() => localDate(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(() => localDate(new Date()));
  const [expanded, setExpanded] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const migrated = useRef<string | null>(null);
  const valid = Boolean(from && to && from <= to);
  const fromIso = valid ? new Date(`${from}T00:00:00`).toISOString() : "";
  const toIso = valid ? new Date(`${to}T23:59:59.999`).toISOString() : "";
  const admin = useQuery({ queryKey: ["admin-me-dashboard"], queryFn: () => fetchApi<{ id: string; capabilities: Record<string, boolean> }>("/admin/me") });
  const adminId = admin.data?.id;
  const layoutKey = ["dashboard-layout", adminId ?? "pending"];
  const layout = useQuery({ queryKey: layoutKey, queryFn: () => fetchApi<DashboardLayout>("/admin/dashboard-layout"), enabled: Boolean(adminId) });
  const customWidgets = layout.data?.widgets ?? [];
  const saveDashboard = useMutation({ mutationFn: (body: DashboardLayout) => fetchApi<DashboardLayout>("/admin/dashboard-layout", { method: "PATCH", body: JSON.stringify(body) }), onSuccess: (result) => queryClient.setQueryData(layoutKey, result) });
  useEffect(() => {
    if (!adminId || layout.isLoading || layout.isError || migrated.current === adminId) return;
    migrated.current = adminId;
    if (customWidgets.length) return;
    const widgets = readStoredWidgets(`loyaltyos:dashboard:${adminId}`);
    if (widgets.length) saveDashboard.mutate({ widgets, order: layout.data?.order ?? [] });
  }, [adminId, customWidgets, layout.isError, layout.isLoading, saveDashboard.mutate]);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const stats = useQuery({ queryKey: ["dashboard-stats", fromIso, toIso, timeZone], queryFn: () => fetchApi<DashboardStats>(`/stats/dashboard?${new URLSearchParams({ from: fromIso, to: toIso, timeZone })}`), enabled: valid });
  const gc = useQuery({ queryKey: ["giftcard-metrics"], queryFn: () => fetchApi<GiftCardMetrics>("/admin/giftcards/metrics"), enabled: admin.data?.capabilities?.["giftcard.view"] === true && customWidgets.some((widget) => widget.metric === "giftCardsActive" || widget.metric === "giftCardsOutstanding") });
  const data = stats.data;
  const items = useMemo(() => {
    if (!data) return [];
    const num = (value: number | undefined) => (value ?? 0).toLocaleString();
    const types = data.pointTypeMetrics ?? [];
    const scalar: Record<string, number> = { activeMembers: data.activeMembers, inactiveMembers: data.inactiveMembers ?? 0, newMembersLast30Days: data.newMembersLast30Days ?? 0, recentTransactions: data.recentTransactions, totalPointsIssued: data.totalPointsIssued, totalPointsRedeemed: data.totalPointsRedeemed, pointExchanged: data.pointExchanged ?? 0, currentPointBalance: data.currentPointBalance ?? 0, recognitionVolume: data.recognitionVolume ?? 0, giftCardsActive: gc.data?.active ?? 0, giftCardsOutstanding: gc.data?.outstandingBalance ?? 0 };
    const pointsChart = types.map((row) => ({ name: row.pointType.code, value: row.issued, secondary: row.redeemed }));
    const trend = (data.recognitionOverTime ?? []).map((row) => ({ name: row.date, value: row.count }));
    const built: DashboardItem[] = [
      { id: "activeMembers", metric: "activeMembers", title: ui("Active members"), value: num(data.activeMembers), snapshot: true },
      { id: "newMembersLast30Days", metric: "newMembersLast30Days", title: ui("New members"), value: num(data.newMembersLast30Days) },
      { id: "totalPointsIssued", metric: "totalPointsIssued", title: ui("Points issued"), value: num(data.totalPointsIssued) },
      { id: "totalPointsRedeemed", metric: "totalPointsRedeemed", title: ui("Points redeemed"), value: num(data.totalPointsRedeemed), description: ui("Points spent on rewards; excludes point-exchange requests.") },
      { id: "redemptionRatio", metric: "redemptionRatio", title: ui("Redemption ratio"), value: `${(data.redemptionRatio * 100).toFixed(1)}%` },
      { id: "currentPointBalance", metric: "currentPointBalance", title: `${ui("Primary point balance")}${data.currentPointBalanceType ? ` · ${data.currentPointBalanceType.name}` : ""}`, value: `${num(data.currentPointBalance)} ${data.currentPointBalanceType?.unitLabel ?? ""}`, snapshot: true },
      { id: "pointsChart", metric: "pointsOverview", title: ui("Points overview"), chart: pointsChart, chartLabels: [ui("Points issued"), ui("Points redeemed")] },
      { id: "inactiveMembers", metric: "inactiveMembers", title: ui("Inactive members"), value: num(data.inactiveMembers), snapshot: true },
      { id: "recentTransactions", metric: "recentTransactions", title: ui("Transactions"), value: num(data.recentTransactions) },
      { id: "pointExchanged", metric: "pointExchanged", title: ui("Points exchanged"), value: num(data.pointExchanged), description: ui("Points deducted for exchanges; separate from reward redemptions.") },
      { id: "recognitionVolume", metric: "recognitionVolume", title: ui("Recognition"), value: num(data.recognitionVolume), description: `${num(data.recognitionCount)} ${ui("events")}` },
      ...(data.pointBanks ?? []).map((bank): DashboardItem => ({ id: `bank:${bank.pointType.id}`, metric: "bank", pointTypeId: bank.pointType.id, title: `${bank.pointType.name} · ${ui("Bank")}`, value: `${num(bank.unused)} ${bank.pointType.unitLabel}`, description: `${ui("Allocated")} ${num(bank.used)} · ${ui("Funded")} ${num(bank.issued)}`, snapshot: true })),
      { id: "topRewards", metric: "topRewards", title: ui("Top rewards"), chart: (data.topRewards ?? []).map((row) => ({ name: row.name, value: row.redemptions })), chartLabels: [ui("Redemptions")] },
      { id: "recognitionTrend", metric: "recognitionTrend", title: ui("Recognition over time"), chart: trend, chartLabels: [ui("Recognition")] },
    ];
    for (const widget of customWidgets) {
      const option = WIDGET_OPTIONS.find((entry) => entry.metric === widget.metric);
      if (!option) continue;
      const chart = widget.metric === "recognitionTrend" ? trend : widget.metric === "pointTypeIssued" ? types.map((row) => ({ name: row.pointType.code, value: row.issued })) : widget.metric === "pointTypeBalance" ? types.map((row) => ({ name: row.pointType.code, value: row.balance })) : undefined;
      built.push({ id: `custom:${widget.id}`, metric: widget.metric, title: widget.title, snapshot: option.snapshot, ...(option.chart ? { chart, chartLabels: [ui(option.label)] as [string] } : { value: num(scalar[widget.metric]) }) });
    }
    const order = layout.data?.order ?? [];
    const rank = new Map(order.map((id, index) => [id, index]));
    return built.map((item, index) => ({ item, index })).sort((a, b) => (rank.get(a.item.id) ?? order.length + a.index) - (rank.get(b.item.id) ?? order.length + b.index)).map(({ item }) => item);
  }, [data, gc.data, customWidgets, layout.data?.order]);
  const persist = (widgets: DashboardWidget[], order: string[]) => { if (!saveDashboard.isPending) saveDashboard.mutate({ widgets, order }); };
  const reorder = (id: string, target: string) => { const ids = items.map((item) => item.id); const fromIndex = ids.indexOf(id), toIndex = ids.indexOf(target); if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return; ids.splice(fromIndex, 1); ids.splice(toIndex, 0, id); persist(customWidgets, ids); };
  const addWidget = () => { const option = WIDGET_OPTIONS.find((entry) => entry.metric === widgetMetric); if (!option || customWidgets.length >= 30) return; const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`; persist([...customWidgets, { id, metric: widgetMetric, title: widgetTitle.trim() || ui(option.label) }], [...items.map((item) => item.id), `custom:${id}`]); setWidgetTitle(""); };
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold">{t("dashboard.title")}</h1><p className="mt-1 text-sm text-muted-foreground">{ui("Select a date range and open cards for details.")}</p></div><Button variant={customizing ? "default" : "outline"} onClick={() => setCustomizing(!customizing)}>{customizing ? <X className="mr-2 h-4 w-4" /> : <Settings2 className="mr-2 h-4 w-4" />}{customizing ? ui("Done") : ui("Customize dashboard")}</Button></div>
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"><label className="text-sm">{ui("From date")}<Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="text-sm">{ui("To date")}<Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><p className="max-w-xl text-xs text-muted-foreground">{ui("Dates filter activity. Current balances and statuses show the latest state.")}</p>{!valid && <p role="alert" className="text-sm text-destructive">{ui("Select a valid date range.")}</p>}</div>
    {saveDashboard.isPending && <p role="status" className="text-sm text-muted-foreground">{ui("Saving dashboard…")}</p>}{(saveDashboard.isError || layout.isError) && <p role="alert" className="text-sm text-destructive">{ui("Dashboard could not be saved or loaded. Please try again.")}</p>}
    {customizing && <div className="grid gap-3 rounded-md border bg-muted/30 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"><div><Label htmlFor="dashboard-widget-metric">{ui("Metric")}</Label><select id="dashboard-widget-metric" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={widgetMetric} onChange={(event) => setWidgetMetric(event.target.value as WidgetMetric)}>{WIDGET_OPTIONS.map((option) => <option key={option.metric} value={option.metric}>{ui(option.label)} · {option.chart ? ui("Chart") : ui("Number")}</option>)}</select></div><div><Label htmlFor="dashboard-widget-title">{ui("Title (optional)")}</Label><Input id="dashboard-widget-title" className="mt-1" value={widgetTitle} onChange={(event) => setWidgetTitle(event.target.value)} /></div><Button type="button" onClick={addWidget} disabled={saveDashboard.isPending || layout.isLoading || customWidgets.length >= 30}><Plus className="mr-2 h-4 w-4" />{ui("Add widget")}</Button><p className="text-xs text-muted-foreground md:col-span-3">{ui("Drag cards to reorder, or use the arrow buttons. Your layout is saved to your account.")}</p></div>}
    {stats.isLoading && valid && <p role="status">{ui("Loading…")}</p>}{stats.isError && <p role="alert" className="text-destructive">{ui("Dashboard could not be loaded.")} <button type="button" className="underline" onClick={() => void stats.refetch()}>{ui("Try again")}</button></p>}
    {data && valid && <><DashboardActions banks={data.pointBanks ?? []} /><div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 lg:grid-cols-3">{items.map((item, index) => {
      const isOpen = expanded.includes(item.id);
      return <Card key={item.id} onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a, input, select, textarea, [role=button]")) setExpanded((current) => isOpen ? current.filter((id) => id !== item.id) : [...current, item.id]); }} draggable={customizing && !saveDashboard.isPending} onDragStart={(event) => { setDragging(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }} onDragEnd={() => setDragging(null)} onDragOver={(event) => { if (customizing) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); const source = event.dataTransfer.getData("text/plain") || dragging; if (source) reorder(source, item.id); setDragging(null); }} className={`flex min-w-0 flex-col ${item.chart ? "min-h-[20rem] md:col-span-2" : isOpen ? "h-96" : "h-40"} ${dragging === item.id ? "opacity-50" : ""}`}  >
        <CardHeader className="shrink-0 pb-2"><div className="flex items-center justify-between gap-2"><button type="button" onClick={() => setExpanded((current) => isOpen ? current.filter((id) => id !== item.id) : [...current, item.id])} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left" aria-expanded={isOpen}><CardTitle className="text-sm font-medium">{item.title}</CardTitle>{isOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}</button>{customizing && <div className="flex items-center"><GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" aria-hidden="true" /><button type="button" disabled={index === 0 || saveDashboard.isPending} onClick={() => reorder(item.id, items[index - 1]!.id)} aria-label={ui("Move up")} className="p-1 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button><button type="button" disabled={index === items.length - 1 || saveDashboard.isPending} onClick={() => reorder(item.id, items[index + 1]!.id)} aria-label={ui("Move down")} className="p-1 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>{item.id.startsWith("custom:") && <button type="button" onClick={() => persist(customWidgets.filter((widget) => `custom:${widget.id}` !== item.id), items.filter((row) => row.id !== item.id).map((row) => row.id))} aria-label={ui("Remove widget")} className="p-1"><Trash2 className="h-4 w-4" /></button>}</div>}</div></CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto">{item.snapshot && <p className="text-xs text-muted-foreground">{ui("Current snapshot")}</p>}{item.value !== undefined && <p className="text-2xl font-bold tabular-nums">{item.value}</p>}{item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}{item.chart && (item.chart.length ? <ResponsiveContainer width="100%" height={240}><BarChart data={item.chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Legend /><Bar dataKey="value" name={item.chartLabels?.[0] ?? item.title} fill="hsl(221.2 83.2% 53.3%)" />{item.chartLabels?.[1] && <Bar dataKey="secondary" name={item.chartLabels[1]} fill="hsl(20.5 90.2% 48.2%)" />}</BarChart></ResponsiveContainer> : <p className="text-sm text-muted-foreground">{ui("No data available yet.")}</p>)}{isOpen && <div className="border-t pt-3" onClick={(event) => event.stopPropagation()}><DetailList metric={item.metric} pointTypeId={item.pointTypeId} from={fromIso} to={toIso} /></div>}</CardContent>
      </Card>;
    })}</div></>}
  </div>;
}
