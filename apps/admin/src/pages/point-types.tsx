import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Plus, Save, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { HelpTooltip, HelpTooltipProvider } from "@/components/ui/help-tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi } from "@/lib/api-client";

type PointType = {
  id: string;
  code: string;
  name: string;
  unitLabel: string;
  description: string | null;
  color: string | null;
  expiryMode: "NEVER" | "AFTER_DAYS";
  expiryDays: number | null;
  allowNegativeBalance: boolean;
  allowManualAdjustment: boolean;
  transferable: boolean;
  redeemable: boolean;
  exchangeable: boolean;
  cashEligible: boolean;
  isActive: boolean;
};

type Draft = Omit<PointType, "id" | "isActive" | "expiryDays"> & {
  isActive: boolean;
  expiryDays: string;
};

const emptyDraft: Draft = {
  code: "",
  name: "",
  unitLabel: "points",
  description: "",
  color: "",
  expiryMode: "NEVER",
  expiryDays: "",
  allowNegativeBalance: false,
  allowManualAdjustment: true,
  transferable: false,
  redeemable: false,
  exchangeable: false,
  cashEligible: false,
  isActive: true,
};

function isBuiltIn(pointType: PointType): boolean {
  return pointType.code === "P" || pointType.code === "R";
}

function draftFromPointType(pointType: PointType): Draft {
  return {
    ...pointType,
    description: pointType.description ?? "",
    color: pointType.color ?? "",
    expiryDays: pointType.expiryDays ? String(pointType.expiryDays) : "",
  };
}

function DefinitionLabel({ children, help }: { children: string; help: string }): JSX.Element {
  return (
    <div className="mb-1 flex items-center gap-1">
      <Label>{children}</Label>
      <HelpTooltip label={`${children} definition`}>{help}</HelpTooltip>
    </div>
  );
}

