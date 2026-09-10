import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { Member, MemberPointWallet, PaginatedResponse, PointTransaction } from "@/types";

const transactionTypeColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  EARN: "default",
  REDEEM: "destructive",
  REVERSAL: "secondary",
  EXPIRY: "outline",
  ADJUSTMENT: "secondary",
  GIVE_IN: "default",
  GIVE_OUT: "secondary",
  GIVE_ALLOWANCE_OUT: "secondary",
  EXCHANGE: "destructive",
};

export function MemberDetailPage(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const memberId = id ?? "";
  const queryClient = useQueryClient();
  const [statusReason, setStatusReason] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const {
    data: member,
    isLoading: memberLoading,
    isError: memberError,
  } = useQuery({
    queryKey: ["member", memberId],
    queryFn: () => fetchApi<Member>(`/members/${memberId}`),
    enabled: Boolean(memberId),
  });

  const { data: wallets, isLoading: balanceLoading } = useQuery({
    queryKey: ["member-balance", memberId],
    queryFn: () => fetchApi<MemberPointWallet[]>(`/members/${memberId}/balance`),
    enabled: Boolean(memberId),
  });

  const [txPage, setTxPage] = useState(1);
  const { data: transactions, isLoading: txsLoading } = useQuery({
    queryKey: ["member-transactions", memberId, txPage],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(txPage));
      params.set("pageSize", "10");
      return fetchApi<PaginatedResponse<PointTransaction>>(
        `/members/${memberId}/transactions?${params.toString()}`,
      );
    },
    enabled: Boolean(memberId),
  });

  const updateMemberStatus = async (status: "ACTIVE" | "INACTIVE"): Promise<void> => {
    if (!statusReason.trim()) {
      setStatusMessage("A reason is required.");
      return;
    }
    setStatusUpdating(true);
    setStatusMessage(null);
    try {
      await fetchApi(`/admin/members/${memberId}/status`, {
        method: "POST",
        body: JSON.stringify({ status, reason: statusReason }),
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setStatusReason("");
      setStatusMessage(
        status === "INACTIVE"
          ? "Member offboarded; all configured wallets and allowances were cleared and retained in history."
          : "Member reactivated; wallets remain zero until a new grant.",
      );
      void queryClient.invalidateQueries({ queryKey: ["member", memberId] });
      void queryClient.invalidateQueries({ queryKey: ["member-balance", memberId] });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Status update failed");
    } finally {
      setStatusUpdating(false);
    }
  };

  if (memberError || (!memberLoading && !member)) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link to="/members">
            <ChevronLeft className="mr-2 h-4 w-4" />
            {t("members.backToList")}
          </Link>
        </Button>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-destructive">Member not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" asChild>
          <Link to="/members">
            <ChevronLeft className="mr-2 h-4 w-4" />
            {t("members.backToList")}
          </Link>
        </Button>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>
            {memberLoading ? (
              <Skeleton className="h-6 w-48" />
            ) : (
              `${member?.firstName ?? ""} ${member?.lastName ?? ""}`.trim() || "N/A"
            )}
          </CardTitle>
          <CardDescription>Member Profile</CardDescription>
        </CardHeader>
        <CardContent>
          {memberLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : (
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">Email</dt>
                <dd>{member?.email ?? "N/A"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Phone</dt>
                <dd>{member?.phone ?? "N/A"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">External ID</dt>
                <dd>{member?.externalId ?? "--"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Joined</dt>
                <dd>{member ? new Date(member.joinedAt).toLocaleDateString() : "--"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Status</dt>
                <dd>{member?.status ?? "ACTIVE"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-sm text-muted-foreground">Credit wallets</dt>
                <dd className="mt-1 flex flex-wrap gap-2 text-sm">
                  {(member?.pointWallets ?? []).length === 0 ? (
                    <span className="text-muted-foreground">No configured wallets</span>
                  ) : (
                    member?.pointWallets?.map((wallet) => (
                      <span key={wallet.pointTypeId} className="rounded bg-muted px-2 py-1">
                        {wallet.name}: {wallet.balance.toLocaleString()} {wallet.unitLabel}
                        {wallet.allowance
                          ? ` · Give remaining: ${wallet.allowance.remaining.toLocaleString()}`
                          : ""}
                      </span>
                    ))
                  )}
                </dd>
              </div>
              {member?.tags && member.tags.length > 0 && (
                <div className="sm:col-span-2">
                  <dt className="mb-1 text-sm text-muted-foreground">Tags</dt>
                  <dd className="flex flex-wrap gap-1">
                    {member.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          )}
          <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="min-w-64 flex-1">
              <Label htmlFor="status-reason">Status / offboarding reason</Label>
              <Input
                id="status-reason"
                value={statusReason}
                onChange={(event) => {
                  setStatusReason(event.target.value);
                }}
                placeholder="Reason is required"
              />
            </div>
            {member?.status === "INACTIVE" ? (
              <Button disabled={statusUpdating} onClick={() => void updateMemberStatus("ACTIVE")}>
                Reactivate
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={statusUpdating}
                onClick={() => void updateMemberStatus("INACTIVE")}
              >
                Offboard & clear wallets
              </Button>
            )}
            {statusMessage && (
              <p className="w-full text-sm text-muted-foreground">{statusMessage}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Balance */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Configured wallets</CardTitle>
          </CardHeader>
          <CardContent>
            {balanceLoading ? (
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(wallets ?? []).map((wallet) => (
                  <div key={wallet.pointTypeId} className="rounded-lg bg-muted p-4">
                    <p className="text-sm text-muted-foreground">
                      {wallet.name} ({wallet.code})
                    </p>
                    <p className="text-2xl font-bold">{wallet.balance.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{wallet.unitLabel}</p>
                    {wallet.allowance && (
                      <p className="mt-1 text-xs">
                        Give allowance: {wallet.allowance.remaining.toLocaleString()} /{" "}
                        {wallet.allowance.allocated.toLocaleString()}
                      </p>
                    )}
                  </div>
                ))}
                {(wallets ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No active point types are configured.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          {txsLoading ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Balance After</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : !transactions || transactions.items.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-muted-foreground">No transactions yet</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Balance After</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.items.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell>{new Date(tx.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Badge variant={transactionTypeColors[tx.action] ?? "outline"}>
                          {tx.action}
                        </Badge>
                      </TableCell>
                      <TableCell className={tx.amount > 0 ? "text-green-600" : "text-red-600"}>
                        {tx.amount > 0 ? "+" : ""}
                        {tx.amount.toLocaleString()}
                      </TableCell>
                      <TableCell>{tx.balanceAfter.toLocaleString()}</TableCell>
                      <TableCell>
                        {tx.pointType.code} · {tx.source}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {transactions.page} of {transactions.totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={transactions.page <= 1}
                    onClick={() => {
                      setTxPage((p) => p - 1);
                    }}
                  >
                    {t("common.previous")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={transactions.page >= transactions.totalPages}
                    onClick={() => {
                      setTxPage((p) => p + 1);
                    }}
                  >
                    {t("common.next")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
