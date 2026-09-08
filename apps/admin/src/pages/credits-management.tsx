import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw, Settings2, Upload, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpTooltip, HelpTooltipProvider } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi } from "@/lib/api-client";
import { PointTypesPanel } from "@/pages/point-types";

type CreditType = "P" | "R";
type Bank = { creditType: CreditType; balance: number };
type Config = {
  id: string;
  creditGivingLimit: number | null;
  creditGivingPeriodDays: number;
  creditGivingPairLimit: number | null;
  creditBankCycleDays: number;
  creditExpiryWarningDays: number[];
};
type Category = { id: string; name: string; description: string | null; isActive: boolean };
type Rate = {
  id: string;
  creditType: CreditType;
  version: number;
  valueMinorPerCredit: number;
  currency: string;
  payoutMechanism: string;
  cashEligible: boolean;
  minCredits: number;
  maxCredits: number | null;
};
type ExchangeRequest = {
  id: string;
  member: { id: string; email: string | null; firstName: string | null; lastName: string | null };
  creditType: CreditType;
  amount: number;
  valueMinor: number;
  currency: string;
  payoutType: string;
  status: string;
  requestedAt: string;
};
type Cycle = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  openingP: number;
  openingR: number;
  closingP: number;
  closingR: number;
};
type LedgerItem = {
  id: string;
  memberId: string;
  creditType: CreditType;
  type: string;
  amount: number;
  balanceAfter: number;
  reason: string | null;
  createdAt: string;
  member?: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    department: string | null;
  };
  counterparty?: { email: string | null; firstName: string | null; lastName: string | null } | null;
  categoryRef?: { name: string } | null;
};
type BulkBatch = {
  id: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  status: string;
  report?: Array<{ row: number; status: string; error?: string }>;
};
type SettingDefinition = { key: string; label: string; type: string; description: string };
type SettingPermission = {
  id: string;
  settingKey: string;
  role: "SUPER_ADMIN" | "OPERATOR" | "ANALYST";
  canView: boolean;
  canEdit: boolean;
};
type GovernanceSettings = {
  values: Record<string, unknown>;
  definitions: SettingDefinition[];
  permissions: SettingPermission[];
  currentAdminRole: "SUPER_ADMIN" | "OPERATOR" | "ANALYST" | "SERVER" | null;
};

const fieldClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";

