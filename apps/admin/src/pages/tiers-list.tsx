import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

interface TierItem {
  id: string;
  pointTypeId: string | null;
  name: string;
  rank: number;
  minPoints: number;
  color?: string;
  iconUrl?: string;
  benefits?: unknown;
}

interface PointTypeItem {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  archivedAt: string | null;
}

export function TiersListPage(): JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newTier, setNewTier] = useState(false);
  const [formData, setFormData] = useState({
    pointTypeId: "",
    name: "",
    minPoints: 0,
    color: "#94a3b8",
    benefits: "{}",
  });

  const {
    data: tiers,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["tiers"],
    queryFn: () => fetchApi<TierItem[]>("/admin/tiers"),
  });

  const { data: pointTypes } = useQuery({
    queryKey: ["point-types", "tiers"],
    queryFn: () => fetchApi<PointTypeItem[]>("/admin/point-types"),
  });
  const activePointTypes = (pointTypes ?? []).filter(
    (pointType) => pointType.isActive && !pointType.archivedAt,
  );

  const handleReorder = async (index: number, direction: "up" | "down") => {
    if (!tiers) return;
    const newTiers = [...tiers];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newTiers.length) return;
    [newTiers[index], newTiers[swapIndex]] = [newTiers[swapIndex]!, newTiers[index]!];
    const tierIds = newTiers.map((t) => t.id);
    await fetchApi("/admin/tiers/reorder", {
      method: "PATCH",
      body: JSON.stringify({ tierIds }),
    });
    void queryClient.invalidateQueries({ queryKey: ["tiers"] });
  };

  const handleDelete = async (id: string) => {
    await fetchApi(`/admin/tiers/${id}`, { method: "DELETE" });
    void queryClient.invalidateQueries({ queryKey: ["tiers"] });
  };

  const handleCreate = async () => {
    await fetchApi("/admin/tiers", {
      method: "POST",
      body: JSON.stringify({
        pointTypeId: formData.pointTypeId,
        name: formData.name,
        rank: (tiers?.length ?? 0) + 1,
        minPoints: formData.minPoints,
        color: formData.color,
        benefits: JSON.parse(formData.benefits || "{}") as unknown,
      }),
    });
    setNewTier(false);
    setFormData({
      pointTypeId: tiers?.[0]?.pointTypeId ?? activePointTypes[0]?.id ?? "",
      name: "",
      minPoints: 0,
      color: "#94a3b8",
      benefits: "{}",
    });
    void queryClient.invalidateQueries({ queryKey: ["tiers"] });
  };

  const handleUpdate = async (id: string) => {
    await fetchApi(`/admin/tiers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        pointTypeId: formData.pointTypeId,
        name: formData.name,
        minPoints: formData.minPoints,
        color: formData.color,
        benefits: JSON.parse(formData.benefits || "{}") as unknown,
      }),
    });
    setEditingId(null);
    void queryClient.invalidateQueries({ queryKey: ["tiers"] });
  };

  const openEditor = (tier: TierItem) => {
    setEditingId(tier.id);
    setFormData({
      pointTypeId: tier.pointTypeId ?? tiers?.[0]?.pointTypeId ?? "",
      name: tier.name,
      minPoints: tier.minPoints,
      color: tier.color ?? "#94a3b8",
      benefits: tier.benefits ? JSON.stringify(tier.benefits, null, 2) : "{}",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t("tiers.title")}</h1>
        <Button
          onClick={() => {
            setNewTier(true);
            setFormData({
              pointTypeId: tiers?.[0]?.pointTypeId ?? activePointTypes[0]?.id ?? "",
              name: "",
              minPoints: 0,
              color: "#94a3b8",
              benefits: "{}",
            });
          }}
          disabled={newTier}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Tier
        </Button>
      </div>

      {!isLoading && tiers && tiers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Distribution</CardTitle>
            <CardDescription>Tier hierarchy from highest to lowest rank.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-2">
              {[...tiers].reverse().map((tier, i, arr) => (
                <div
                  key={tier.id}
                  className="flex items-center justify-center rounded-md border py-2 text-center font-medium"
                  style={{
                    width: `${String(100 - (arr.length - 1 - i) * 15)}%`,
                    backgroundColor: tier.color ? `${tier.color}20` : undefined,
                    borderColor: tier.color ?? undefined,
                    color: tier.color ?? undefined,
                  }}
                >
                  {tier.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({">"} {tier.minPoints.toLocaleString()}{" "}
                    {activePointTypes.find((pointType) => pointType.id === tier.pointTypeId)
                      ?.code ?? "points"}
                    )
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Tiers</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={`sk-${String(i)}`} className="h-10 w-full" />
              ))}
            </div>
          ) : isError ? (
            <p className="text-destructive">Failed to load tiers.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Rank</TableHead>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>Qualification point type</TableHead>
                  <TableHead>Min Points</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {newTier && (
                  <TableRow>
                    <TableCell className="text-muted-foreground">New</TableCell>
                    <TableCell>
                      <Input
                        value={formData.name}
                        onChange={(e) => {
                          setFormData((f) => ({ ...f, name: e.target.value }));
                        }}
                        placeholder="Tier name"
                      />
                    </TableCell>
                    <TableCell>
                      <select
                        aria-label="Qualification point type"
                        data-help="All tiers in this ladder qualify from lifetime earned value in this one point type."
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={formData.pointTypeId}
                        disabled={Boolean(tiers?.length)}
                        onChange={(event) => {
                          setFormData((form) => ({
                            ...form,
                            pointTypeId: event.target.value,
                          }));
                        }}
                      >
                        <option value="">Select point type</option>
                        {activePointTypes.map((pointType) => (
                          <option key={pointType.id} value={pointType.id}>
                            {pointType.name} ({pointType.code})
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={formData.minPoints}
                        onChange={(e) => {
                          setFormData((f) => ({ ...f, minPoints: Number(e.target.value) }));
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="color"
                        value={formData.color}
                        onChange={(e) => {
                          setFormData((f) => ({ ...f, color: e.target.value }));
                        }}
                        className="h-8 w-12"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        disabled={!formData.pointTypeId || !formData.name.trim()}
                        onClick={() => {
                          void handleCreate();
                        }}
                      >
                        <Save className="mr-1 h-3 w-3" />
                        {t("common.save")}
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
                {tiers?.map((tier, i) => (
                  <TableRow key={tier.id}>
                    <TableCell>
                      <Badge variant="secondary">{String(tier.rank)}</Badge>
                    </TableCell>
                    <TableCell>
                      {editingId === tier.id ? (
                        <Input
                          value={formData.name}
                          onChange={(e) => {
                            setFormData((f) => ({ ...f, name: e.target.value }));
                          }}
                        />
                      ) : (
                        <span className="font-medium">{tier.name}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {activePointTypes.find((pointType) => pointType.id === tier.pointTypeId)
                        ?.name ?? "Unconfigured"}
                    </TableCell>
                    <TableCell>
                      {editingId === tier.id ? (
                        <Input
                          type="number"
                          value={formData.minPoints}
                          onChange={(e) => {
                            setFormData((f) => ({ ...f, minPoints: Number(e.target.value) }));
                          }}
                        />
                      ) : (
                        <span>{tier.minPoints.toLocaleString()}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div
                        className="h-6 w-6 rounded-full border"
                        style={{ backgroundColor: tier.color ?? "#ccc" }}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {editingId === tier.id ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              void handleUpdate(tier.id);
                            }}
                          >
                            <Save className="h-3 w-3" />
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                openEditor(tier);
                              }}
                            >
                              <span className="text-xs">{t("common.edit")}</span>
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                void handleDelete(tier.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={i === 0}
                          onClick={() => {
                            void handleReorder(i, "up");
                          }}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={i === tiers.length - 1}
                          onClick={() => {
                            void handleReorder(i, "down");
                          }}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {tiers?.length === 0 && !newTier && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      {t("common.noResults")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