export function PointTypesPanel(): JSX.Element {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [memberId, setMemberId] = useState("");
  const [adjustTypeId, setAdjustTypeId] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("100");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustExpiresAt, setAdjustExpiresAt] = useState("");

  const pointTypes = useQuery({
    queryKey: ["point-types"],
    queryFn: () => fetchApi<PointType[]>("/admin/point-types"),
  });
  const customPointTypes = (pointTypes.data ?? []).filter((pointType) => !isBuiltIn(pointType));
  const builtInPointTypes = (pointTypes.data ?? []).filter(isBuiltIn);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...draft,
        expiryDays:
          draft.expiryMode === "AFTER_DAYS" && draft.expiryDays ? Number(draft.expiryDays) : null,
        description: draft.description || null,
        color: draft.color || null,
      };
      return fetchApi<PointType>(
        editingId ? `/admin/point-types/${editingId}` : "/admin/point-types",
        {
          method: editingId ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: () => {
      setNotice("Custom point type saved.");
      setDraft(emptyDraft);
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: ["point-types"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const adjust = useMutation({
    mutationFn: () =>
      fetchApi(`/admin/point-types/${adjustTypeId}/adjust`, {
        method: "POST",
        body: JSON.stringify({
          memberId,
          amount: Number(adjustAmount),
          reason: adjustReason,
          ...(adjustExpiresAt
            ? { expiresAt: new Date(`${adjustExpiresAt}T23:59:59.000Z`).toISOString() }
            : {}),
        }),
        headers: { "Idempotency-Key": crypto.randomUUID() },
      }),
    onSuccess: () => {
      setNotice("Custom point wallet adjusted.");
      setMemberId("");
      setAdjustReason("");
      setAdjustExpiresAt("");
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const toggleActive = useMutation({
    mutationFn: (pointType: PointType) =>
      fetchApi(`/admin/point-types/${pointType.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !pointType.isActive }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["point-types"] }),
    onError: (error: Error) => setNotice(error.message),
  });

  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <SlidersHorizontal className="h-6 w-6" /> Credit type registry
          <HelpTooltip label="Credit type registry definition">
            P-credit and R-credit are the two rule-book wallets used by Give, Redeem, Exchange and
            the Credit Bank. Custom point types are optional independent wallets and do not
            participate in those P/R flows.
          </HelpTooltip>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure the built-in credit types in Credits & Recognition, then add optional custom
          wallets here without duplicating the P/R ledger.
        </p>
      </div>

      {notice && (
        <div role="status" className="rounded-md border bg-muted p-3 text-sm">
          {notice}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" /> Built-in rule-book credits
          </CardTitle>
          <CardDescription>
            P-credit and R-credit are read-only here because their balances and ledger are managed
            by the Credits & Recognition module.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {(builtInPointTypes.length
            ? builtInPointTypes
            : [
                {
                  code: "P",
                  name: "P-credit",
                  description: "Project credit with expiry and cash exchange support.",
                  expiryMode: "AFTER_DAYS",
                  expiryDays: 365,
                },
                {
                  code: "R",
                  name: "R-credit",
                  description: "Recognition credit with no expiry and no cash exchange.",
                  expiryMode: "NEVER",
                  expiryDays: null,
                },
              ]
          ).map((pointType) => (
            <div key={pointType.code} className="rounded-md border p-3">
              <div className="flex items-center gap-2 font-medium">
                {pointType.name}{" "}
                <span className="text-xs text-muted-foreground">({pointType.code})</span>
                <HelpTooltip label={`${pointType.name} definition`}>
                  {pointType.description ?? "Built-in rule-book credit type."} This type uses the
                  CreditWallet ledger, not a custom point wallet.
                </HelpTooltip>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {pointType.expiryMode === "NEVER"
                  ? "No expiry"
                  : `Expiry policy: ${String(pointType.expiryDays)} days by default`}{" "}
                · Managed in Credits & Recognition
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" /> Custom point wallets
          </CardTitle>
          <CardDescription>
            Use this only for an additional independent balance such as badges, tokens or vouchers.
            It is not a second way to issue P/R credits.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <DefinitionLabel help="Stable API identifier for this custom wallet. P and R are reserved for the built-in Credit & Recognition ledger.">
              Code
            </DefinitionLabel>
            <Input
              value={draft.code}
              disabled={Boolean(editingId)}
              onChange={(event) => updateDraft("code", event.target.value)}
              placeholder="myCred"
            />
          </div>
          <div>
            <DefinitionLabel help="Human-readable name shown to administrators and members.">
              Name
            </DefinitionLabel>
            <Input
              value={draft.name}
              onChange={(event) => updateDraft("name", event.target.value)}
              placeholder="My Credits"
            />
          </div>
          <div>
            <DefinitionLabel help="Unit displayed next to the balance, for example tokens or vouchers.">
              Unit label
            </DefinitionLabel>
            <Input
              value={draft.unitLabel}
              onChange={(event) => updateDraft("unitLabel", event.target.value)}
              placeholder="credits"
            />
          </div>
          <div>
            <DefinitionLabel help="Optional accent color for this custom wallet in future member-facing views.">
              Color
            </DefinitionLabel>
            <Input
              value={draft.color ?? ""}
              onChange={(event) => updateDraft("color", event.target.value)}
              placeholder="#7c3aed"
            />
          </div>
          <div className="md:col-span-2">
            <DefinitionLabel help="Short description explaining what this custom balance is for and how it may be used.">
              Description
            </DefinitionLabel>
            <Input
              value={draft.description ?? ""}
              onChange={(event) => updateDraft("description", event.target.value)}
              placeholder="What this wallet is used for"
            />
          </div>
          <div>
            <DefinitionLabel help="Controls whether positive grants create expiring lots. Never keeps the balance available until it is spent.">
              Expiry
            </DefinitionLabel>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={draft.expiryMode}
              onChange={(event) =>
                updateDraft("expiryMode", event.target.value as Draft["expiryMode"])
              }
            >
              <option value="NEVER">Never expires</option>
              <option value="AFTER_DAYS">Expires after days</option>
            </select>
          </div>
          <div>
            <DefinitionLabel help="Number of days after a grant before the unused portion expires.">
              Expiry days
            </DefinitionLabel>
            <Input
              type="number"
              min="1"
              disabled={draft.expiryMode === "NEVER"}
              value={draft.expiryDays}
              onChange={(event) => updateDraft("expiryDays", event.target.value)}
              placeholder="365"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 md:col-span-2 lg:grid-cols-3">
            {(
              [
                [
                  "allowNegativeBalance",
                  "Allow negative balance",
                  "Allows deductions below zero; keep off for normal stored-value wallets.",
                ],
                [
                  "allowManualAdjustment",
                  "Allow manual adjustment",
                  "Allows an administrator to grant or deduct this custom wallet.",
                ],
                [
                  "transferable",
                  "Transferable",
                  "Marks the wallet as eligible for a future transfer flow.",
                ],
                [
                  "redeemable",
                  "Redeemable",
                  "Marks the wallet as eligible for a future reward redemption flow.",
                ],
                [
                  "exchangeable",
                  "Exchangeable",
                  "Marks the wallet as eligible for a future exchange flow.",
                ],
                [
                  "cashEligible",
                  "Cash eligible",
                  "Marks the wallet as eligible for cash settlement; the API also requires exchangeable.",
                ],
              ] as const
            ).map(([key, label, help]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(event) => updateDraft(key, event.target.checked)}
                />
                {label}
                <HelpTooltip label={`${label} definition`}>{help}</HelpTooltip>
              </label>
            ))}
          </div>
          <div className="flex gap-2 md:col-span-2">
            <Button
              disabled={save.isPending || !draft.code || !draft.name}
              onClick={() => save.mutate()}
            >
              <Save className="h-4 w-4" />
              {save.isPending ? "Saving…" : "Save custom point type"}
            </Button>
            {editingId && (
              <Button
                variant="outline"
                onClick={() => {
                  setEditingId(null);
                  setDraft(emptyDraft);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Defined custom wallets</CardTitle>
          <CardDescription>
            Deactivate a custom type to stop new grants while preserving its history.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {customPointTypes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No custom point types yet. The built-in P/R credits are shown above.
            </p>
          )}
          {customPointTypes.map((pointType) => (
            <div
              key={pointType.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div>
                <div className="font-medium">
                  {pointType.name}{" "}
                  <span className="text-xs text-muted-foreground">({pointType.code})</span>
                  <HelpTooltip label={`${pointType.name} definition`}>
                    {pointType.description ?? "No description provided."}
                  </HelpTooltip>
                </div>
                <div className="text-xs text-muted-foreground">
                  {pointType.unitLabel} ·{" "}
                  {pointType.expiryMode === "NEVER"
                    ? "no expiry"
                    : `${String(pointType.expiryDays)} days`}{" "}
                  · {pointType.isActive ? "active" : "inactive"}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingId(pointType.id);
                    setDraft(draftFromPointType(pointType));
                  }}
                >
                  Edit
                </Button>
                <Button size="sm" variant="outline" onClick={() => toggleActive.mutate(pointType)}>
                  {pointType.isActive ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom wallet adjustment</CardTitle>
          <CardDescription>
            Adjust only custom wallets here. Use Credits & Recognition for P-credit and R-credit
            adjustments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <DefinitionLabel help="The custom point type whose wallet will be adjusted. Built-in P/R credits are intentionally excluded.">
                Custom point type
              </DefinitionLabel>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={adjustTypeId}
                onChange={(event) => setAdjustTypeId(event.target.value)}
              >
                <option value="">Select custom point type</option>
                {customPointTypes
                  .filter((item) => item.isActive)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.code})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <DefinitionLabel help="The active member receiving or losing the custom wallet balance.">
                Member ID
              </DefinitionLabel>
              <Input
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
                placeholder="Member ID"
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <DefinitionLabel help="Positive grants add balance; negative adjustments remove balance and require enough available balance unless explicitly enabled on the type.">
                Amount
              </DefinitionLabel>
              <Input
                type="number"
                value={adjustAmount}
                onChange={(event) => setAdjustAmount(event.target.value)}
              />
            </div>
            <div>
              <DefinitionLabel help="Optional override for the grant lot expiry. If omitted, the point type expiry policy is used.">
                Expires at
              </DefinitionLabel>
              <Input
                type="date"
                value={adjustExpiresAt}
                onChange={(event) => setAdjustExpiresAt(event.target.value)}
              />
            </div>
            <div>
              <DefinitionLabel help="Mandatory audit reason explaining the business purpose of this adjustment.">
                Reason
              </DefinitionLabel>
              <Input
                value={adjustReason}
                onChange={(event) => setAdjustReason(event.target.value)}
                placeholder="Reason"
              />
            </div>
          </div>
          <Button
            disabled={adjust.isPending || !adjustTypeId || !memberId || !adjustReason.trim()}
            onClick={() => adjust.mutate()}
          >
            Apply custom wallet adjustment
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function PointTypesPage(): JSX.Element {
  return (
    <HelpTooltipProvider>
      <PointTypesPanel />
    </HelpTooltipProvider>
  );
}
