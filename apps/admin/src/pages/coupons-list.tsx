import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi } from "@/lib/api-client";
import type { Coupon, PaginatedResponse } from "@/types";

const DISCOUNT_LABELS: Record<string, string> = {
  PERCENTAGE: "Percentage",
  FIXED: "Fixed Amount",
  FREE_PRODUCT: "Free Product",
  FREE_SHIPPING: "Free Shipping",
  EXTRA_POINTS: "Extra Points",
  EXPERIENCE: "Experience",
};

export function CouponsListPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [editDraft, setEditDraft] = useState({ discountValue: "", maxUses: "", expiresAt: "" });
  const pageSize = 20;

  const modeLabels: Record<string, string> = {
    SHARED: "Shared",
    INDIVIDUAL: "Individual",
    LIMITED: "Limited",
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["coupons", page, modeFilter],
    queryFn: () => {
      const mode = modeFilter !== "all" ? `&mode=${modeFilter}` : "";
      return fetchApi<PaginatedResponse<Coupon>>(
        `/admin/coupons?page=${String(page)}&pageSize=${String(pageSize)}${mode}`,
      );
    },
  });

  const handleDelete = async (id: string) => {
    await fetchApi(`/admin/coupons/${id}`, { method: "DELETE" });
    void queryClient.invalidateQueries({ queryKey: ["coupons"] });
  };
  const updateCoupon = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      fetchApi(`/admin/coupons/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: async () => {
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["coupons"] });
    },
  });
  const saveEdit = (): void => {
    if (!editing) return;
    const body: Record<string, unknown> = {};
    if (editDraft.discountValue !== "") body.discountValue = Number(editDraft.discountValue);
    body.maxUses = editDraft.maxUses === "" ? null : Number(editDraft.maxUses);
    body.expiresAt = editDraft.expiresAt === "" ? null : new Date(editDraft.expiresAt).toISOString();
    updateCoupon.mutate({ id: editing.id, body });
  };
  const toggleActive = (coupon: Coupon): void => {
    updateCoupon.mutate({ id: coupon.id, body: { isActive: !coupon.isActive } });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t("coupons.title")}</h1>
        <Button
          onClick={() => {
            navigate("/coupons/generate");
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("coupons.generateCoupon")}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{ui("All Coupons")}</CardTitle>
          <Select value={modeFilter} onValueChange={(value) => { setModeFilter(value); setPage(1); }}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder={ui("Mode")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{ui("All Modes")}</SelectItem>
              <SelectItem value="SHARED">{ui("Shared")}</SelectItem>
              <SelectItem value="INDIVIDUAL">{ui("Individual")}</SelectItem>
              <SelectItem value="LIMITED">{ui("Limited")}</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError || !data ? (
            <p className="text-destructive">{ui("Failed to load coupons.")}</p>
          ) : data.items.length === 0 ? (
            <p className="text-muted-foreground">{t("common.noResults")}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{ui("Code")}</TableHead>
                    <TableHead>{t("campaigns.type")}</TableHead>
                    <TableHead>{ui("Mode")}</TableHead>
                    <TableHead>{ui("Usage")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{ui("Expires")}</TableHead>
                    <TableHead>{ui("Created by")}</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono font-medium">{c.code}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {DISCOUNT_LABELS[c.discountType] ?? c.discountType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {modeLabels[c.mode] ?? c.mode}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.usedCount}
                        {c.maxUses != null ? ` / ${String(c.maxUses)}` : ""}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            c.isActive
                              ? "bg-green-100 text-green-800"
                              : "bg-slate-100 text-slate-800"
                          }
                        >
                          {c.isActive ? t("common.active") : t("common.inactive")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "Never"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.createdBy ? <><p className="font-medium">{c.createdBy.name}</p><p className="text-xs text-muted-foreground">{c.createdBy.email}</p></> : <span className="text-muted-foreground">{ui("System / legacy")}</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" title={ui("Edit coupon")} onClick={() => {
                            const date = c.expiresAt ? new Date(c.expiresAt) : null;
                            if (date) date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
                            setEditing(c);
                            setEditDraft({ discountValue: c.discountValue == null ? "" : String(c.discountValue), maxUses: c.maxUses == null ? "" : String(c.maxUses), expiresAt: date?.toISOString().slice(0, 16) ?? "" });
                          }}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="outline" size="sm" disabled={updateCoupon.isPending} onClick={() => toggleActive(c)}>{c.isActive ? ui("Deactivate") : ui("Reactivate")}</Button>
                          {c.isActive && <Button variant="ghost" size="sm" className="text-destructive" title={ui("Deactivate coupon")} onClick={() => { void handleDelete(c.id); }}><Trash2 className="h-4 w-4" /></Button>}
                        </div>
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
      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{ui("Edit coupon")}</DialogTitle><DialogDescription>{editing?.code}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="coupon-edit-value">{ui("Discount value")}</Label><Input id="coupon-edit-value" type="number" min={0} value={editDraft.discountValue} onChange={(event) => setEditDraft((current) => ({ ...current, discountValue: event.target.value }))} /></div>
            <div><Label htmlFor="coupon-edit-max-uses">{ui("Maximum uses")}</Label><Input id="coupon-edit-max-uses" type="number" min={1} value={editDraft.maxUses} onChange={(event) => setEditDraft((current) => ({ ...current, maxUses: event.target.value }))} /></div>
            <div><Label htmlFor="coupon-edit-expires">{ui("Expires")}</Label><Input id="coupon-edit-expires" type="datetime-local" value={editDraft.expiresAt} onChange={(event) => setEditDraft((current) => ({ ...current, expiresAt: event.target.value }))} /></div>
            {updateCoupon.isError && <p role="alert" className="text-sm text-destructive">{updateCoupon.error.message}</p>}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>{ui("Cancel")}</Button><Button disabled={updateCoupon.isPending} onClick={saveEdit}>{updateCoupon.isPending ? ui("Saving…") : ui("Save changes")}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
