import { ui } from "@/lib/ui-text";
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
  qualificationRules?: unknown;
  qualificationOperator?: "AND" | "OR";
  color?: string;
  iconUrl?: string;
  benefits?: unknown;
  createdBy?: { id: string; name: string; email: string | null } | null;
}

interface TierRequirement {
  pointTypeId: string;
  minPoints: number;
}

function tierRequirements(tier: TierItem): TierRequirement[] {
  if (Array.isArray(tier.qualificationRules)) {
    const parsed = tier.qualificationRules.filter(
      (rule): rule is { pointTypeId?: unknown; minPoints?: unknown } =>
        typeof rule === "object" && rule !== null,
    ).filter(
      (rule): rule is { pointTypeId: string; minPoints: number } =>
        typeof rule.pointTypeId === "string" && typeof rule.minPoints === "number",
    );
    if (parsed.length > 0) return parsed;
  }
  return tier.pointTypeId
    ? [{ pointTypeId: tier.pointTypeId, minPoints: tier.minPoints }]
    : [];
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
    name: "",
    requirements: [] as TierRequirement[],
    qualificationOperator: "AND" as "AND" | "OR",
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

  const initialRequirements = (): TierRequirement[] =>
    activePointTypes[0] ? [{ pointTypeId: activePointTypes[0].id, minPoints: 0 }] : [];

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
    const firstRequirement = formData.requirements[0];
    if (!firstRequirement || formData.requirements.some((rule) => !rule.pointTypeId)) return;
    await fetchApi("/admin/tiers", {
      method: "POST",
      body: JSON.stringify({
        pointTypeId: firstRequirement.pointTypeId,
        name: formData.name,
        rank: (tiers?.length ?? 0) + 1,
        minPoints: firstRequirement.minPoints,
        qualificationRules: formData.requirements,
        qualificationOperator: formData.qualificationOperator,
        color: formData.color,
        benefits: JSON.parse(formData.benefits || "{}") as unknown,
      }),
    });
    setNewTier(false);
    setFormData({
      name: "",
      requirements: initialRequirements(),
      qualificationOperator: "AND",
      color: "#94a3b8",
      benefits: "{}",
    });
    void queryClient.invalidateQueries({ queryKey: ["tiers"] });
  };

  const handleUpdate = async (id: string) => {
    const firstRequirement = formData.requirements[0];
    if (!firstRequirement || formData.requirements.some((rule) => !rule.pointTypeId)) return;
    await fetchApi(`/admin/tiers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        pointTypeId: firstRequirement.pointTypeId,
        name: formData.name,
        minPoints: firstRequirement.minPoints,
        qualificationRules: formData.requirements,
        qualificationOperator: formData.qualificationOperator,
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
      name: tier.name,
      requirements: tierRequirements(tier),
      qualificationOperator: tier.qualificationOperator === "OR" ? "OR" : "AND",
      color: tier.color ?? "#94a3b8",
      benefits: tier.benefits ? JSON.stringify(tier.benefits, null, 2) : "{}",
    });
  };

  const addRequirement = () => {
    const available = activePointTypes.find(
      (pointType) => !formData.requirements.some((rule) => rule.pointTypeId === pointType.id),
    );
    if (!available) return;
    setFormData((form) => ({
      ...form,
              requirements: [...form.requirements, { pointTypeId: available.id, minPoints: 0 }],
    }));
  };

  const updateRequirement = (index: number, patch: Partial<TierRequirement>) => {
    setFormData((form) => ({
      ...form,
      requirements: form.requirements.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    }));
  };

  const removeRequirement = (index: number) => {
    setFormData((form) => ({
      ...form,
      requirements: form.requirements.filter((_, ruleIndex) => ruleIndex !== index),
    }));
  };

  const renderRequirements = (requirements: TierRequirement[], editable: boolean) => (
    <div className="space-y-2">
      {requirements.map((rule, index) => (
        <div className="flex items-center gap-1" key={`${rule.pointTypeId}-${String(index)}`}>
          {editable ? (
            <select
              aria-label={ui("Qualification point type")}
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
              value={rule.pointTypeId}
              onChange={(event) => {
                updateRequirement(index, { pointTypeId: event.target.value });
              }}
            >
              <option value="">{ui("Select point type")}</option>
              {activePointTypes.map((pointType) => (
                <option key={pointType.id} value={pointType.id}>
                  {pointType.name} ({pointType.code})
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm">
              {activePointTypes.find((pointType) => pointType.id === rule.pointTypeId)?.name ?? rule.pointTypeId}
            </span>
          )}
          {editable ? (
            <Input
              className="h-9 w-24"
              type="number"
              min={0}
              value={rule.minPoints}
              onChange={(event) => {
                updateRequirement(index, { minPoints: Number(event.target.value) });
              }}
            />
          ) : (
            <span className="text-xs text-muted-foreground">≥ {rule.minPoints.toLocaleString()}</span>
          )}
          {editable && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              title={ui("Remove")}
              onClick={() => {
                removeRequirement(index);
              }}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
      ))}
      {editable && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={formData.requirements.length >= activePointTypes.length}
          onClick={addRequirement}
        >
          <Plus className="mr-1 h-3 w-3" />{ui("Add point type")}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t("tiers.title")}</h1>
        <Button
          onClick={() => {
            setNewTier(true);
            setFormData({
              name: "",
              requirements: initialRequirements(),
              qualificationOperator: "AND",
              color: "#94a3b8",
              benefits: "{}",
            });
          }}
          disabled={newTier}
        >
          <Plus className="mr-2 h-4 w-4" />{ui("New Tier")}</Button>
      </div>

      {!isLoading && tiers && tiers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{ui("Distribution")}</CardTitle>
            <CardDescription>{ui("Tier hierarchy from highest to lowest rank.")}</CardDescription>
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
                    ({tierRequirements(tier)
                      .map(
                        (rule) =>
                          `${rule.minPoints.toLocaleString()} ${activePointTypes.find((pointType) => pointType.id === rule.pointTypeId)?.code ?? "points"}`,
                      )
                      .join(tier.qualificationOperator === "OR" ? " OR " : " AND ")})
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{ui("All Tiers")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={`sk-${String(i)}`} className="h-10 w-full" />
              ))}
            </div>
          ) : isError ? (
            <p className="text-destructive">{ui("Failed to load tiers.")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">{ui("Rank")}</TableHead>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{ui("Qualification rules")}</TableHead>
                  <TableHead>{ui("Min Points")}</TableHead>
                  <TableHead>{ui("Logic")}</TableHead>
                  <TableHead>{ui("Color")}</TableHead>
                  <TableHead>{ui("Created by")}</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {newTier && (
                  <TableRow>
                    <TableCell className="text-muted-foreground">{ui("New")}</TableCell>
                    <TableCell>
                      <Input
                        value={formData.name}
                        onChange={(e) => {
                          setFormData((f) => ({ ...f, name: e.target.value }));
                        }}
                        placeholder={ui("Tier name")}
                      />
                    </TableCell>
                    <TableCell colSpan={2}>{renderRequirements(formData.requirements, true)}</TableCell>
                    <TableCell>
                      <select
                        aria-label={ui("Logic")}
                        className="h-9 rounded-md border bg-background px-2 text-xs"
                        value={formData.qualificationOperator}
                        onChange={(event) => {
                          setFormData((form) => ({
                            ...form,
                            qualificationOperator: event.target.value as "AND" | "OR",
                          }));
                        }}
                      >
                        <option value="AND">{ui("AND")}</option>
                        <option value="OR">{ui("OR")}</option>
                      </select>
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
                    <TableCell />
                    <TableCell>
                      <Button
                        size="sm"
                        disabled={!formData.requirements.length || !formData.name.trim()}
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
                      {editingId === tier.id
                        ? renderRequirements(formData.requirements, true)
                        : renderRequirements(tierRequirements(tier), false)}
                    </TableCell>
                    <TableCell>
                      {editingId === tier.id ? null : <span>--</span>}
                    </TableCell>
                    <TableCell>
                      {editingId === tier.id ? (
                        <select
                          aria-label={ui("Logic")}
                          className="h-9 rounded-md border bg-background px-2 text-xs"
                          value={formData.qualificationOperator}
                          onChange={(event) => {
                            setFormData((form) => ({
                              ...form,
                              qualificationOperator: event.target.value as "AND" | "OR",
                            }));
                          }}
                        >
                          <option value="AND">{ui("AND")}</option>
                          <option value="OR">{ui("OR")}</option>
                        </select>
                      ) : (
                        <Badge variant="outline">{tier.qualificationOperator === "OR" ? ui("OR") : ui("AND")}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div
                        className="h-6 w-6 rounded-full border"
                        style={{ backgroundColor: tier.color ?? "#ccc" }}
                      />
                    </TableCell>
                    <TableCell className="text-sm">
                      {tier.createdBy ? <><p className="font-medium">{tier.createdBy.name}</p><p className="text-xs text-muted-foreground">{tier.createdBy.email}</p></> : <span className="text-muted-foreground">{ui("System / legacy")}</span>}
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
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
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
