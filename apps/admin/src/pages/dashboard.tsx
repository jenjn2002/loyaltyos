import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Gift, Percent, Users, WalletCards } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchApi } from "@/lib/api-client";
import type { DashboardStats, GiftCardMetrics } from "@/types";

export function DashboardPage(): JSX.Element {
  const { t } = useTranslation();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fetchApi<DashboardStats>("/stats/dashboard"),
  });

  const { data: gcMetrics } = useQuery({
    queryKey: ["giftcard-metrics"],
    queryFn: () => fetchApi<GiftCardMetrics>("/admin/giftcards/metrics"),
  });

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

  const chartData = [
    {
      name: t("dashboard.pointsIssued"),
      Issued: data.totalPointsIssued,
      Redeemed: data.totalPointsRedeemed,
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t("dashboard.title")}</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
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
              {t("dashboard.giftCardsOutstanding")}
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
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Credit issued</CardTitle><WalletCards className="h-4 w-4 text-green-600" /></CardHeader><CardContent><p className="text-2xl font-bold text-green-600">{(data.creditIssued ?? 0).toLocaleString()}</p></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Credit redeemed</CardTitle><ArrowDown className="h-4 w-4 text-orange-600" /></CardHeader><CardContent><p className="text-2xl font-bold text-orange-600">{(data.creditRedeemed ?? 0).toLocaleString()}</p></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Recognition events</CardTitle><Users className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><p className="text-2xl font-bold">{(data.recognitionVolume ?? 0).toLocaleString()}</p></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Bank unused P / R</CardTitle><WalletCards className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><p className="text-2xl font-bold">{(data.creditBankMetrics?.P.unused ?? data.creditBank?.P ?? 0).toLocaleString()} / {(data.creditBankMetrics?.R.unused ?? data.creditBank?.R ?? 0).toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Used: {(data.creditBankMetrics?.P.used ?? 0).toLocaleString()} / {(data.creditBankMetrics?.R.used ?? 0).toLocaleString()}</p></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Top rewards</CardTitle></CardHeader><CardContent className="space-y-2">{(data.topRewards ?? []).map((reward) => <div key={reward.name} className="flex justify-between text-sm"><span>{reward.name}</span><span className="font-semibold">{reward.redemptions}</span></div>)}{(data.topRewards ?? []).length === 0 && <p className="text-sm text-muted-foreground">No redemptions yet.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Recognition volume · last 30 days</CardTitle></CardHeader><CardContent className="space-y-2">{(data.recognitionOverTime ?? []).slice(-10).map((day) => <div key={day.date} className="flex justify-between text-sm"><span>{day.date}</span><span className="font-semibold">{day.count}</span></div>)}{(data.recognitionOverTime ?? []).length === 0 && <p className="text-sm text-muted-foreground">No recognition yet.</p>}</CardContent></Card>
      </div>
    </div>
  );
}