export function CreditsManagementPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [bankType, setBankType] = useState<CreditType>("P");
  const [bankAmount, setBankAmount] = useState("1000");
  const [bankReason, setBankReason] = useState("Initial approved credit budget");
  const [memberId, setMemberId] = useState("");
  const [adjustType, setAdjustType] = useState<CreditType>("P");
  const [adjustAmount, setAdjustAmount] = useState("100");
  const [adjustReason, setAdjustReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [bulkCsv, setBulkCsv] = useState("email,firstName,lastName,pCredit,rCredit,pExpiresAt\n");
  const [bulkFormat, setBulkFormat] = useState<"csv" | "xlsx">("csv");
  const [bulkResult, setBulkResult] = useState<BulkBatch | null>(null);
  const [rateType, setRateType] = useState<CreditType>("P");
  const [rateValue, setRateValue] = useState("0");
  const [rateCurrency, setRateCurrency] = useState("USD");
  const [rateMechanism, setRateMechanism] = useState("manual_bank_transfer");
  const [rateCash, setRateCash] = useState(false);
  const [rateMin, setRateMin] = useState("1");
  const [rateMax, setRateMax] = useState("");
  const [ledgerType, setLedgerType] = useState("");
  const [ledgerCreditType, setLedgerCreditType] = useState("");
  const [ledgerCategory, setLedgerCategory] = useState("");
  const [ledgerDateFrom, setLedgerDateFrom] = useState("");
  const [ledgerDateTo, setLedgerDateTo] = useState("");
  const [ledgerMin, setLedgerMin] = useState("");
  const [ledgerMax, setLedgerMax] = useState("");
  const [settingDraft, setSettingDraft] = useState<Record<string, string | boolean>>({});
  const [permissionDraft, setPermissionDraft] = useState<
    Record<string, { canView: boolean; canEdit: boolean }>
  >({});

  const bank = useQuery({
    queryKey: ["credit-bank"],
    queryFn: () => fetchApi<Bank[]>("/admin/credits/bank"),
  });
  const config = useQuery({
    queryKey: ["credit-config"],
    queryFn: () => fetchApi<Config>("/admin/credits/config"),
  });
  const categories = useQuery({
    queryKey: ["credit-categories"],
    queryFn: () => fetchApi<Category[]>("/admin/credits/categories"),
  });
  const rates = useQuery({
    queryKey: ["credit-rates"],
    queryFn: () => fetchApi<Rate[]>("/credits/exchange/rates"),
  });
  const requests = useQuery({
    queryKey: ["credit-exchange-requests"],
    queryFn: () =>
      fetchApi<{ items: ExchangeRequest[] }>(
        "/admin/credits/exchange-requests?status=PENDING&pageSize=50",
      ),
  });
  const cycles = useQuery({
    queryKey: ["credit-bank-cycles"],
    queryFn: () => fetchApi<Cycle[]>("/admin/credits/bank/cycles"),
  });
  const governance = useQuery({
    queryKey: ["credit-governance-settings"],
    queryFn: () => fetchApi<GovernanceSettings>("/admin/credits/settings"),
  });
  const ledger = useQuery({
    queryKey: [
      "credit-ledger",
      ledgerType,
      ledgerCreditType,
      ledgerCategory,
      ledgerDateFrom,
      ledgerDateTo,
      ledgerMin,
      ledgerMax,
    ],
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "50" });
      if (ledgerType) params.set("type", ledgerType);
      if (ledgerCreditType) params.set("creditType", ledgerCreditType);
      if (ledgerCategory) params.set("categoryId", ledgerCategory);
      if (ledgerDateFrom) params.set("dateFrom", `${ledgerDateFrom}T00:00:00.000Z`);
      if (ledgerDateTo) params.set("dateTo", `${ledgerDateTo}T23:59:59.999Z`);
      if (ledgerMin) params.set("minAmount", ledgerMin);
      if (ledgerMax) params.set("maxAmount", ledgerMax);
      return fetchApi<{ items: LedgerItem[] }>(`/admin/credits/transactions?${params.toString()}`);
    },
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["credit-bank"] });
    void queryClient.invalidateQueries({ queryKey: ["credit-config"] });
    void queryClient.invalidateQueries({ queryKey: ["credit-categories"] });
    void queryClient.invalidateQueries({ queryKey: ["credit-rates"] });
    void queryClient.invalidateQueries({ queryKey: ["credit-exchange-requests"] });
    void queryClient.invalidateQueries({ queryKey: ["credit-bank-cycles"] });
    void queryClient.invalidateQueries({ queryKey: ["credit-governance-settings"] });
  };

  const mutate = useMutation({
    mutationFn: async ({
      path,
      method = "POST",
      body,
    }: {
      path: string;
      method?: "POST" | "PATCH";
      body: unknown;
    }) =>
      fetchApi(path, {
        method,
        body: JSON.stringify(body),
        headers: { "Idempotency-Key": crypto.randomUUID() },
      }),
    onSuccess: () => {
      setNotice("Saved successfully.");
      refresh();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const importBulk = useMutation({
    mutationFn: () =>
      fetchApi<BulkBatch>("/admin/members/bulk", {
        method: "POST",
        body: JSON.stringify({
          format: bulkFormat,
          content: bulkCsv,
          sourceName:
            bulkFormat === "xlsx" ? "admin-credit-import.xlsx" : "admin-credit-import.csv",
        }),
      }),
    onSuccess: (result) => {
      setBulkResult(result);
      setNotice(
        `Imported ${String(result.successRows)}/${String(result.totalRows)} rows (${result.status}).`,
      );
    },
    onError: (error: Error) => setNotice(error.message),
  });

  useEffect(() => {
    if (!governance.data) return;
    setSettingDraft(
      Object.fromEntries(
        governance.data.definitions.map((definition) => [
          definition.key,
          typeof governance.data.values[definition.key] === "boolean"
            ? (governance.data.values[definition.key] as boolean)
            : String(governance.data.values[definition.key] ?? ""),
        ]),
      ),
    );
    setPermissionDraft(
      Object.fromEntries(
        governance.data.permissions.map((permission) => [
          `${permission.role}:${permission.settingKey}`,
          { canView: permission.canView, canEdit: permission.canEdit },
        ]),
      ),
    );
  }, [governance.data]);

  const canViewSetting = (definition: SettingDefinition): boolean => {
    const role = governance.data?.currentAdminRole;
    if (role === "SERVER" || role === "SUPER_ADMIN") return true;
    return (
      governance.data?.permissions.some(
        (permission) =>
          permission.settingKey === definition.key &&
          permission.role === role &&
          permission.canView,
      ) ?? false
    );
  };

  const visibleDefinitions = (governance.data?.definitions ?? []).filter(canViewSetting);

  const settingControl = (
    definition: SettingDefinition,
    value: string | boolean | undefined,
    canEdit: boolean,
  ): JSX.Element => {
    if (["format", "issuance_policy", "approval_policy", "visibility"].includes(definition.type)) {
      const options =
        definition.type === "format"
          ? [
              ["csv", "CSV"],
              ["json", "JSON"],
            ]
          : definition.type === "issuance_policy"
            ? [
                ["ADMIN_ONLY", "Admin only"],
                ["BANK_CYCLE", "Bank cycle"],
              ]
            : definition.type === "approval_policy"
              ? [
                  ["REASON_REQUIRED", "Reason required"],
                  ["APPROVAL_REQUIRED", "Approval required"],
                ]
              : [
                  ["ADMIN_ONLY", "Admin only"],
                  ["MEMBER_READ_ONLY", "Employee read-only"],
                ];
      return (
        <select
          disabled={!canEdit}
          className={fieldClass}
          value={String(value ?? "")}
          onChange={(event) =>
            setSettingDraft((draft) => ({ ...draft, [definition.key]: event.target.value }))
          }
        >
          {options.map(([optionValue, optionLabel]) => (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          ))}
        </select>
      );
    }
    return (
      <Input
        disabled={!canEdit}
        type={
          definition.type === "integer" || definition.type === "nullable_integer"
            ? "number"
            : definition.type === "boolean"
              ? "checkbox"
              : "text"
        }
        value={definition.type === "boolean" ? undefined : String(value ?? "")}
        checked={definition.type === "boolean" ? Boolean(value) : undefined}
        onChange={(event) =>
          setSettingDraft((draft) => ({
            ...draft,
            [definition.key]:
              definition.type === "boolean" ? event.target.checked : event.target.value,
          }))
        }
        placeholder={definition.description}
      />
    );
  };

  const saveGovernanceSettings = useMutation({
    mutationFn: () => {
      const values = Object.fromEntries(
        governance.data?.definitions
          .filter((definition) => {
            const permission = governance.data?.permissions.find(
              (item) =>
                item.settingKey === definition.key &&
                (governance.data?.currentAdminRole === "SERVER" ||
                  item.role === governance.data?.currentAdminRole),
            );
            return governance.data?.currentAdminRole === "SERVER" || permission?.canEdit;
          })
          .map((definition) => {
            const value = settingDraft[definition.key];
            if (definition.type === "integer") return [definition.key, Number(value)];
            if (definition.type === "nullable_integer")
              return [definition.key, value === "" ? null : Number(value)];
            if (definition.type === "boolean") return [definition.key, Boolean(value)];
            return [definition.key, String(value ?? "")];
          }) ?? [],
      );
      return fetchApi<GovernanceSettings>("/admin/credits/settings", {
        method: "PATCH",
        body: JSON.stringify({ values }),
      });
    },
    onSuccess: () => {
      setNotice("Governance settings saved.");
      void queryClient.invalidateQueries({ queryKey: ["credit-governance-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["credit-rates"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const savePermissions = useMutation({
    mutationFn: ({ role }: { role: "SUPER_ADMIN" | "OPERATOR" | "ANALYST" }) =>
      fetchApi<GovernanceSettings>("/admin/credits/settings/permissions", {
        method: "PATCH",
        body: JSON.stringify({
          role,
          permissions:
            governance.data?.definitions.map((definition) => ({
              key: definition.key,
              ...(permissionDraft[`${role}:${definition.key}`] ?? {
                canView: true,
                canEdit: false,
              }),
            })) ?? [],
        }),
      }),
    onSuccess: () => {
      setNotice("Setting permissions saved.");
      void queryClient.invalidateQueries({ queryKey: ["credit-governance-settings"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  return (
    <HelpTooltipProvider>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Credits & Recognition</h1>
            <p className="text-muted-foreground">
              Operate P-credit, R-credit, the bank, exchanges and the immutable audit trail.
            </p>
          </div>
          <Button variant="outline" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
        {notice && (
          <p role="status" className="rounded-md border bg-muted px-4 py-3 text-sm">
            {notice}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <WalletCards className="h-5 w-5" />
                Credit Bank{" "}
                <HelpTooltip label="Credit Bank definition">
                  The central pool of unallocated P-credit and R-credit. Admin allocates from it to
                  members, project leaders or campaigns; it must be reconciled each cycle.
                </HelpTooltip>
              </CardTitle>
              <CardDescription>
                Issue only through the bank, then allocate to members with a reason.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {(["P", "R"] as CreditType[]).map((type) => (
                  <div key={type} className="rounded-md bg-muted p-3">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      {type}-credit bank{" "}
                      <HelpTooltip label={`${type}-credit bank definition`}>
                        {type === "P"
                          ? "Project-funded credit; it may expire and is the only cash-eligible type."
                          : "Recognition credit; it does not expire and cannot be paid out as cash."}
                      </HelpTooltip>
                    </div>
                    <div className="text-2xl font-bold">
                      {(
                        bank.data?.find((item) => item.creditType === type)?.balance ?? 0
                      ).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Credit type{" "}
                    <HelpTooltip label="Credit type definition">
                      Choose which of the two rule-book wallets receives the new bank issuance.
                    </HelpTooltip>
                  </Label>
                  <select
                    className={fieldClass}
                    value={bankType}
                    onChange={(event) => setBankType(event.target.value as CreditType)}
                  >
                    <option value="P">P-credit</option>
                    <option value="R">R-credit</option>
                  </select>
                </div>
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Amount{" "}
                    <HelpTooltip label="Bank amount definition">
                      Positive integer added to the selected central bank. It is not added directly
                      to a member.
                    </HelpTooltip>
                  </Label>
                  <Input
                    type="number"
                    min="1"
                    value={bankAmount}
                    onChange={(event) => setBankAmount(event.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label className="mb-1 flex items-center gap-1">
                  Reason / approved budget reference{" "}
                  <HelpTooltip label="Bank reason definition">
                    Required audit note identifying the approved budget or funding decision for this
                    issuance.
                  </HelpTooltip>
                </Label>
                <Input
                  value={bankReason}
                  onChange={(event) => setBankReason(event.target.value)}
                  placeholder="Approved budget reference"
                />
              </div>
              <Button
                disabled={mutate.isPending || !bankReason.trim()}
                onClick={() =>
                  mutate.mutate({
                    path: "/admin/credits/bank/issue",
                    body: { creditType: bankType, amount: Number(bankAmount), reason: bankReason },
                  })
                }
              >
                Issue to bank
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1">
                Member adjustment{" "}
                <HelpTooltip label="Member adjustment definition">
                  An admin-only balance change outside Give/Redeem/Exchange. It always needs a
                  reason and creates a ledger plus audit entry.
                </HelpTooltip>
              </CardTitle>
              <CardDescription>
                Positive P-credit requires an expiry date. Negative adjustments return credits to
                the bank.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="mb-1 flex items-center gap-1">
                  Member ID{" "}
                  <HelpTooltip label="Member ID definition">
                    The active employee whose P-credit or R-credit wallet will be changed.
                  </HelpTooltip>
                </Label>
                <Input
                  value={memberId}
                  onChange={(event) => setMemberId(event.target.value)}
                  placeholder="Member ID"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Credit type{" "}
                    <HelpTooltip label="Adjustment credit type definition">
                      The wallet affected by this adjustment. P and R balances are kept separate.
                    </HelpTooltip>
                  </Label>
                  <select
                    className={fieldClass}
                    value={adjustType}
                    onChange={(event) => setAdjustType(event.target.value as CreditType)}
                  >
                    <option value="P">P-credit</option>
                    <option value="R">R-credit</option>
                  </select>
                </div>
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Amount{" "}
                    <HelpTooltip label="Adjustment amount definition">
                      Positive adds from the Credit Bank; negative removes from the member and
                      returns the amount to the bank.
                    </HelpTooltip>
                  </Label>
                  <Input
                    type="number"
                    value={adjustAmount}
                    onChange={(event) => setAdjustAmount(event.target.value)}
                    placeholder="Amount (+/-)"
                  />
                </div>
              </div>
              {adjustType === "P" && Number(adjustAmount) > 0 && (
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Expiry date (required for positive P-credit){" "}
                    <HelpTooltip label="P-credit expiry definition">
                      Unused P-credit lapses at this date. R-credit has no expiry.
                    </HelpTooltip>
                  </Label>
                  <Input
                    type="date"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.target.value)}
                  />
                </div>
              )}
              <div>
                <Label className="mb-1 flex items-center gap-1">
                  Reason / occasion / proposal reference{" "}
                  <HelpTooltip label="Adjustment reason definition">
                    Mandatory explanation for a bonus, correction, fraud response, onboarding or
                    proposal-based grant.
                  </HelpTooltip>
                </Label>
                <Input
                  value={adjustReason}
                  onChange={(event) => setAdjustReason(event.target.value)}
                  placeholder="Reason / occasion / proposal reference"
                />
              </div>
              <Button
                disabled={mutate.isPending || !memberId || !adjustReason.trim()}
                onClick={() =>
                  mutate.mutate({
                    path: "/admin/credits/adjust",
                    body: {
                      memberId,
                      creditType: adjustType,
                      amount: Number(adjustAmount),
                      reason: adjustReason,
                      ...(expiresAt
                        ? { expiresAt: new Date(`${expiresAt}T23:59:59.000Z`).toISOString() }
                        : {}),
                    },
                  })
                }
              >
                Apply adjustment
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Program policy
            </CardTitle>
            <CardDescription>
              These values are configurable launch decisions; changing them is audited.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {config.data && (
              <div className="grid gap-3 md:grid-cols-5">
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    R allowance / period{" "}
                    <HelpTooltip label="R-credit allowance definition">
                      Maximum R-credit an employee can give during the configured rolling period.
                      P-credit uses its balance and expiry instead of this allowance.
                    </HelpTooltip>
                  </Label>
                  <Input
                    type="number"
                    defaultValue={config.data.creditGivingLimit ?? ""}
                    id="giving-limit"
                  />
                </div>
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Period days{" "}
                    <HelpTooltip label="Giving period definition">
                      Length of the rolling window used to calculate the R-credit allowance.
                    </HelpTooltip>
                  </Label>
                  <Input
                    type="number"
                    defaultValue={config.data.creditGivingPeriodDays}
                    id="giving-period"
                  />
                </div>
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Pair limit{" "}
                    <HelpTooltip label="Giver-receiver pair limit definition">
                      Optional maximum amount an employee may give to the same recipient in the
                      rolling period.
                    </HelpTooltip>
                  </Label>
                  <Input
                    type="number"
                    defaultValue={config.data.creditGivingPairLimit ?? ""}
                    id="pair-limit"
                  />
                </div>
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Bank cycle days{" "}
                    <HelpTooltip label="Bank cycle definition">
                      Length of the rolling Credit Bank reconciliation cycle. Clearing is recorded;
                      ledger history is never deleted.
                    </HelpTooltip>
                  </Label>
                  <Input
                    type="number"
                    defaultValue={config.data.creditBankCycleDays}
                    id="cycle-days"
                  />
                </div>
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Expiry warnings{" "}
                    <HelpTooltip label="Expiry warning definition">
                      Comma-separated days before P-credit expiry when the worker may send advance
                      notifications.
                    </HelpTooltip>
                  </Label>
                  <Input
                    defaultValue={config.data.creditExpiryWarningDays.join(",")}
                    id="warning-days"
                  />
                </div>
              </div>
            )}
            <Button
              className="mt-3"
              onClick={() => {
                const numberOrNull = (id: string): number | null => {
                  const value =
                    (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
                  return value.trim() ? Number(value) : null;
                };
                const warnings = (
                  (document.getElementById("warning-days") as HTMLInputElement | null)?.value ?? ""
                )
                  .split(",")
                  .map((value) => Number(value.trim()))
                  .filter((value) => Number.isInteger(value) && value > 0);
                mutate.mutate({
                  path: "/admin/credits/config",
                  method: "PATCH",
                  body: {
                    creditGivingLimit: numberOrNull("giving-limit"),
                    creditGivingPeriodDays: numberOrNull("giving-period") ?? 30,
                    creditGivingPairLimit: numberOrNull("pair-limit"),
                    creditBankCycleDays: numberOrNull("cycle-days") ?? 30,
                    creditExpiryWarningDays: warnings,
                  },
                });
              }}
            >
              Save policy
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1">
              Governance settings & permissions{" "}
              <HelpTooltip label="Governance settings definition">
                These settings are launch and finance decisions. Values are stored per program,
                changes are audited, and permissions determine who can see or edit each setting.
              </HelpTooltip>
            </CardTitle>
            <CardDescription>
              Financial values, payout/reconciliation behavior and employee visibility are database
              settings. Every change is audited and role-scoped.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              Current role: <strong>{governance.data?.currentAdminRole ?? "…"}</strong>. SUPER_ADMIN
              controls the permission matrix; OPERATOR can edit only the settings granted to its
              role.
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {visibleDefinitions.map((definition) => {
                const permission = governance.data?.permissions.find(
                  (item) =>
                    item.settingKey === definition.key &&
                    (governance.data?.currentAdminRole === "SERVER" ||
                      item.role === governance.data?.currentAdminRole),
                );
                const canEdit =
                  governance.data?.currentAdminRole === "SERVER" || permission?.canEdit === true;
                const value = settingDraft[definition.key];
                return (
                  <div key={definition.key} className="space-y-1">
                    <div className="flex items-center gap-1">
                      <Label>{definition.label}</Label>
                      <HelpTooltip label={`${definition.label} definition`}>
                        {definition.description}
                      </HelpTooltip>
                    </div>
                    {settingControl(definition, value, canEdit)}
                    {!canEdit && (
                      <p className="text-xs text-muted-foreground">
                        Visible but read-only for your role.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <Button
              disabled={saveGovernanceSettings.isPending}
              onClick={() => saveGovernanceSettings.mutate()}
            >
              {saveGovernanceSettings.isPending ? "Saving…" : "Save governance settings"}
            </Button>
            {(governance.data?.currentAdminRole === "SUPER_ADMIN" ||
              governance.data?.currentAdminRole === "SERVER") && (
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <h3 className="flex items-center gap-1 font-medium">
                    Role permissions{" "}
                    <HelpTooltip label="Role permission definition">
                      View means the setting is visible to the role. Edit means it can be changed.
                      Edit is only valid when View is enabled.
                    </HelpTooltip>
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Use the explicit labels below instead of guessing what each checkbox controls.
                  </p>
                </div>
                {(["OPERATOR", "ANALYST"] as const).map((role) => (
                  <div key={role} className="overflow-x-auto">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-medium">{role}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savePermissions.isPending}
                        onClick={() => savePermissions.mutate({ role })}
                      >
                        Save {role}
                      </Button>
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="py-1 pr-3">Setting</th>
                          <th className="py-1 pr-3">
                            Can view{" "}
                            <HelpTooltip label="Can view definition">
                              The setting and current value are returned to this role.
                            </HelpTooltip>
                          </th>
                          <th className="py-1">
                            Can edit{" "}
                            <HelpTooltip label="Can edit definition">
                              The role may save a new value. Turning off View automatically turns
                              off Edit.
                            </HelpTooltip>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(governance.data?.definitions ?? []).map((definition) => {
                          const key = `${role}:${definition.key}`;
                          const permission = permissionDraft[key] ?? {
                            canView: true,
                            canEdit: false,
                          };
                          return (
                            <tr key={key} className="border-b last:border-0">
                              <td className="py-1 pr-3">
                                <span className="inline-flex items-center gap-1">
                                  {definition.label}
                                  <HelpTooltip label={`${definition.label} definition`}>
                                    {definition.description}
                                  </HelpTooltip>
                                </span>
                              </td>
                              <td className="py-1 pr-3">
                                <label className="inline-flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={permission.canView}
                                    onChange={(event) =>
                                      setPermissionDraft((draft) => ({
                                        ...draft,
                                        [key]: {
                                          ...permission,
                                          canView: event.target.checked,
                                          canEdit: event.target.checked
                                            ? permission.canEdit
                                            : false,
                                        },
                                      }))
                                    }
                                  />
                                  View
                                </label>
                              </td>
                              <td className="py-1">
                                <label className="inline-flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={permission.canEdit}
                                    disabled={!permission.canView}
                                    onChange={(event) =>
                                      setPermissionDraft((draft) => ({
                                        ...draft,
                                        [key]: { ...permission, canEdit: event.target.checked },
                                      }))
                                    }
                                  />
                                  Edit
                                </label>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <PointTypesPanel />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1">
                Recognition categories{" "}
                <HelpTooltip label="Recognition category definition">
                  Optional labels on Give transactions, such as teamwork or customer focus.
                  Categories in use are deactivated instead of deleted.
                </HelpTooltip>
              </CardTitle>
              <CardDescription>
                Categories are reference data and cannot be deleted after use.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Name{" "}
                    <HelpTooltip label="Category name definition">
                      The label employees select when giving recognition.
                    </HelpTooltip>
                  </Label>
                  <Input
                    value={categoryName}
                    onChange={(event) => setCategoryName(event.target.value)}
                    placeholder="Category name"
                  />
                </div>
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Description{" "}
                    <HelpTooltip label="Category description definition">
                      Optional explanation that helps employees choose the right category.
                    </HelpTooltip>
                  </Label>
                  <Input
                    value={categoryDescription}
                    onChange={(event) => setCategoryDescription(event.target.value)}
                    placeholder="Description"
                  />
                </div>
              </div>
              <Button
                disabled={!categoryName.trim()}
                onClick={() => {
                  mutate.mutate({
                    path: "/admin/credits/categories",
                    body: { name: categoryName, description: categoryDescription },
                  });
                  setCategoryName("");
                  setCategoryDescription("");
                }}
              >
                Add category
              </Button>
              <div className="divide-y">
                {(categories.data ?? []).map((category) => (
                  <div key={category.id} className="flex items-center justify-between py-2 text-sm">
                    <span className={category.isActive ? "" : "text-muted-foreground line-through"}>
                      {category.name}
                    </span>
                    {category.isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          mutate.mutate({
                            path: `/admin/credits/categories/${category.id}`,
                            method: "PATCH",
                            body: { isActive: false },
                          })
                        }
                      >
                        Deactivate
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1">
                Exchange rates{" "}
                <HelpTooltip label="Exchange rate definition">
                  A versioned value used to preview and record an Exchange. The applied version is
                  stored on the request and ledger so history does not change when rates are
                  updated.
                </HelpTooltip>
              </CardTitle>
              <CardDescription>
                Each save creates a new version; requests store the exact version used.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Credit type{" "}
                    <HelpTooltip label="Exchange credit type definition">
                      P-credit may use cash payout; R-credit is non-cash only, as required by the
                      rule book.
                    </HelpTooltip>
                  </Label>
                  <select
                    className={fieldClass}
                    value={rateType}
                    onChange={(event) => setRateType(event.target.value as CreditType)}
                  >
                    <option value="P">P-credit</option>
                    <option value="R">R-credit</option>
                  </select>
                </div>
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Minor units / credit{" "}
                    <HelpTooltip label="Rate value definition">
                      Integer monetary minor units per credit, for example cents. Enter the
                      Finance-approved value before enabling Exchange.
                    </HelpTooltip>
                  </Label>
                  <Input
                    type="number"
                    min="1"
                    value={rateValue}
                    onChange={(event) => setRateValue(event.target.value)}
                    placeholder="Not configured"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Currency{" "}
                    <HelpTooltip label="Currency definition">
                      Three-letter currency code used for the payout value.
                    </HelpTooltip>
                  </Label>
                  <Input
                    value={rateCurrency}
                    onChange={(event) => setRateCurrency(event.target.value.toUpperCase())}
                    placeholder="Currency"
                  />
                </div>
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Payout mechanism{" "}
                    <HelpTooltip label="Payout mechanism definition">
                      Operational route for settlement, such as payroll, gift card or a partner
                      adapter.
                    </HelpTooltip>
                  </Label>
                  <Input
                    value={rateMechanism}
                    onChange={(event) => setRateMechanism(event.target.value)}
                    placeholder="Payout mechanism"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Minimum{" "}
                    <HelpTooltip label="Minimum exchange definition">
                      Smallest amount allowed in a single Exchange request.
                    </HelpTooltip>
                  </Label>
                  <Input
                    type="number"
                    min="1"
                    value={rateMin}
                    onChange={(event) => setRateMin(event.target.value)}
                    placeholder="Min"
                  />
                </div>
                <div>
                  <Label className="mb-1 flex items-center gap-1">
                    Maximum{" "}
                    <HelpTooltip label="Maximum exchange definition">
                      Largest amount allowed in a single Exchange request; leave blank for no
                      maximum.
                    </HelpTooltip>
                  </Label>
                  <Input
                    type="number"
                    min="1"
                    value={rateMax}
                    onChange={(event) => setRateMax(event.target.value)}
                    placeholder="No maximum"
                  />
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={rateCash}
                    onChange={(event) => setRateCash(event.target.checked)}
                    disabled={rateType === "R"}
                  />
                  Cash{" "}
                  <HelpTooltip label="Cash eligible definition">
                    Only P-credit can be cash eligible. R-credit exchange remains non-cash.
                  </HelpTooltip>
                </label>
              </div>
              <Button
                onClick={() =>
                  mutate.mutate({
                    path: "/admin/credits/exchange-rates",
                    body: {
                      creditType: rateType,
                      valueMinorPerCredit: Number(rateValue),
                      currency: rateCurrency,
                      payoutMechanism: rateMechanism,
                      cashEligible: rateType === "P" && rateCash,
                      minCredits: Number(rateMin),
                      ...(rateMax ? { maxCredits: Number(rateMax) } : {}),
                    },
                  })
                }
              >
                Publish rate version
              </Button>
              <div className="divide-y">
                {(rates.data ?? []).map((rate) => (
                  <div key={rate.id} className="flex justify-between py-2 text-sm">
                    <span>
                      {rate.creditType} v{rate.version} · {rate.valueMinorPerCredit} {rate.currency}
                    </span>
                    <span>{rate.payoutMechanism}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1">
              Credit ledger & recognition transactions{" "}
              <HelpTooltip label="Immutable ledger definition">
                Append-only record of every credit-affecting action. It captures wallet, amount,
                running balance, actor/counterparty and reason for auditability.
              </HelpTooltip>
            </CardTitle>
            <CardDescription>
              Filter by wallet/action; each row is immutable and linked to the member, counterparty
              and category.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <select
                className={fieldClass + " max-w-48"}
                value={ledgerCreditType}
                onChange={(event) => setLedgerCreditType(event.target.value)}
              >
                <option value="">All wallets</option>
                <option value="P">P-credit</option>
                <option value="R">R-credit</option>
              </select>
              <select
                className={fieldClass + " max-w-48"}
                value={ledgerType}
                onChange={(event) => setLedgerType(event.target.value)}
              >
                <option value="">All actions</option>
                <option value="GIVE_IN">GIVE_IN</option>
                <option value="GIVE_OUT">GIVE_OUT</option>
                <option value="ADJUSTMENT">ADJUSTMENT</option>
                <option value="REDEEM">REDEEM</option>
                <option value="EXCHANGE">EXCHANGE</option>
                <option value="EXPIRATION">EXPIRATION</option>
              </select>
              <select
                className={fieldClass + " max-w-48"}
                value={ledgerCategory}
                onChange={(event) => setLedgerCategory(event.target.value)}
              >
                <option value="">All categories</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <Input
                type="date"
                value={ledgerDateFrom}
                onChange={(event) => setLedgerDateFrom(event.target.value)}
              />
              <Input
                type="date"
                value={ledgerDateTo}
                onChange={(event) => setLedgerDateTo(event.target.value)}
              />
              <Input
                className="w-28"
                type="number"
                value={ledgerMin}
                onChange={(event) => setLedgerMin(event.target.value)}
                placeholder="Min"
              />
              <Input
                className="w-28"
                type="number"
                value={ledgerMax}
                onChange={(event) => setLedgerMax(event.target.value)}
                placeholder="Max"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Member</th>
                    <th className="py-2 pr-3">Action</th>
                    <th className="py-2 pr-3">Wallet</th>
                    <th className="py-2 text-right">Amount / balance</th>
                  </tr>
                </thead>
                <tbody>
                  {(ledger.data?.items ?? []).map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 text-xs">
                        {new Date(item.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3">
                        {[item.member?.firstName, item.member?.lastName]
                          .filter(Boolean)
                          .join(" ") ||
                          item.member?.email ||
                          item.memberId}
                        {item.member?.department ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            · {item.member.department}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        {item.type}
                        {item.categoryRef ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            · {item.categoryRef.name}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">{item.creditType}</td>
                      <td className="py-2 text-right">
                        <span className={item.amount >= 0 ? "text-green-600" : "text-red-600"}>
                          {item.amount > 0 ? "+" : ""}
                          {item.amount}
                        </span>{" "}
                        <span className="text-xs text-muted-foreground">→ {item.balanceAfter}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(ledger.data?.items ?? []).length === 0 && (
                <p className="py-4 text-sm text-muted-foreground">No ledger entries found.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1">
                Pending exchanges{" "}
                <HelpTooltip label="Pending exchange definition">
                  An Employee request has already reserved/debited the selected wallet. Admin moves
                  it through approval, fulfillment or cancellation; cancellation creates a
                  compensating ledger entry.
                </HelpTooltip>
              </CardTitle>
              <CardDescription>Approve, fulfill, or cancel with a recorded reason.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(requests.data?.items ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No pending exchange requests.</p>
              ) : (
                (requests.data?.items ?? []).map((request) => (
                  <div key={request.id} className="rounded-md border p-3 text-sm">
                    <div className="flex justify-between">
                      <span>
                        {request.member.email ?? request.member.id} · {request.amount}{" "}
                        {request.creditType}
                      </span>
                      <span>
                        {(request.valueMinor / 100).toFixed(2)} {request.currency}
                      </span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          mutate.mutate({
                            path: `/admin/credits/exchange-requests/${request.id}/approve`,
                            body: {},
                          })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          mutate.mutate({
                            path: `/admin/credits/exchange-requests/${request.id}/fulfill`,
                            body: {},
                          })
                        }
                      >
                        Fulfill
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          mutate.mutate({
                            path: `/admin/credits/exchange-requests/${request.id}/cancel`,
                            body: { reason: "Cancelled by administrator" },
                          })
                        }
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1">
                Bank cycles{" "}
                <HelpTooltip label="Bank cycle definition">
                  A rolling reconciliation window for the central Credit Bank. Clearing closes the
                  operational balance without deleting historical bank transactions.
                </HelpTooltip>
              </CardTitle>
              <CardDescription>
                Open and clear cycles for reconciliation without deleting ledger history.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                onClick={() => mutate.mutate({ path: "/admin/credits/bank/cycles/open", body: {} })}
              >
                Open current cycle
              </Button>
              {(cycles.data ?? []).slice(0, 5).map((cycle) => (
                <div
                  key={cycle.id}
                  className="flex items-center justify-between rounded-md border p-3 text-sm"
                >
                  <span>
                    {cycle.status} · {new Date(cycle.startsAt).toLocaleDateString()} · opening P/R{" "}
                    {cycle.openingP}/{cycle.openingR}
                  </span>
                  {cycle.status !== "CLEARED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        mutate.mutate({
                          path: `/admin/credits/bank/cycles/${cycle.id}/clear`,
                          body: { reason: "Scheduled cycle reconciliation" },
                        })
                      }
                    >
                      Clear
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Bulk employee import / seed{" "}
              <HelpTooltip label="Bulk import definition">
                Creates or updates employees and can seed P/R balances during onboarding. Each row
                gets a success/failure result and the batch is audited as one event.
              </HelpTooltip>
            </CardTitle>
            <CardDescription>
              CSV columns: email or externalId, firstName, lastName, phone, pCredit, rCredit,
              pExpiresAt. Every row receives a result and the batch is audited.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label className="flex items-center gap-1">
              CSV/XLSX file{" "}
              <HelpTooltip label="Import file definition">
                Upload a CSV or XLSX file using the documented columns. XLSX content is sent to the
                API as base64.
              </HelpTooltip>
            </Label>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.name.toLowerCase().endsWith(".xlsx")) {
                  const bytes = new Uint8Array(await file.arrayBuffer());
                  let binary = "";
                  bytes.forEach((byte) => {
                    binary += String.fromCharCode(byte);
                  });
                  setBulkCsv(btoa(binary));
                  setBulkFormat("xlsx");
                } else {
                  setBulkCsv(await file.text());
                  setBulkFormat("csv");
                }
              }}
            />
            <Label className="flex items-center gap-1">
              Preview / raw content{" "}
              <HelpTooltip label="Import content definition">
                Review or paste the selected content before importing. The API validates every row
                and returns a report.
              </HelpTooltip>
            </Label>
            <textarea
              className="min-h-32 w-full rounded-md border bg-background p-3 font-mono text-xs"
              value={bulkCsv}
              onChange={(event) => {
                setBulkCsv(event.target.value);
                setBulkFormat("csv");
              }}
            />
            <Button disabled={importBulk.isPending} onClick={() => importBulk.mutate()}>
              {importBulk.isPending ? "Importing…" : `Import ${bulkFormat.toUpperCase()}`}
            </Button>
            {bulkResult && (
              <div className="max-h-48 overflow-y-auto rounded-md border p-3 text-sm">
                <p className="mb-2 flex items-center gap-1 font-medium">
                  Per-row report{" "}
                  <HelpTooltip label="Per-row report definition">
                    Shows exactly which rows succeeded or failed so an operator can correct only the
                    failed input.
                  </HelpTooltip>
                </p>
                {(bulkResult.report ?? []).map((row) => (
                  <div
                    key={row.row}
                    className={row.status === "success" ? "text-green-700" : "text-red-700"}
                  >
                    Row {row.row}: {row.status}
                    {row.error ? ` — ${row.error}` : ""}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1">
              Audit export{" "}
              <HelpTooltip label="Audit export definition">
                Downloads the append-only admin audit trail. Corrections are new entries; previous
                entries are not edited or deleted.
              </HelpTooltip>
            </CardTitle>
            <CardDescription>
              Append-only credit actions, actor, reason and timestamp.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <a href="/api/v1/admin/credits/audit?format=csv&pageSize=100" download>
                <Download className="h-4 w-4" />
                Download CSV
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </HelpTooltipProvider>
  );
}
