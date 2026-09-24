import { ui } from "@/lib/ui-text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import type { Campaign, CampaignIssuanceStatus, PaginatedResponse } from "@/types";

export function CampaignsListPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [issuanceCampaignId, setIssuanceCampaignId] = useState<string | null>(null);
  const [issuancePage, setIssuancePage] = useState(1);
  const admin = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => fetchApi<{ capabilities: Record<string, boolean> }>("/admin/me"),
    staleTime: 30_000,
  });
  const canExecute = admin.data?.capabilities["campaign.execute"] !== false;
  const propose = async (id: string) => {
    setSubmitting(true);
    try {
      await fetchApi(`/admin/campaigns/${id}/propose`, { method: "POST", body: "{}" });
      setNotice(ui("Proposal submitted. Review it in Approvals."));
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSubmitting(false); }
  };
  const runNow = async (campaign: Campaign) => {
    setSubmitting(true);
    try {
      const result = await fetchApi<{ processed: number; issued: number; mode: "AUTO" | "CLAIM" }>(`/admin/campaigns/${campaign.id}/run-now`, {
        method: "POST",
        body: "{}",
      });
      setNotice(`${ui("Campaign run completed.")} ${String(result.issued)} ${ui(result.mode === "CLAIM" ? "new claims" : "new grants")}.`);
      setIssuancePage(1);
      setIssuanceCampaignId(campaign.id);
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSubmitting(false); }
  };
  const pageSize = 20;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["campaigns", page],
    queryFn: () =>
      fetchApi<PaginatedResponse<Campaign>>(
        `/admin/campaigns?page=${String(page)}&pageSize=${String(pageSize)}`,
      ),
  });

  const issuance = useQuery({
    queryKey: ["campaign-issuance", issuanceCampaignId, issuancePage],
    queryFn: () =>
      fetchApi<CampaignIssuanceStatus>(
        `/admin/campaigns/${String(issuanceCampaignId)}/issuance?page=${String(issuancePage)}&pageSize=20`,
      ),
    enabled: Boolean(issuanceCampaignId),
    refetchInterval: issuanceCampaignId ? 30_000 : false,
  });

  const handleLifecycle = async (id: string, action: "activate" | "pause" | "archive") => {
    await fetchApi(`/admin/campaigns/${id}/lifecycle`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t("campaigns.title")}</h1>
        <Button
          onClick={() => {
            navigate("/campaigns/new");
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("campaigns.createCampaign")}
        </Button>
      </div>

      {notice && <p role="status" className="rounded-md border p-3">{notice}</p>}
      <Card>
        <CardHeader>
          <CardTitle>{ui("All Campaigns")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError || !data ? (
            <p className="text-destructive">{ui("Failed to load campaigns.")}</p>
          ) : data.items.length === 0 ? (
            <p className="text-muted-foreground">{t("common.noResults")}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.name")}</TableHead>
                    <TableHead>{ui("Created by")}</TableHead>
                    <TableHead>{ui("Policy")}</TableHead>
                    <TableHead>{ui("Trigger")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{ui("Issuance")}</TableHead>
                    <TableHead>{ui("Budget")}</TableHead>
                    <TableHead>{ui("Starts")}</TableHead>
                    <TableHead>{ui("Ends")}</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        {c.createdBy ? (
                          <div>
                            <p className="font-medium">{c.createdBy.name}</p>
                            <p className="text-xs text-muted-foreground">{c.createdBy.email}</p>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">{ui("System / legacy")}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {c.issuancePolicy === "APPROVAL_REQUIRED" || c.approvalStatus !== "NOT_REQUIRED"
                            ? ui("Approval required")
                            : ui("Standing campaign")}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.eventType ?? ui("Any event")}</TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            c.isActive
                              ? "bg-green-100 text-green-800"
                              : "bg-slate-100 text-slate-800",
                          )}
                        >
                          {c.isActive ? t("common.active") : t("common.inactive")}
                        </Badge>
                        {c.approvalStatus !== "NOT_REQUIRED" && <p className="text-xs">{ui(c.approvalStatus)}</p>}
                      </TableCell>
                      <TableCell className="text-sm">
                        <p>{String(c.issuance?.count ?? 0)} {ui("issued members")}</p>
                        <p className="text-xs text-muted-foreground">{(c.issuance?.points ?? 0).toLocaleString()} pts</p>
                        {c.issuance?.pendingClaims ? <p className="text-xs text-amber-700">{String(c.issuance.pendingClaims)} {ui("pending claims")}</p> : null}
                      </TableCell>
                      <TableCell>
                        {c.maxBudget != null ? `${c.maxBudget.toLocaleString()} pts` : "Unlimited"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.startsAt ? new Date(c.startsAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.endsAt ? new Date(c.endsAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              ···
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                navigate(`/campaigns/${c.id}/edit`);
                              }}
                            >
                              {t("common.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setIssuancePage(1);
                                setIssuanceCampaignId(c.id);
                              }}
                            >
                              {ui("View issuance status")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={submitting || !canExecute || !c.isActive || !["NOT_REQUIRED", "APPROVED"].includes(c.approvalStatus)}
                              onClick={() => {
                                void runNow(c);
                              }}
                            >
                              {ui("Run campaign now")}
                            </DropdownMenuItem>
                            {["DRAFT", "REJECTED"].includes(c.approvalStatus) && <DropdownMenuItem disabled={submitting} onClick={() => void propose(c.id)}>{ui("Submit for approval")}</DropdownMenuItem>}
                            {!c.isActive && ["NOT_REQUIRED", "APPROVED"].includes(c.approvalStatus) && (
                              <DropdownMenuItem
                                onClick={() => {
                                  void handleLifecycle(c.id, "activate");
                                }}
                              >
                                {ui("Activate")}</DropdownMenuItem>
                            )}
                            {c.isActive && (
                              <DropdownMenuItem
                                onClick={() => {
                                  void handleLifecycle(c.id, "pause");
                                }}
                              >
                                {ui("Pause")}</DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                void handleLifecycle(c.id, "archive");
                              }}
                            >
                              {ui("Archive")}</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => {
                      setPage((p) => p - 1);
                    }}
                  >
                    {t("common.previous")}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {data.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= data.totalPages}
                    onClick={() => {
                      setPage((p) => p + 1);
                    }}
                  >
                    {t("common.next")}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(issuanceCampaignId)}
        onOpenChange={(open) => {
          if (!open) setIssuanceCampaignId(null);
        }}
      >
        <DialogContent className="max-w-5xl">
          <DialogHeader className="flex-row items-start justify-between gap-4 pr-8">
            <div>
              <DialogTitle>
                {issuance.data?.campaign.name ?? ui("Campaign issuance")}
              </DialogTitle>
              <DialogDescription>
                {ui("See whether this campaign has issued points and which members received them.")}
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={issuance.isFetching}
              onClick={() => {
                void issuance.refetch();
              }}
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", issuance.isFetching && "animate-spin")} />
              {ui("Refresh")}
            </Button>
          </DialogHeader>

          {issuance.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : issuance.isError || !issuance.data ? (
            <p className="text-sm text-destructive">{ui("Failed to load issuance status.")}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">{ui("Issuance status")}</p>
                  <p className="mt-1 font-medium">{ui(issuance.data.status)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">{ui("Issued members")}</p>
                  <p className="mt-1 font-medium">{String(issuance.data.issuedCount)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">{ui("Total points issued")}</p>
                  <p className="mt-1 font-medium">{issuance.data.totalPoints.toLocaleString()}</p>
                  {issuance.data.pendingClaims > 0 && <p className="mt-1 text-xs text-amber-700">{String(issuance.data.pendingClaims)} {ui("pending claims")}</p>}
                </div>
              </div>

              {issuance.data.items.length === 0 ? (
                <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  {ui("No points have been issued by this campaign yet.")}
                </p>
              ) : (
                <>
                  <div className="max-h-[50vh] overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{ui("Member")}</TableHead>
                          <TableHead>{ui("Email")}</TableHead>
                          <TableHead>{ui("Department")}</TableHead>
                          <TableHead>{ui("Points")}</TableHead>
                          <TableHead>{ui("Status")}</TableHead>
                          <TableHead>{ui("Event")}</TableHead>
                          <TableHead>{ui("Issued at")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {issuance.data.items.map((item) => {
                          const member = item.member;
                          const name = member
                            ? [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email
                            : item.memberId;
                          const metadata = item.metadata && typeof item.metadata === "object"
                            ? item.metadata as Record<string, unknown>
                            : {};
                          const event = typeof metadata.eventType === "string"
                            ? metadata.eventType
                            : item.eventId ?? "—";
                          return (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">{name}</TableCell>
                              <TableCell>{member?.email ?? "—"}</TableCell>
                              <TableCell>{member?.department ?? "—"}</TableCell>
                              <TableCell>{item.pointsAwarded.toLocaleString()}</TableCell>
                              <TableCell>{item.recordType === "CLAIM" ? ui("Claim pending") : ui("Issued")}</TableCell>
                              <TableCell className="font-mono text-xs">{event}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {new Date(item.createdAt).toLocaleString()}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {issuance.data.totalPages > 1 && (
                    <div className="flex items-center justify-between">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={issuancePage <= 1}
                        onClick={() => setIssuancePage((current) => current - 1)}
                      >
                        {t("common.previous")}
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {ui("Page")} {String(issuancePage)} {ui("of")} {String(issuance.data.totalPages)}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={issuancePage >= issuance.data.totalPages}
                        onClick={() => setIssuancePage((current) => current + 1)}
                      >
                        {t("common.next")}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
