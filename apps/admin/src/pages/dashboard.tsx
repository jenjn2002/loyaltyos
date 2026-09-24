import { ui } from "@/lib/ui-text";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Gift, Percent, Plus, Settings2, Trash2, Users, WalletCards, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchApi } from "@/lib/api-client";
import type { DashboardStats, GiftCardMetrics } from "@/types";

type WidgetMetric =
  | "activeMembers"
  | "inactiveMembers"
  | "newMembersLast30Days"
  | "recentTransactions"
  | "totalPointsIssued"
  | "totalPointsRedeemed"
  | "pointExchanged"
  | "currentPointBalance"
  | "recognitionVolume"
  | "giftCardsActive"
  | "giftCardsOutstanding"
  | "pointTypeBalance"
  | "pointTypeIssued"
  | "recognitionTrend";

interface DashboardWidget {
  id: string;
  metric: WidgetMetric;
  title: string;
}

interface WidgetOption {
  metric: WidgetMetric;
  label: string;
  kind: "KPI" | "CHART";
}

const WIDGET_OPTIONS: WidgetOption[] = [
  { metric: "activeMembers", label: "Active members", kind: "KPI" },
  { metric: "inactiveMembers", label: "Inactive members", kind: "KPI" },
  { metric: "newMembersLast30Days", label: "New members · last 30 days", kind: "KPI" },
  { metric: "recentTransactions", label: "Transactions · last 7 days", kind: "KPI" },
  { metric: "totalPointsIssued", label: "Points issued", kind: "KPI" },
  { metric: "totalPointsRedeemed", label: "Points redeemed", kind: "KPI" },
  { metric: "pointExchanged", label: "Points exchanged", kind: "KPI" },
  { metric: "currentPointBalance", label: "Current point balance", kind: "KPI" },
  { metric: "recognitionVolume", label: "Recognition volume", kind: "KPI" },
  { metric: "giftCardsActive", label: "Active gift cards", kind: "KPI" },
  { metric: "giftCardsOutstanding", label: "Gift card balance", kind: "KPI" },
  { metric: "pointTypeBalance", label: "Balance by point type", kind: "CHART" },
  { metric: "pointTypeIssued", label: "Issued by point type", kind: "CHART" },
  { metric: "recognitionTrend", label: "Recognition · last 30 days", kind: "CHART" },
];

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

function readStoredWidgets(key: string): DashboardWidget[] {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is DashboardWidget => {
      if (!item || typeof item !== "object") return false;
      const value = item as Partial<DashboardWidget>;
      return typeof value.id === "string" && typeof value.title === "string" && WIDGET_OPTIONS.some((option) => option.metric === value.metric);
    });
  } catch {
    return [];
  }
}

