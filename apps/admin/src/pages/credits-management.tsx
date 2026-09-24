import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Banknote,
  Download,
  History,
  Pencil,
  Upload,
  WalletCards,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";

interface PointType {
  id: string;
  code: string;
  name: string;
  unitLabel: string;
  color: string | null;
  isActive: boolean;
  archivedAt: string | null;
  bankEnabled: boolean;
  exchangeable: boolean;
  cashEligible: boolean;
  expiryMode: string;
}
interface Bank {
  pointTypeId: string;
  code: string;
  name: string;
  color: string | null;
  balance: number;
}
interface LedgerItem {
  id: string;
  memberId: string;
  pointTypeId: string;
  action: string;
  amount: number;
  balanceAfter: number;
  reason: string | null;
  message: string | null;
  actorType: string | null;
  actorId: string | null;
  createdAt: string;
  pointType: { code: string; name: string; unitLabel: string };
  member?: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  };
}
interface Page<T> {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
}
interface Rate {
  id: string;
  pointTypeId: string;
  version: number;
  valueMinorPerPoint: number;
  currency: string;
  payoutMechanism: string;
  payoutType: "CASH" | "NON_CASH";
  minPoints: number;
  maxPoints: number | null;
  periodLimitPoints: number | null;
  periodDays: number;
  isActive: boolean;
  pointType: { code: string; name: string; unitLabel: string };
  createdBy?: { id: string; name: string; email: string | null } | null;
}
interface ExchangeRequest {
  id: string;
  documentNumber: string;
  member: { id: string; email: string | null; firstName: string | null; lastName: string | null };
  pointType: { code: string; name: string; unitLabel: string };
  amount: number;
  valueMinor: number;
  currency: string;
  payoutMechanism: string;
  payoutType: string;
  status: "PENDING" | "APPROVED" | "COMPLETED" | "CANCELLED" | "REJECTED";
  requestedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  approvalNote: string | null;
  completedAt: string | null;
  completedBy: string | null;
  completionReference: string | null;
  completionNote: string | null;
  cancellationReason: string | null;
  exchangeRate: { version: number; valueMinorPerPoint: number };
}
interface Category {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdBy?: { id: string; name: string; email: string | null } | null;
}
interface Cycle {
  id: string;
  pointTypeId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  opening: number;
  allocated: number;
  closing: number;
  pointType: { code: string; name: string };
  createdBy?: { id: string; name: string; email: string | null } | null;
}
interface BankTransaction {
  id: string;
  pointTypeId: string;
  amount: number;
  balanceAfter: number;
  type: string;
  reason: string;
  actorId: string;
  cycleId: string | null;
  createdAt: string;
  pointType: { id: string; code: string; name: string; unitLabel: string };
  cycle: { id: string; startsAt: string; endsAt: string; status: string } | null;
}
type LedgerSource = "wallet" | "bank";
interface BulkBatch {
  id: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  status: string;
  report?: { row: number; status: string; error?: string }[];
}

export type CreditsSection = "wallets" | "banks" | "ledger" | "exchange" | "categories" | "import";

const BULK_REQUIRED_FIELDS = ["email", "externalId"] as const;
const BULK_OPTIONAL_MEMBER_FIELDS = [
  "memberId",
  "phone",
  "firstName",
  "lastName",
  "department",
  "photoUrl",
  "status",
  "username",
  "password",
] as const;
const LEGACY_BULK_HEADER = "email,firstName,lastName,status";

function buildBulkHeader(types: PointType[], selectedFields: string[] = [...BULK_REQUIRED_FIELDS]): string {
  return [
    ...selectedFields,
    ...types.flatMap((type) => {
      const point = `point_${type.code}`;
      const expiry = `expiry_${type.code}`;
      return selectedFields.includes(point) || selectedFields.includes(expiry) ? [point, expiry].filter((field) => selectedFields.includes(field)) : [];
    }),
  ].join(",");
}

function importFieldLabel(field: string, types: PointType[]): string {
  const [prefix, code] = field.split("_");
  const pointType = types.find((type) => type.code.toLowerCase() === code?.toLowerCase());
  if (prefix === "point" && pointType) return `${pointType.name} · ${ui("Point adjustment")}`;
  if (prefix === "balance" && pointType) return `${pointType.name} · ${ui("Target balance")}`;
  if (prefix === "expiry" && pointType) return `${pointType.name} · ${ui("Expiry date")}`;
  const labels: Record<string, string> = {
    memberId: "Member ID",
    email: "Email",
    externalId: "External ID",
    phone: "Phone",
    firstName: "First name",
    lastName: "Last name",
    department: "Department",
    photoUrl: "Photo URL",
    status: "Status",
    username: "Username",
    password: "Password",
  };
  return ui(labels[field] ?? field);
}

const SECTION_COPY: Record<CreditsSection, { title: string; description: string }> = {
  wallets: {
    title: "Member wallet adjustments",
    description:
      "Add or remove value from a member's selected point wallet with a mandatory audit reason.",
  },
  banks: {
    title: "Credit banks & cycles",
    description: "Fund governed issuance pools and manage their allocation windows.",
  },
  ledger: {
    title: "Credit ledger",
    description: "Search the immutable transaction stream across members and point types.",
  },
  exchange: {
    title: "Exchange rates & vouchers",
    description:
      "Configure rate versions and process accounting vouchers through their approval lifecycle.",
  },
  categories: {
    title: "Recognition categories",
    description: "Configure the optional reporting categories available to member recognition.",
  },
  import: {
    title: "Member & credit import",
    description:
      "Download a dynamic template and import members with values for any configured point type.",
  },
};

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

function requestKey(): string {
  return `${crypto.randomUUID()}-${Date.now().toString(36)}`;
}

function Field({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div>
      <Label htmlFor={id} data-help={help} className="mb-1.5 block">
        {label}
      </Label>
      {children}
    </div>
  );
}

