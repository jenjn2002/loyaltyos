import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, TrendingUp, Users } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi } from "@/lib/api-client";

interface Redemption {
  id: string;
  memberId: string;
  pointsSpent: number;
  redeemedAt: string;
  fulfillmentStatus: "PENDING" | "FULFILLED" | "CANCELLED";
  member?: { email: string | null; firstName: string | null; lastName: string | null };
  pointType: { id: string; code: string; name: string; unitLabel: string } | null;
}

interface RedemptionsResponse {
  items: Redemption[];
  total: number;
}

interface RedemptionsMetrics {
  totalRedemptions: number;
  uniqueMembers: number;
  totalPointsSpent: number;
}

export function RewardsRedemptionsPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const rewardId = id ?? "";
  const queryClient = useQueryClient();
  const statusMutation = useMutation({
    mutationFn: ({
      redemptionId,
      status,
    }: {
      redemptionId: string;
      status: Redemption["fulfillmentStatus"];
    }) =>
      fetchApi(`/admin/rewards/redemptions/${redemptionId}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          reason: `Fulfillment marked ${status.toLowerCase()} from reward operations`,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reward-redemptions", id] });
    },
  });

  const { data: redemptions, isLoading } = useQuery<RedemptionsResponse>({
    queryKey: ["reward-redemptions", id],
    queryFn: async () => fetchApi<RedemptionsResponse>(`/admin/rewards/${rewardId}/redemptions`),
    enabled: Boolean(id),
  });

  const { data: reward } = useQuery<{ name: string }>({
    queryKey: ["reward", id],
    queryFn: async () => fetchApi<{ name: string }>(`/admin/rewards/${rewardId}`),
    enabled: Boolean(id),
  });

  const items = redemptions?.items ?? [];

  const metrics: RedemptionsMetrics = {
    totalRedemptions: redemptions?.total ?? 0,
    uniqueMembers: new Set(items.map((r) => r.memberId)).size,
    totalPointsSpent: items.reduce((sum, r) => sum + r.pointsSpent, 0),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/rewards">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {reward ? `Redemptions: ${reward.name}` : "Redemptions"}
          </h1>
          <p className="text-sm text-muted-foreground">{ui("Redemption history and metrics")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{ui("Total Redemptions")}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalRedemptions}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{ui("Unique Members")}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.uniqueMembers}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{ui("Point units spent")}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.totalPointsSpent.toLocaleString()} pts
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{ui("Redemption History")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={String(i)} className="h-12 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">{ui("No redemptions yet")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{ui("Date")}</TableHead>
                  <TableHead>{ui("Member")}</TableHead>
                  <TableHead>{ui("Points Spent")}</TableHead>
                  <TableHead>{ui("Fulfillment")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {new Date(r.redeemedAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {[r.member?.firstName, r.member?.lastName].filter(Boolean).join(" ") ||
                            r.member?.email ||
                            r.memberId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.member?.email ?? r.memberId}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {r.pointsSpent.toLocaleString()} {r.pointType?.unitLabel ?? "points"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            r.fulfillmentStatus === "FULFILLED"
                              ? "default"
                              : r.fulfillmentStatus === "CANCELLED"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {r.fulfillmentStatus}
                        </Badge>
                        {r.fulfillmentStatus === "PENDING" && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => {
                                statusMutation.mutate({ redemptionId: r.id, status: "FULFILLED" });
                              }}
                            >{ui("Fulfill")}</Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                statusMutation.mutate({ redemptionId: r.id, status: "CANCELLED" });
                              }}
                            >{ui("Cancel")}</Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