export function DashboardPage(): JSX.Element {
  const { t } = useTranslation();
  const [customizing, setCustomizing] = useState(false);
  const [widgetMetric, setWidgetMetric] = useState<WidgetMetric>("activeMembers");
  const [widgetTitle, setWidgetTitle] = useState("");
  const [customWidgets, setCustomWidgets] = useState<DashboardWidget[]>([]);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);

  const admin = useQuery({
    queryKey: ["admin-me-dashboard"],
    queryFn: () => fetchApi<{ id: string }>("/admin/me"),
  });
  const storageKey = admin.data?.id ? `loyaltyos:dashboard:${admin.data.id}` : null;

  useEffect(() => {
    if (!storageKey || loadedStorageKey === storageKey) return;
    setCustomWidgets(readStoredWidgets(storageKey));
    setLoadedStorageKey(storageKey);
  }, [loadedStorageKey, storageKey]);

  useEffect(() => {
    if (!storageKey || loadedStorageKey !== storageKey) return;
    localStorage.setItem(storageKey, JSON.stringify(customWidgets));
  }, [customWidgets, loadedStorageKey, storageKey]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fetchApi<DashboardStats>("/stats/dashboard"),
  });

  const { data: gcMetrics } = useQuery({
    queryKey: ["giftcard-metrics"],
    queryFn: () => fetchApi<GiftCardMetrics>("/admin/giftcards/metrics"),
  });

  const addWidget = (): void => {
    const option = WIDGET_OPTIONS.find((item) => item.metric === widgetMetric);
    if (!option) return;
    const title = widgetTitle.trim() || ui(option.label);
    setCustomWidgets((current) => [
      ...current,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, metric: widgetMetric, title },
    ]);
    setWidgetTitle("");
  };

  const removeWidget = (id: string): void => {
    setCustomWidgets((current) => current.filter((widget) => widget.id !== id));
  };

  const scalarValue = (metric: WidgetMetric): number => {
    if (!data) return 0;
    const values: Record<string, number> = {
      activeMembers: data.activeMembers,
      inactiveMembers: data.inactiveMembers ?? 0,
      newMembersLast30Days: data.newMembersLast30Days ?? 0,
      recentTransactions: data.recentTransactions,
      totalPointsIssued: data.totalPointsIssued,
      totalPointsRedeemed: data.totalPointsRedeemed,
      pointExchanged: data.pointExchanged ?? 0,
      currentPointBalance: data.currentPointBalance ?? 0,
      recognitionVolume: data.recognitionVolume ?? 0,
      giftCardsActive: gcMetrics?.active ?? 0,
      giftCardsOutstanding: gcMetrics?.outstandingBalance ?? 0,
    };
    return values[metric] ?? 0;
  };

  const chartRows = (metric: WidgetMetric): { name: string; value: number }[] => {
    if (!data) return [];
    if (metric === "recognitionTrend") {
      return (data.recognitionOverTime ?? []).map((item) => ({ name: item.date, value: item.count }));
    }
    return (data.pointTypeMetrics ?? []).map((item) => ({
      name: item.pointType.code,
      value: metric === "pointTypeIssued" ? item.issued : item.balance,
    }));
  };

  const renderCustomWidget = (widget: DashboardWidget): JSX.Element => {
    const option = WIDGET_OPTIONS.find((item) => item.metric === widget.metric);
    if (option?.kind === "CHART") {
      const rows = chartRows(widget.metric);
      return (
        <Card key={widget.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
            {customizing && <Button variant="ghost" size="sm" onClick={() => { removeWidget(widget.id); }} aria-label={ui("Remove widget")}><Trash2 className="h-4 w-4" /></Button>}
          </CardHeader>
          <CardContent>
            {rows.length ? (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={rows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Bar dataKey="value" fill="hsl(221.2 83.2% 53.3%)" />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground">{ui("No data available yet.")}</p>}
          </CardContent>
        </Card>
      );
    }
    return (
      <Card key={widget.id}>
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{widget.title}</CardTitle>
          {customizing && <Button variant="ghost" size="sm" onClick={() => { removeWidget(widget.id); }} aria-label={ui("Remove widget")}><Trash2 className="h-4 w-4" /></Button>}
        </CardHeader>
        <CardContent><p className="text-2xl font-bold">{scalarValue(widget.metric).toLocaleString()}</p></CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">{t("dashboard.title")}</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">{t("dashboard.title")}</h1>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-destructive">
              {error instanceof Error ? error.message : t("dashboard.failedToLoad")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const chartData = data.pointTypeMetrics?.length
    ? data.pointTypeMetrics.map((item) => ({
        name: item.pointType.code,
        Issued: item.issued,
        Redeemed: item.redeemed,
      }))
    : [{ name: t("dashboard.pointsIssued"), Issued: data.totalPointsIssued, Redeemed: data.totalPointsRedeemed }];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t("dashboard.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{ui("Use the overview for common metrics or build a small personal dashboard below.")}</p>
        </div>
        <Button variant={customizing ? "default" : "outline"} onClick={() => { setCustomizing((value) => !value); }}>
          {customizing ? <X className="mr-2 h-4 w-4" /> : <Settings2 className="mr-2 h-4 w-4" />}
          {customizing ? ui("Close dashboard builder") : ui("Customize dashboard")}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("dashboard.activeMembers")}
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.activeMembers.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{ui("New members · last 30 days")}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{(data.newMembersLast30Days ?? 0).toLocaleString()}</p></CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("dashboard.pointsIssued")}
            </CardTitle>
            <ArrowUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">
              {data.totalPointsIssued.toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("dashboard.pointsRedeemed")}
            </CardTitle>
            <ArrowDown className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-orange-600">
              {data.totalPointsRedeemed.toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("dashboard.redemptionRatio")}
            </CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{(data.redemptionRatio * 100).toFixed(1)}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {ui("Active gift cards")}
            </CardTitle>
            <Gift className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {gcMetrics
                ? `${gcMetrics.active.toLocaleString()} ${t("giftcards.cards").toLowerCase()}`
                : "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{ui("Current point balance")}</CardTitle>
            <WalletCards className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{(data.currentPointBalance ?? 0).toLocaleString()}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.pointsOverview")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Bar dataKey="Issued" fill="hsl(142.1 76.2% 36.3%)" />
              <Bar dataKey="Redeemed" fill="hsl(20.5 90.2% 48.2%)" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{ui("Inactive members")}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{(data.inactiveMembers ?? 0).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{ui("Transactions · last 7 days")}</CardTitle>
            <WalletCards className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.recentTransactions.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{ui("Points exchanged")}</CardTitle>
            <ArrowDown className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600">
              {(data.pointExchanged ?? 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{ui("Recognition")}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{(data.recognitionVolume ?? 0).toLocaleString()}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {(data.recognitionCount ?? 0).toLocaleString()} events
            </p>
          </CardContent>
        </Card>
      </div>

      {(customizing || customWidgets.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>{ui("My dashboard")}</CardTitle>
            <p className="text-sm text-muted-foreground">{ui("Add simple metric cards or charts. Your layout is saved for this admin in this browser.")}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {customizing && (
              <div className="grid gap-3 rounded-md border bg-muted/30 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                <div>
                  <Label htmlFor="dashboard-widget-metric">{ui("Metric")}</Label>
                  <select id="dashboard-widget-metric" className={`${selectClass} mt-1`} value={widgetMetric} onChange={(event) => { setWidgetMetric(event.target.value as WidgetMetric); }}>
                    {WIDGET_OPTIONS.map((option) => <option key={option.metric} value={option.metric}>{ui(option.label)} · {option.kind === "CHART" ? ui("Chart") : ui("Number")}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="dashboard-widget-title">{ui("Title (optional)")}</Label>
                  <Input id="dashboard-widget-title" className="mt-1" value={widgetTitle} onChange={(event) => { setWidgetTitle(event.target.value); }} placeholder={ui("Use the default title")} />
                </div>
                <Button type="button" onClick={addWidget}><Plus className="mr-2 h-4 w-4" />{ui("Add widget")}</Button>
              </div>
            )}
            {customWidgets.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {customWidgets.map(renderCustomWidget)}
              </div>
            ) : <p className="text-sm text-muted-foreground">{ui("No custom widgets yet. Choose a metric above to add one.")}</p>}
          </CardContent>
        </Card>
      )}

      {(data.pointBanks ?? []).length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {data.pointBanks?.map((bank) => (
            <Card key={bank.pointType.id}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {bank.pointType.name} bank
                </CardTitle>
                <WalletCards className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{ui("Unused")}</p>
                <p className="text-2xl font-bold">{bank.unused.toLocaleString()}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ui("Allocated")} {bank.used.toLocaleString()} · {ui("Funded")} {bank.issued.toLocaleString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{ui("Top rewards")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data.topRewards ?? []).map((reward) => (
              <div key={reward.name} className="flex justify-between text-sm">
                <span>{reward.name}</span>
                <span className="font-semibold">{reward.redemptions}</span>
              </div>
            ))}
            {(data.topRewards ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">{ui("No redemptions yet.")}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{ui("Recognition volume · last 30 days")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data.recognitionOverTime ?? []).slice(-10).map((day) => (
              <div key={day.date} className="flex justify-between text-sm">
                <span>{day.date}</span>
                <span className="font-semibold">{day.count}</span>
              </div>
            ))}
            {(data.recognitionOverTime ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">{ui("No recognition yet.")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