function displayName(member: ExchangeRequest["member"] | LedgerItem["member"]): string {
  if (!member) return "Unknown member";
  const fullName = [member.firstName, member.lastName].filter(Boolean).join(" ");
  if (fullName) return fullName;
  return member.email ?? "Unknown member";
}

function isBankTransaction(item: LedgerItem | BankTransaction): item is BankTransaction {
  return "cycle" in item && "type" in item;
}

function actorLabel(item: LedgerItem | BankTransaction): string {
  if (isBankTransaction(item)) return item.actorId || "—";
  if (!item.actorId) return item.actorType ?? "—";
  return `${item.actorType ?? "—"}: ${item.actorId}`;
}

export function CreditsManagementPage({
  section = "wallets",
}: {
  section?: CreditsSection;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [bankTypeId, setBankTypeId] = useState("");
  const [bankAmount, setBankAmount] = useState("1000");
  const [bankReason, setBankReason] = useState("");
  const [adjustMemberId, setAdjustMemberId] = useState("");
  const [adjustTypeId, setAdjustTypeId] = useState("");
  const [adjustDirection, setAdjustDirection] = useState<"ADD" | "REMOVE">("ADD");
  const [adjustAmount, setAdjustAmount] = useState("100");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustExpiry, setAdjustExpiry] = useState("");
  const [ledgerTypeId, setLedgerTypeId] = useState("");
  const [ledgerMemberId, setLedgerMemberId] = useState("");
  const [ledgerAction, setLedgerAction] = useState("");
  const [ledgerSource, setLedgerSource] = useState<LedgerSource>("wallet");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [rateTypeId, setRateTypeId] = useState("");
  const [ratePayout, setRatePayout] = useState<"CASH" | "NON_CASH">("NON_CASH");
  const [rateValue, setRateValue] = useState("1");
  const [rateCurrency, setRateCurrency] = useState("USD");
  const [rateMechanism, setRateMechanism] = useState("Gift card");
  const [rateMin, setRateMin] = useState("1");
  const [rateMax, setRateMax] = useState("");
  const [ratePeriodLimit, setRatePeriodLimit] = useState("");
  const [ratePeriodDays, setRatePeriodDays] = useState("30");
  const [sourceRate, setSourceRate] = useState<Rate | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [cycleTypeId, setCycleTypeId] = useState("");
  const [cycleStart, setCycleStart] = useState("");
  const [cycleEnd, setCycleEnd] = useState("");
  const [cycleNote, setCycleNote] = useState("");
  const [bulkFormat, setBulkFormat] = useState<"csv" | "xlsx">("csv");
  const [bulkSelectedFields, setBulkSelectedFields] = useState<string[]>([...BULK_REQUIRED_FIELDS]);
  const [bulkContent, setBulkContent] = useState(`${buildBulkHeader([], [...BULK_REQUIRED_FIELDS])}\n`);
  const [bulkSourceName, setBulkSourceName] = useState("members.csv");
  const [bulkResult, setBulkResult] = useState<BulkBatch | null>(null);

  const pointTypes = useQuery({
    queryKey: ["point-types", "admin"],
    queryFn: () => fetchApi<PointType[]>("/admin/point-types"),
  });
  const activeTypes = useMemo(
    () => (pointTypes.data ?? []).filter((type) => type.isActive && !type.archivedAt),
    [pointTypes.data],
  );
  const importFieldOptions = useMemo(
    () => [
      ...BULK_REQUIRED_FIELDS.map((key) => ({ key, mandatory: true })),
      ...BULK_OPTIONAL_MEMBER_FIELDS.map((key) => ({ key, mandatory: false })),
      ...activeTypes.flatMap((type) => [
        { key: `point_${type.code}`, mandatory: false },
        { key: `balance_${type.code}`, mandatory: false },
        ...(type.expiryMode === "PER_GRANT" ? [{ key: `expiry_${type.code}`, mandatory: false }] : []),
      ]),
    ],
    [activeTypes],
  );
  const banks = useQuery({
    queryKey: ["credits", "banks"],
    queryFn: () => fetchApi<Bank[]>("/admin/credits/bank"),
    enabled: section === "banks",
  });
  const rates = useQuery({
    queryKey: ["credits", "admin-rates"],
    queryFn: () => fetchApi<Rate[]>("/admin/credits/exchange-rates"),
    enabled: section === "exchange",
  });
  const requests = useQuery({
    queryKey: ["credits", "exchange-requests"],
    queryFn: () =>
      fetchApi<Page<ExchangeRequest>>("/admin/credits/exchange-requests?page=1&pageSize=50"),
    enabled: section === "exchange",
  });
  const categories = useQuery({
    queryKey: ["credits", "admin-categories"],
    queryFn: () => fetchApi<Category[]>("/admin/credits/categories"),
    enabled: section === "categories",
  });
  const cycles = useQuery({
    queryKey: ["credits", "bank-cycles"],
    queryFn: () => fetchApi<Cycle[]>("/admin/credits/bank/cycles"),
    enabled: section === "banks",
  });
  const ledger = useQuery<Page<LedgerItem | BankTransaction>>({
    queryKey: [
      "credits",
      "ledger",
      ledgerSource,
      ledgerPage,
      ledgerTypeId,
      ledgerMemberId,
      ledgerAction,
    ],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(ledgerPage), pageSize: "25" });
      if (ledgerTypeId) params.set("pointTypeId", ledgerTypeId);
      if (ledgerSource === "bank") {
        if (ledgerAction) params.set("type", ledgerAction);
        return fetchApi<Page<BankTransaction>>(
          `/admin/credits/bank/transactions?${params.toString()}`,
        );
      }
      if (ledgerMemberId) params.set("memberId", ledgerMemberId);
      if (ledgerAction) params.set("action", ledgerAction);
      return fetchApi<Page<LedgerItem>>(`/admin/credits/transactions?${params.toString()}`);
    },
    enabled: section === "ledger",
  });

  useEffect(() => {
    const first = activeTypes[0]?.id ?? "";
    const firstBank = activeTypes.find((type) => type.bankEnabled)?.id ?? "";
    const firstExchange = activeTypes.find((type) => type.exchangeable)?.id ?? "";
    if (!bankTypeId) setBankTypeId(firstBank);
    if (!adjustTypeId) setAdjustTypeId(first);
    if (!rateTypeId) setRateTypeId(firstExchange);
    if (!cycleTypeId) setCycleTypeId(firstBank);
  }, [activeTypes, adjustTypeId, bankTypeId, cycleTypeId, rateTypeId]);

  useEffect(() => {
    const currentHeader = bulkContent.split(/\r?\n/, 1)[0] ?? "";
    if (currentHeader !== LEGACY_BULK_HEADER) return;
    setBulkSelectedFields([...BULK_REQUIRED_FIELDS]);
    setBulkContent(`${buildBulkHeader(activeTypes, [...BULK_REQUIRED_FIELDS])}\n`);
  }, [activeTypes, bulkContent]);

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["credits"] }),
      queryClient.invalidateQueries({ queryKey: ["members"] }),
    ]);
  };

  const issueBank = useMutation({
    mutationFn: () =>
      fetchApi("/admin/credits/bank/issue", {
        method: "POST",
        headers: { "Idempotency-Key": requestKey() },
        body: JSON.stringify({
          pointTypeId: bankTypeId,
          amount: Number(bankAmount),
          reason: bankReason,
        }),
      }),
    onSuccess: async () => {
      setNotice(ui("Bank funded."));
      setBankReason("");
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });
  const adjust = useMutation({
    mutationFn: () =>
      fetchApi("/admin/credits/adjust", {
        method: "POST",
        headers: { "Idempotency-Key": requestKey() },
        body: JSON.stringify({
          memberId: adjustMemberId,
          pointTypeId: adjustTypeId,
          amount:
            adjustDirection === "REMOVE"
              ? -Math.abs(Number(adjustAmount))
              : Math.abs(Number(adjustAmount)),
          reason: adjustReason,
          ...(adjustExpiry
            ? { expiresAt: new Date(`${adjustExpiry}T23:59:59.999Z`).toISOString() }
            : {}),
        }),
      }),
    onSuccess: async () => {
      setNotice(
        adjustDirection === "REMOVE"
          ? ui("Points removed and returned to the admin bank.")
          : ui("Member wallet adjusted."),
      );
      setAdjustReason("");
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });
  const createRate = useMutation({
    mutationFn: () =>
      fetchApi("/admin/credits/exchange-rates", {
        method: "POST",
        body: JSON.stringify({
          pointTypeId: rateTypeId,
          valueMinorPerPoint: Math.round(Number(rateValue) * 100),
          currency: rateCurrency,
          payoutMechanism: rateMechanism,
          payoutType: ratePayout,
          minPoints: Number(rateMin),
          ...(rateMax ? { maxPoints: Number(rateMax) } : {}),
          ...(ratePeriodLimit ? { periodLimitPoints: Number(ratePeriodLimit) } : {}),
          periodDays: Number(ratePeriodDays),
        }),
      }),
    onSuccess: async () => {
      setNotice(ui("New exchange-rate version activated."));
      setSourceRate(null);
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const editRateAsNewVersion = (rate: Rate): void => {
    setSourceRate(rate);
    setRateTypeId(rate.pointTypeId);
    setRatePayout(rate.payoutType);
    setRateValue(String(rate.valueMinorPerPoint / 100));
    setRateCurrency(rate.currency);
    setRateMechanism(rate.payoutMechanism);
    setRateMin(String(rate.minPoints));
    setRateMax(rate.maxPoints == null ? "" : String(rate.maxPoints));
    setRatePeriodLimit(
      rate.periodLimitPoints == null ? "" : String(rate.periodLimitPoints),
    );
    setRatePeriodDays(String(rate.periodDays));
    setNotice(
      `${ui("Version")} ${String(rate.version)} ${ui("loaded. Saving will create a new version and preserve voucher history.")}`,
    );
  };
  const transitionExchange = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "complete" | "cancel" }) => {
      const reason = action === "cancel" ? window.prompt(ui("Cancellation reason")) : null;
      if (action === "cancel" && !reason?.trim())
        throw new Error(ui("A cancellation reason is required."));
      const approvalNote = action === "approve" ? window.prompt(ui("Approval note (optional)")) : null;
      const reference =
        action === "complete" ? window.prompt(ui("Accounting or payment reference (required)")) : null;
      if (action === "complete" && !reference?.trim())
        throw new Error(ui("An accounting or payment reference is required."));
      const completionNote =
        action === "complete" ? window.prompt(ui("Completion note (optional)")) : null;
      const approvalNoteValue = approvalNote?.trim();
      const completionNoteValue = completionNote?.trim();
      return fetchApi(`/admin/credits/exchange-requests/${id}/${action}`, {
        method: "POST",
        ...(action === "cancel"
          ? { body: JSON.stringify({ status: "CANCELLED", reason }) }
          : action === "approve"
            ? {
                body: JSON.stringify({
                  note: approvalNoteValue === "" ? undefined : approvalNoteValue,
                }),
              }
            : {
                body: JSON.stringify({
                  reference,
                  note: completionNoteValue === "" ? undefined : completionNoteValue,
                }),
              }),
      });
    },
    onSuccess: async () => {
      setNotice(ui("Exchange request updated."));
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });
  const createCategory = useMutation({
    mutationFn: () =>
      fetchApi("/admin/credits/categories", {
        method: "POST",
        body: JSON.stringify({ name: categoryName, description: categoryDescription || undefined }),
      }),
    onSuccess: async () => {
      setCategoryName("");
      setCategoryDescription("");
      setNotice(ui("Category created."));
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });
  const updateCategory = useMutation({
    mutationFn: ({ category, remove }: { category: Category; remove?: boolean }) =>
      fetchApi(`/admin/credits/categories/${category.id}`, {
        method: remove ? "DELETE" : "PATCH",
        ...(remove ? {} : { body: JSON.stringify({ isActive: !category.isActive }) }),
      }),
    onSuccess: async () => {
      setNotice(ui("Category updated."));
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });
  const openCycle = useMutation({
    mutationFn: () =>
      fetchApi("/admin/credits/bank/cycles/open", {
        method: "POST",
        body: JSON.stringify({
          pointTypeId: cycleTypeId,
          ...(cycleStart
            ? { startsAt: new Date(`${cycleStart}T00:00:00.000Z`).toISOString() }
            : {}),
          ...(cycleEnd ? { endsAt: new Date(`${cycleEnd}T23:59:59.999Z`).toISOString() } : {}),
          ...(cycleNote ? { note: cycleNote } : {}),
        }),
      }),
    onSuccess: async () => {
      setNotice(ui("Bank cycle opened."));
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });
  const clearCycle = useMutation({
    mutationFn: (id: string) => {
      const reason = window.prompt(ui("Reason for closing this bank cycle"));
      if (!reason) throw new Error(ui("A reason is required."));
      return fetchApi(`/admin/credits/bank/cycles/${id}/clear`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },
    onSuccess: async () => {
      setNotice(ui("Cycle closed; unused bank value was retained."));
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });
  const bulkImport = useMutation({
    mutationFn: () =>
      fetchApi<BulkBatch>("/admin/members/bulk", {
        method: "POST",
        body: JSON.stringify({
          format: bulkFormat,
          content: bulkContent,
          selectedFields: bulkSelectedFields,
          sourceName: bulkSourceName,
        }),
      }),
    onSuccess: async (result) => {
      setBulkResult(result);
      setNotice(
        `${ui("Bulk import")} ${result.status.toLowerCase()}: ${String(result.successRows)} ${ui("succeeded")}, ${String(result.failedRows)} ${ui("failed")}.`,
      );
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const readBulkFile = (file: File): void => {
    setBulkSourceName(file.name);
    const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
    setBulkFormat(isXlsx ? "xlsx" : "csv");
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const content = isXlsx ? (result.split(",")[1] ?? "") : result;
      setBulkContent(content);
      if (!isXlsx) {
        const headers = content
          .split(/\r?\n/)
          .map((line) => line.split(",").map((value) => value.trim()))
          .find((line) => line.some((value) => value === "email" || value === "externalId" || value === "memberId"));
        if (headers?.length) {
          const known = new Set(importFieldOptions.map((option) => option.key));
          setBulkSelectedFields([
            ...BULK_REQUIRED_FIELDS,
            ...headers.filter((header) => known.has(header) && !BULK_REQUIRED_FIELDS.includes(header as (typeof BULK_REQUIRED_FIELDS)[number])),
          ]);
        }
      }
    };
    if (isXlsx) reader.readAsDataURL(file);
    else reader.readAsText(file);
  };

  const downloadImportTemplate = (): void => {
    const header = buildBulkHeader(activeTypes, bulkSelectedFields);
    const example = header
      .split(",")
      .map((column) => {
        if (column === "email") return "sample.member@example.com";
        if (column === "externalId") return "external-001";
        if (column === "phone") return "+84123456789";
        if (column === "firstName") return "Sample";
        if (column === "lastName") return "Member";
        if (column === "department") return "Sales";
        if (column === "photoUrl") return "https://example.com/avatar.jpg";
        if (column === "status") return "ACTIVE";
        if (column === "username") return "sample.member";
        if (column === "password") return "";
        if (column.startsWith("point_")) return "";
        if (column.startsWith("expiry_")) return "";
        return "";
      })
      .join(",");
    const url = URL.createObjectURL(
      new Blob([`${header}\n${example}\n`], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "loyaltyos-member-credit-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <WalletCards /> {ui(SECTION_COPY[section].title)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{ui(SECTION_COPY[section].description)}</p>
      </div>
      {notice && (
        <div role="status" className="rounded-md border bg-muted p-3 text-sm">
          {notice}
        </div>
      )}

      {(section === "banks" || section === "wallets") && (
        <div className="grid gap-6">
          {section === "banks" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Banknote />{ui("Credit bank")}</CardTitle>
                <CardDescription>{ui("Fund governed issuance pools. Each point type has an independent bank.")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {(banks.data ?? []).map((bank) => (
                    <div
                      key={bank.pointTypeId}
                      className="rounded-md border p-3"
                      style={{ borderTopColor: bank.color ?? undefined, borderTopWidth: 3 }}
                    >
                      <p className="text-sm text-muted-foreground">{bank.name}</p>
                      <p className="text-2xl font-bold">{bank.balance.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    id="bank-type"
                    label={ui("Point type")}
                    help={ui("Only point types with bank governance enabled appear here.")}
                  >
                    <select
                      id="bank-type"
                      className={selectClass}
                      value={bankTypeId}
                      onChange={(event) => {
                        setBankTypeId(event.target.value);
                      }}
                    >
                      {activeTypes
                        .filter((type) => type.bankEnabled)
                        .map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field
                    id="bank-amount"
                    label={ui("Funding amount")}
                    help={ui("Positive amount added to the selected central bank.")}
                  >
                    <Input
                      id="bank-amount"
                      type="number"
                      min="1"
                      value={bankAmount}
                      onChange={(event) => {
                        setBankAmount(event.target.value);
                      }}
                    />
                  </Field>
                  <Field
                    id="bank-reason"
                    label={ui("Funding reason")}
                    help={ui("Mandatory audit reason for creating bank value.")}
                  >
                    <Input
                      id="bank-reason"
                      value={bankReason}
                      onChange={(event) => {
                        setBankReason(event.target.value);
                      }}
                    />
                  </Field>
                  <Button
                    className="self-end"
                    disabled={!bankTypeId || !bankReason || issueBank.isPending}
                    onClick={() => {
                      issueBank.mutate();
                    }}
                  >{ui("Fund bank")}</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {section === "wallets" && (
            <Card>
              <CardHeader>
                <CardTitle>{ui("Member adjustment")}</CardTitle>
                <CardDescription>{ui("Add or remove value. Positive adjustments consume bank funds; removed points return to the admin bank.")}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Field
                  id="adjust-member"
                  label={ui("Member ID")}
                  help={ui("Exact member whose wallet will be adjusted.")}
                >
                  <Input
                    id="adjust-member"
                    value={adjustMemberId}
                    onChange={(event) => {
                      setAdjustMemberId(event.target.value);
                    }}
                  />
                  <Link
                    to="/members"
                    className="mt-1 inline-block text-xs font-medium text-primary hover:underline"
                  >{ui("Find and copy a Member ID")}</Link>
                </Field>
                <Field id="adjust-type" label={ui("Point type")} help={ui("Configured wallet to adjust.")}>
                  <select
                    id="adjust-type"
                    className={selectClass}
                    value={adjustTypeId}
                    onChange={(event) => {
                      setAdjustTypeId(event.target.value);
                    }}
                  >
                    {activeTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  id="adjust-direction"
                  label={ui("Adjustment direction")}
                  help={ui("Choose whether to add points to the member or remove them and return them to the admin bank.")}
                >
                  <select
                    id="adjust-direction"
                    className={selectClass}
                    value={adjustDirection}
                    onChange={(event) => {
                      setAdjustDirection(event.target.value as "ADD" | "REMOVE");
                    }}
                  >
                    <option value="ADD">{ui("Add points to member")}</option>
                    <option value="REMOVE">{ui("Remove points and return to bank")}</option>
                  </select>
                </Field>
                <Field
                  id="adjust-amount"
                  label={ui("Amount")}
                  help={ui("Enter a positive amount. The selected direction controls whether it is added or removed.")}
                >
                  <Input
                    id="adjust-amount"
                    type="number"
                    min="1"
                    step="1"
                    value={adjustAmount}
                    onChange={(event) => {
                      setAdjustAmount(event.target.value);
                    }}
                  />
                </Field>
                <Field
                  id="adjust-expiry"
                  label={ui("Grant expiry override")}
                  help={ui("Optional explicit expiry, especially for Per grant point types.")}
                >
                  <Input
                    id="adjust-expiry"
                    type="date"
                    value={adjustExpiry}
                    onChange={(event) => {
                      setAdjustExpiry(event.target.value);
                    }}
                  />
                </Field>
                <Field
                  id="adjust-reason"
                  label={ui("Adjustment reason")}
                  help={ui("Mandatory business reason retained in ledger and audit log.")}
                >
                  <Input
                    id="adjust-reason"
                    value={adjustReason}
                    onChange={(event) => {
                      setAdjustReason(event.target.value);
                    }}
                  />
                </Field>
                <Button
                  className="self-end sm:col-span-2"
                  disabled={
                    !adjustMemberId ||
                    !adjustTypeId ||
                    !adjustReason ||
                    Number(adjustAmount) <= 0 ||
                    adjust.isPending
                  }
                  onClick={() => {
                    adjust.mutate();
                  }}
                >{ui("Apply adjustment")}</Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {section === "ledger" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History />{ui("Unified ledger")}</CardTitle>
            <CardDescription>{ui("Filter the immutable signed transaction stream across all point types.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-5">
              <Field
                id="ledger-source"
                label={ui("Ledger type")}
                help={ui("Choose member wallet entries or bank funding transactions.")}
              >
                <select
                  id="ledger-source"
                  className={selectClass}
                  value={ledgerSource}
                  onChange={(event) => {
                    setLedgerSource(event.target.value as LedgerSource);
                    setLedgerPage(1);
                  }}
                >
                  <option value="wallet">{ui("Member wallet")}</option>
                  <option value="bank">{ui("Bank funding")}</option>
                </select>
              </Field>
              <Field id="ledger-type" label={ui("Point type")} help={ui("Limit results to one wallet type.")}>
                <select
                  id="ledger-type"
                  className={selectClass}
                  value={ledgerTypeId}
                  onChange={(event) => {
                    setLedgerTypeId(event.target.value);
                    setLedgerPage(1);
                  }}
                >
                  <option value="">{ui("All types")}</option>
                  {activeTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </Field>
              {ledgerSource === "wallet" && (
                <Field id="ledger-member" label={ui("Member ID")} help={ui("Limit results to one member.")}>
                  <Input
                    id="ledger-member"
                    value={ledgerMemberId}
                    onChange={(event) => {
                      setLedgerMemberId(event.target.value);
                      setLedgerPage(1);
                    }}
                  />
                </Field>
              )}
              <Field
                id="ledger-action"
                label={ledgerSource === "bank" ? ui("Transaction type") : ui("Action")}
                help={
                  ledgerSource === "bank"
                    ? ui("Exact bank transaction type such as ISSUANCE, ALLOCATION or RETURN.")
                    : ui("Exact ledger action such as EARN, GIVE_IN, REDEEM or EXPIRY.")
                }
              >
                <Input
                  id="ledger-action"
                  value={ledgerAction}
                  onChange={(event) => {
                    setLedgerAction(event.target.value.toUpperCase());
                    setLedgerPage(1);
                  }}
                />
              </Field>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2">{ui("Date")}</th>
                    <th className="p-2">{ui("Actor")}</th>
                    <th className="p-2">{ui("Action type")}</th>
                    <th className="p-2">{ui("Target employee")}</th>
                    <th className="p-2">{ui("Target employee email")}</th>
                    <th className="p-2">{ui("Type")}</th>
                    <th className="p-2 text-right">{ui("Amount")}</th>
                    <th className="p-2 text-right">{ui("Balance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(ledger.data?.items ?? []).map((item) => (
                    <tr key={item.id} className="border-b">
                      <td className="p-2 text-xs">{new Date(item.createdAt).toLocaleString()}</td>
                      <td className="p-2">
                        {actorLabel(item)}
                      </td>
                      <td className="p-2">
                        {isBankTransaction(item) ? item.type : item.action}
                      </td>
                      <td className="p-2">
                        {isBankTransaction(item) ? ui("Bank") : displayName(item.member)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {isBankTransaction(item) ? item.reason : item.reason ?? item.message}
                        </span>
                      </td>
                      <td className="p-2 text-sm text-muted-foreground">
                        {isBankTransaction(item) ? "—" : item.member?.email ?? "—"}
                      </td>
                      <td className="p-2">{item.pointType.code}</td>
                      <td
                        className={`p-2 text-right font-semibold ${item.amount >= 0 ? "text-green-600" : "text-red-600"}`}
                      >
                        {item.amount > 0 ? "+" : ""}
                        {item.amount.toLocaleString()}
                      </td>
                      <td className="p-2 text-right">{item.balanceAfter.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={ledgerPage <= 1}
                onClick={() => {
                  setLedgerPage((page) => page - 1);
                }}
              >{ui("Previous")}</Button>
              <Button
                size="sm"
                variant="outline"
                disabled={ledgerPage >= (ledger.data?.totalPages ?? 1)}
                onClick={() => {
                  setLedgerPage((page) => page + 1);
                }}
              >{ui("Next")}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {section === "exchange" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowRightLeft />{ui("Exchange rates")}</CardTitle>
              <CardDescription>
                {ui("Saving creates a version and deactivates only the prior rate for the same payout type.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sourceRate && (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                  {ui("Editing from")} {sourceRate.pointType.name} · {sourceRate.payoutType} · v
                  {sourceRate.version}. {ui("The original version remains unchanged for accounting history.")}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  id="rate-type"
                  label={ui("Point type")}
                  help={ui("Exchange-enabled point type for this rate.")}
                >
                  <select
                    id="rate-type"
                    className={selectClass}
                    value={rateTypeId}
                    onChange={(event) => {
                      const id = event.target.value;
                      setRateTypeId(id);
                      if (!activeTypes.find((type) => type.id === id)?.cashEligible)
                        setRatePayout("NON_CASH");
                    }}
                  >
                    {activeTypes
                      .filter((type) => type.exchangeable)
                      .map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field
                  id="rate-payout"
                  label={ui("Payout type")}
                  help={ui("Cash is available only when the selected type permits cash exchange.")}
                >
                  <select
                    id="rate-payout"
                    className={selectClass}
                    value={ratePayout}
                    onChange={(event) => {
                      setRatePayout(event.target.value as "CASH" | "NON_CASH");
                    }}
                  >
                    <option value="NON_CASH">{ui("Non-cash")}</option>
                    <option
                      value="CASH"
                      disabled={!activeTypes.find((type) => type.id === rateTypeId)?.cashEligible}
                    >{ui("Cash")}</option>
                  </select>
                </Field>
                <Field
                  id="rate-value"
                  label={ui("Currency value per point")}
                  help={ui("Enter the normal currency amount; 1 means 1.00 per point.")}
                >
                  <Input
                    id="rate-value"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={rateValue}
                    onChange={(event) => {
                      setRateValue(event.target.value);
                    }}
                  />
                </Field>
                <Field id="rate-currency" label={ui("Currency")} help={ui("Three-letter ISO currency code.")}>
                  <Input
                    id="rate-currency"
                    maxLength={3}
                    value={rateCurrency}
                    onChange={(event) => {
                      setRateCurrency(event.target.value.toUpperCase());
                    }}
                  />
                </Field>
                <Field
                  id="rate-mechanism"
                  label={ui("Payout mechanism")}
                  help={ui("Operational method such as payroll, gift card or bank transfer.")}
                >
                  <Input
                    id="rate-mechanism"
                    value={rateMechanism}
                    onChange={(event) => {
                      setRateMechanism(event.target.value);
                    }}
                  />
                </Field>
                <Field
                  id="rate-min"
                  label={ui("Minimum points")}
                  help={ui("Smallest accepted exchange request.")}
                >
                  <Input
                    id="rate-min"
                    type="number"
                    min="1"
                    value={rateMin}
                    onChange={(event) => {
                      setRateMin(event.target.value);
                    }}
                  />
                </Field>
                <Field
                  id="rate-max"
                  label={ui("Maximum points")}
                  help={ui("Optional maximum for one request.")}
                >
                  <Input
                    id="rate-max"
                    type="number"
                    min="1"
                    value={rateMax}
                    onChange={(event) => {
                      setRateMax(event.target.value);
                    }}
                  />
                </Field>
                <Field
                  id="rate-period-limit"
                  label={ui("Period limit")}
                  help={ui("Optional cumulative member limit during the rolling period.")}
                >
                  <Input
                    id="rate-period-limit"
                    type="number"
                    min="1"
                    value={ratePeriodLimit}
                    onChange={(event) => {
                      setRatePeriodLimit(event.target.value);
                    }}
                  />
                </Field>
                <Field
                  id="rate-period-days"
                  label={ui("Period days")}
                  help={ui("Rolling window used by the cumulative exchange limit.")}
                >
                  <Input
                    id="rate-period-days"
                    type="number"
                    min="1"
                    value={ratePeriodDays}
                    onChange={(event) => {
                      setRatePeriodDays(event.target.value);
                    }}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    !rateTypeId ||
                    !rateMechanism ||
                    !Number.isFinite(Number(rateValue)) ||
                    Number(rateValue) < 0.01 ||
                    createRate.isPending
                  }
                  onClick={() => {
                    createRate.mutate();
                  }}
                >
                  {sourceRate ? ui("Save as new rate version") : ui("Activate new rate version")}
                </Button>
                {sourceRate && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSourceRate(null);
                    }}
                  >{ui("Cancel editing")}</Button>
                )}
              </div>
              <div className="space-y-2">
                {(rates.data ?? []).map((rate) => (
                  <div
                    key={rate.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm ${rate.isActive ? "" : "bg-muted/40 text-muted-foreground"}`}
                  >
                    <div>
                      <span>
                        {rate.pointType.name} · {rate.payoutType} · v{rate.version}
                      </span>
                      <span className="ml-2 rounded-full border px-2 py-0.5 text-xs">
                        {rate.isActive ? ui("Active") : "Historical"}
                      </span>
                      <p className="mt-1 text-xs">
                        {(rate.valueMinorPerPoint / 100).toFixed(2)} {rate.currency} / {rate.pointType.unitLabel} · {rate.payoutMechanism}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{ui("Created by")}: {rate.createdBy ? `${rate.createdBy.name}${rate.createdBy.email ? ` · ${rate.createdBy.email}` : ""}` : ui("System / legacy")}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        editRateAsNewVersion(rate);
                      }}
                    >
                      <Pencil className="h-4 w-4" />{ui("Edit as new version")}</Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{ui("Accounting exchange vouchers")}</CardTitle>
              <CardDescription>
                {ui("Stored accounting documents with strict transitions: Pending → Approved → Completed. Cancellation before completion automatically refunds the member wallet.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(requests.data?.items ?? []).map((item) => (
                <div key={item.id} className="rounded-md border p-3 text-sm">
                  <div className="flex justify-between">
                    <div>
                      <strong>{item.documentNumber}</strong>
                      <p className="text-muted-foreground">{displayName(item.member)}</p>
                    </div>
                    <span>{item.status}</span>
                  </div>
                  <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
                    <p>
                      {ui("Debit:")} {item.amount.toLocaleString()} {item.pointType.unitLabel}
                    </p>
                    <p>
                      {ui("Document value:")} {(item.valueMinor / 100).toLocaleString()} {item.currency}
                    </p>
                    <p>
                      {ui("Rate snapshot:")} v{item.exchangeRate.version} ·{" "}
                      {(item.exchangeRate.valueMinorPerPoint / 100).toFixed(2)} {item.currency}/
                      {item.pointType.unitLabel}
                    </p>
                    <p>
                      {ui("Method:")} {item.payoutType} · {item.payoutMechanism}
                    </p>
                    <p>{ui("Requested:")} {new Date(item.requestedAt).toLocaleString()}</p>
                    {item.approvedAt && (
                      <p>
                        {ui("Approved:")} {new Date(item.approvedAt).toLocaleString()} · {item.approvedBy}
                      </p>
                    )}
                    {item.completedAt && (
                      <p>
                        {ui("Completed:")} {new Date(item.completedAt).toLocaleString()} ·{" "}
                        {item.completedBy}
                      </p>
                    )}
                    {item.completionReference && <p>{ui("Reference:")} {item.completionReference}</p>}
                  </div>
                  {item.approvalNote && <p className="mt-2">{ui("Approval note:")} {item.approvalNote}</p>}
                  {item.completionNote && (
                    <p className="mt-2">{ui("Completion note:")} {item.completionNote}</p>
                  )}
                  {item.cancellationReason && (
                    <p className="mt-2 text-destructive">{ui("Cancellation:")} {item.cancellationReason}</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    {item.status === "PENDING" && (
                      <Button
                        size="sm"
                        onClick={() => {
                          transitionExchange.mutate({ id: item.id, action: "approve" });
                        }}
                      >{ui("Approve")}</Button>
                    )}
                    {item.status === "APPROVED" && (
                      <Button
                        size="sm"
                        onClick={() => {
                          transitionExchange.mutate({ id: item.id, action: "complete" });
                        }}
                      >{ui("Mark completed")}</Button>
                    )}
                    {["PENDING", "APPROVED"].includes(item.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          transitionExchange.mutate({ id: item.id, action: "cancel" });
                        }}
                      >{ui("Cancel & refund")}</Button>
                    )}
                  </div>
                </div>
              ))}
              {(requests.data?.items ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">{ui("No exchange requests.")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {(section === "banks" || section === "categories") && (
        <div className="grid gap-6">
          {section === "banks" && (
            <Card>
              <CardHeader>
                <CardTitle>{ui("Bank cycles")}</CardTitle>
                <CardDescription>{ui("Track allocation windows without deleting unused bank value when a cycle closes.")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    id="cycle-type"
                    label={ui("Point type")}
                    help={ui("Bank-governed point type tracked by this cycle.")}
                  >
                    <select
                      id="cycle-type"
                      className={selectClass}
                      value={cycleTypeId}
                      onChange={(event) => {
                        setCycleTypeId(event.target.value);
                      }}
                    >
                      {activeTypes
                        .filter((type) => type.bankEnabled)
                        .map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field
                    id="cycle-start"
                    label={ui("Starts at")}
                    help={ui("Optional cycle start; defaults to now.")}
                  >
                    <Input
                      id="cycle-start"
                      type="date"
                      value={cycleStart}
                      onChange={(event) => {
                        setCycleStart(event.target.value);
                      }}
                    />
                  </Field>
                  <Field
                    id="cycle-end"
                    label={ui("Ends at")}
                    help={ui("Optional cycle end; defaults to the point type allowance-cycle duration.")}
                  >
                    <Input
                      id="cycle-end"
                      type="date"
                      value={cycleEnd}
                      onChange={(event) => {
                        setCycleEnd(event.target.value);
                      }}
                    />
                  </Field>
                  <Field
                    id="cycle-note"
                    label={ui("Cycle note")}
                    help={ui("Optional operational context for the allocation window.")}
                  >
                    <Input
                      id="cycle-note"
                      value={cycleNote}
                      onChange={(event) => {
                        setCycleNote(event.target.value);
                      }}
                    />
                  </Field>
                </div>
                <Button
                  disabled={!cycleTypeId || openCycle.isPending}
                  onClick={() => {
                    openCycle.mutate();
                  }}
                >{ui("Open cycle")}</Button>
                <div className="space-y-2">
                  {(cycles.data ?? []).map((cycle) => (
                    <div
                      key={cycle.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                    >
                      <span>
                        {cycle.pointType.name} · {new Date(cycle.startsAt).toLocaleDateString()}–
                        {new Date(cycle.endsAt).toLocaleDateString()} · {cycle.status}
                      </span>
                      <span className="text-xs text-muted-foreground">{ui("Created by")}: {cycle.createdBy ? `${cycle.createdBy.name}${cycle.createdBy.email ? ` · ${cycle.createdBy.email}` : ""}` : ui("System / legacy")}</span>
                      <span>
                        Opening {cycle.opening.toLocaleString()} · allocated{" "}
                        {cycle.allocated.toLocaleString()} · closing{" "}
                        {cycle.closing.toLocaleString()}
                      </span>
                      {cycle.status === "OPEN" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            clearCycle.mutate(cycle.id);
                          }}
                        >{ui("Close cycle")}</Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {section === "categories" && (
            <Card>
              <CardHeader>
                <CardTitle>{ui("Recognition categories")}</CardTitle>
                <CardDescription>
                  {ui("Used for member recognition and reporting. Used categories are archived rather than deleted.")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    id="category-name"
                    label={ui("Category name")}
                    help={ui("Short label displayed in the Portal Give form.")}
                  >
                    <Input
                      id="category-name"
                      value={categoryName}
                      onChange={(event) => {
                        setCategoryName(event.target.value);
                      }}
                    />
                  </Field>
                  <Field
                    id="category-description"
                    label={ui("Category description")}
                    help={ui("Explains when members should use this category.")}
                  >
                    <Input
                      id="category-description"
                      value={categoryDescription}
                      onChange={(event) => {
                        setCategoryDescription(event.target.value);
                      }}
                    />
                  </Field>
                </div>
                <Button
                  disabled={!categoryName || createCategory.isPending}
                  onClick={() => {
                    createCategory.mutate();
                  }}
                >{ui("Create category")}</Button>
                <div className="space-y-2">
                  {(categories.data ?? []).map((category) => (
                    <div
                      key={category.id}
                      className={`flex items-center justify-between rounded-md border p-3 text-sm ${category.isActive ? "" : "opacity-50"}`}
                    >
                      <span>
                        <strong>{category.name}</strong>
                        <span className="ml-2 text-muted-foreground">{category.description}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{ui("Created by")}: {category.createdBy ? `${category.createdBy.name}${category.createdBy.email ? ` · ${category.createdBy.email}` : ""}` : ui("System / legacy")}</span>
                      </span>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            updateCategory.mutate({ category });
                          }}
                        >
                          {category.isActive ? ui("Deactivate") : ui("Activate")}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            updateCategory.mutate({ category, remove: true });
                          }}
                        >{ui("Delete")}</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {section === "import" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload />{ui("Dynamic member import")}</CardTitle>
            <CardDescription>
              {ui("Use point_CODE and optional expiry_CODE columns for any configured type. Omitting status preserves an existing member’s state.")}
            </CardDescription>
            <p className="text-xs text-muted-foreground">
              {ui("The importer detects the column header automatically, including files with a title row above it. The header row is not counted as a member row.")}
            </p>
            <p className="text-xs text-muted-foreground">
              {ui("Export selected members from Members to edit profile fields and re-import using memberId.")}
            </p>
            <p className="text-xs text-muted-foreground">
              {ui("Exported balance_CODE columns are target balances. Import applies only the difference and enforces each point type's settings.")}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              id="bulk-file"
              label={ui("CSV or XLSX file")}
              help={ui("CSV is read as text; XLSX is transmitted as base64 and parsed server-side.")}
            >
              <Input
                id="bulk-file"
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) readBulkFile(file);
                }}
              />
            </Field>
            <div className="space-y-3 rounded-md border p-4">
              <div>
                <p className="font-medium">{ui("Fields to import")}</p>
                <p className="text-xs text-muted-foreground">{ui("Email or External ID is required for a new member. Member ID can be used to update an existing member.")}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {importFieldOptions.map((option) => {
                  const checked = bulkSelectedFields.includes(option.key);
                  return (
                    <label key={option.key} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={option.mandatory}
                        onChange={(event) => {
                          const selected = event.target.checked;
                          setBulkSelectedFields((current) => {
                            if (selected) {
                              const prefix = option.key.startsWith("point_") ? "point_" : option.key.startsWith("balance_") ? "balance_" : "";
                              const code = prefix ? option.key.slice(prefix.length) : "";
                              const counterpart = prefix === "point_" ? `balance_${code}` : prefix === "balance_" ? `point_${code}` : null;
                              return [...current.filter((field) => field !== counterpart), option.key];
                            }
                            return current.filter((field) => field !== option.key);
                          });
                        }}
                      />
                      <span className="flex-1">{importFieldLabel(option.key, activeTypes)}</span>
                      {option.mandatory && <span className="text-xs font-medium text-muted-foreground">{ui("Mandatory")}</span>}
                    </label>
                  );
                })}
              </div>
            </div>
            {bulkFormat === "csv" && (
              <Field
                id="bulk-content"
                label={ui("CSV content")}
                help={ui("Editable import preview. Positive bank-governed amounts consume bank funds; Per grant types require expiry_CODE.")}
              >
                <Textarea
                  id="bulk-content"
                  className="min-h-40 font-mono text-xs"
                  value={bulkContent}
                  onChange={(event) => {
                    setBulkContent(event.target.value);
                  }}
                />
              </Field>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={pointTypes.isLoading} onClick={downloadImportTemplate}>
                <Download />{ui("Download CSV template")}</Button>
              <Button
                disabled={!bulkContent || bulkImport.isPending}
                onClick={() => {
                  bulkImport.mutate();
                }}
              >
                <Upload />{ui("Import members")}</Button>
            </div>
            {bulkResult && (
              <div className="rounded-md border p-3 text-sm">
                <p>
                  {bulkResult.status}: {bulkResult.successRows}/{bulkResult.totalRows} succeeded
                </p>
                {bulkResult.report
                  ?.filter((row) => row.status === "failed")
                  .map((row) => (
                    <p key={row.row} className="text-destructive">
                      Row {row.row}: {row.error}
                    </p>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
