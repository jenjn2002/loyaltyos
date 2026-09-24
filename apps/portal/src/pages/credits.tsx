import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRightLeft,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchApi, postApi } from "../lib/api-client";
import { PointTypeIcon } from "../components/point-type-icon";
import type {
  CreditBalance,
  CreditCategory,
  CreditExchangeRequest,
  CreditExchangeRate,
  PaginatedResponse,
  RecognitionFeedItem,
} from "../types";

interface DirectoryMember {
  id: string;
  firstName: string | null;
  lastName: string | null;
  department: string | null;
  photoUrl: string | null;
}

interface RecipientRow {
  memberId: string;
  amount: string;
  message: string;
}

interface ExchangeSubmission {
  request: {
    documentNumber: string;
    status: "PENDING";
  };
}

function exchangeStatusLabel(status: CreditExchangeRequest["status"]): string {
  return ui(
    {
      PENDING: "Pending",
      APPROVED: "Approved",
      COMPLETED: "Completed",
      CANCELLED: "Cancelled",
      REJECTED: "Rejected",
    }[status],
  );
}

function exchangeStatusClass(status: CreditExchangeRequest["status"]): string {
  if (status === "APPROVED" || status === "COMPLETED")
    return "border-green-200 bg-green-50 text-green-700";
  if (status === "CANCELLED" || status === "REJECTED")
    return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

const controlClass =
  "block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm";

function requestKey(): string {
  return `${crypto.randomUUID()}-${Date.now().toString(36)}`;
}

function memberName(member: DirectoryMember): string {
  return [member.firstName, member.lastName].filter(Boolean).join(" ") || member.id;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function remainingExpiryDays(expiryAt: string | null): number | null {
  if (!expiryAt) return null;
  const expiryDate = new Date(expiryAt);
  if (!Number.isFinite(expiryDate.getTime())) return null;
  const today = new Date();
  const expiryDay = Date.UTC(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate());
  const currentDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.ceil((expiryDay - currentDay) / DAY_MS));
}

function useExpiryRefresh(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
}

function expiryLabel(wallet: CreditBalance): string {
  if (wallet.expiryMode === "NEVER") return ui("Does not expire");
  if (wallet.expiryMode === "AFTER_DAYS" || wallet.expiryMode === "FIXED_DATE") {
    const expiryAt = wallet.expiryAt ?? wallet.fixedExpiryAt;
    const days = remainingExpiryDays(expiryAt);
    if (days === 0) return ui("Expires today");
    if (days !== null) return `${ui("Expires in")} ${String(days)} ${ui("days")}`;
    return wallet.expiryMode === "AFTER_DAYS"
      ? `${ui("Expires")} ${String(wallet.expiryDays)} ${ui("days from point creation")}`
      : ui("Fixed expiry date");
  }
  return ui("Expiry is set for each grant");
}

function displayAmount(item: RecognitionFeedItem): number {
  if (item.action !== "GIVE_ALLOWANCE_OUT") return item.amount;
  const amount = Number(item.metadata?.allowanceSpent ?? 0);
  return -amount;
}

export function formatExchangeValue(amount: number, currency: string): string {
  const configuredCurrency = currency.trim();
  const currencyAliases: Record<string, string> = {
    "VNĐ": "VND",
    VND: "VND",
  };
  const isoCurrency = currencyAliases[configuredCurrency.toUpperCase()] ?? configuredCurrency;

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: isoCurrency,
    }).format(amount);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${new Intl.NumberFormat().format(amount)} ${configuredCurrency}`.trim();
  }
}

export default function Credits(): JSX.Element {
  const queryClient = useQueryClient();
  useExpiryRefresh();
  const [sourcePointTypeId, setSourcePointTypeId] = useState("");
  const [destinationPointTypeId, setDestinationPointTypeId] = useState("");
  const [fundingSource, setFundingSource] = useState<"BALANCE" | "ALLOWANCE">("BALANCE");
  const [recipients, setRecipients] = useState<RecipientRow[]>([
    { memberId: "", amount: "10", message: "" },
  ]);
  const [message, setMessage] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [exchangePointTypeId, setExchangePointTypeId] = useState("");
  const [exchangeAmount, setExchangeAmount] = useState("1");
  const [payoutType, setPayoutType] = useState<"CASH" | "NON_CASH">("NON_CASH");
  const [notice, setNotice] = useState<string | null>(null);
  const [exchangePage, setExchangePage] = useState(1);
  const [feedPage, setFeedPage] = useState(1);
  const [feedKind, setFeedKind] = useState<"all" | "received" | "given">("all");

  const wallets = useQuery({
    queryKey: ["credits", "balances"],
    queryFn: () => fetchApi<CreditBalance[]>("/members/me/credits"),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const rates = useQuery({
    queryKey: ["credits", "rates"],
    queryFn: () => fetchApi<CreditExchangeRate[]>("/credits/exchange/rates"),
  });
  const exchangeRequests = useQuery({
    queryKey: ["credits", "exchange-requests", exchangePage],
    queryFn: () =>
      fetchApi<PaginatedResponse<CreditExchangeRequest>>(
        `/members/me/credits/exchange-requests?page=${String(exchangePage)}&pageSize=10`,
      ),
  });
  const members = useQuery({
    queryKey: ["members", "directory"],
    queryFn: () => fetchApi<{ items: DirectoryMember[] }>("/members/directory?page=1&pageSize=100"),
  });
  const categories = useQuery({
    queryKey: ["credits", "categories"],
    queryFn: () => fetchApi<CreditCategory[]>("/credits/categories"),
  });
  const recognitionFeed = useQuery({
    queryKey: ["credits", "recognition-feed", feedPage, feedKind],
    queryFn: () =>
      fetchApi<{ items: RecognitionFeedItem[]; page: number; totalPages: number }>(
        `/members/me/recognition-feed?page=${String(feedPage)}&pageSize=10&kind=${feedKind}`,
      ),
  });
  const giveWallets = useMemo(
    () =>
      (wallets.data ?? []).filter((wallet) => wallet.giveEnabled && wallet.transferTargets.length),
    [wallets.data],
  );
  const sourceWallet = giveWallets.find((wallet) => wallet.pointTypeId === sourcePointTypeId);
  const destination = sourceWallet?.transferTargets.find(
    (target) => target.id === destinationPointTypeId,
  );
  const exchangeTypes = useMemo(() => {
    const map = new Map<string, CreditExchangeRate["pointType"]>();
    for (const rate of rates.data ?? []) map.set(rate.pointTypeId, rate.pointType);
    return [...map.values()];
  }, [rates.data]);
  const availablePayoutTypes = (rates.data ?? []).filter(
    (rate) => rate.pointTypeId === exchangePointTypeId,
  );
  const activeRate = availablePayoutTypes.find((rate) => rate.payoutType === payoutType);
  const exchangeWallet = (wallets.data ?? []).find(
    (wallet) => wallet.pointTypeId === exchangePointTypeId,
  );

  useEffect(() => {
    if (!sourcePointTypeId && giveWallets[0]) {
      setSourcePointTypeId(giveWallets[0].pointTypeId);
      setDestinationPointTypeId(giveWallets[0].transferTargets[0]?.id ?? "");
      setFundingSource(
        giveWallets[0].giveSource === "ALLOWANCE" || giveWallets[0].giveSource === "BOTH"
          ? "ALLOWANCE"
          : "BALANCE",
      );
    }
  }, [giveWallets, sourcePointTypeId]);

  useEffect(() => {
    if (!exchangePointTypeId && exchangeTypes[0]) setExchangePointTypeId(exchangeTypes[0].id);
  }, [exchangePointTypeId, exchangeTypes]);

  useEffect(() => {
    const options = (rates.data ?? []).filter((rate) => rate.pointTypeId === exchangePointTypeId);
    const firstOption = options[0];
    if (firstOption && !options.some((rate) => rate.payoutType === payoutType)) {
      setPayoutType(firstOption.payoutType);
    }
  }, [exchangePointTypeId, payoutType, rates.data]);

  const give = useMutation({
    mutationFn: () =>
      fetchApi("/credits/give", {
        method: "POST",
        headers: { "Idempotency-Key": requestKey() },
        body: JSON.stringify({
          sourcePointTypeId,
          destinationPointTypeId,
          fundingSource,
          recipients: recipients.map((row) => ({
            memberId: row.memberId,
            amount: Number(row.amount),
            ...(row.message.trim() ? { message: row.message.trim() } : {}),
          })),
          ...(message.trim() ? { message: message.trim() } : {}),
          ...(categoryId ? { categoryId } : {}),
        }),
      }),
    onSuccess: async () => {
      setNotice(ui("Recognition sent successfully."));
      setMessage("");
      setRecipients([{ memberId: "", amount: "10", message: "" }]);
      await queryClient.invalidateQueries({ queryKey: ["credits"] });
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const exchange = useMutation({
    mutationFn: () =>
      postApi<ExchangeSubmission>(
        "/credits/exchange",
        { pointTypeId: exchangePointTypeId, amount: Number(exchangeAmount), payoutType },
        { "Idempotency-Key": requestKey() },
      ),
    onSuccess: async (result) => {
      setNotice(
        `${ui("Accounting voucher")} ${result.request.documentNumber} ${ui("was created and is pending approval.")}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["credits"] });
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const sourceAvailable =
    fundingSource === "ALLOWANCE"
      ? (sourceWallet?.allowance?.remaining ?? 0)
      : (sourceWallet?.balance ?? 0);
  const sourceTotal = recipients.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const destinationTotal = destination
    ? (sourceTotal / destination.sourceAmount) * destination.destinationAmount
    : 0;
  const exchangeValueMinor = activeRate
    ? Number(exchangeAmount || 0) * activeRate.valueMinorPerPoint
    : 0;
  const messageMissing = Boolean(
    sourceWallet?.requireGiveMessage &&
    !message.trim() &&
    recipients.some((row) => !row.message.trim()),
  );

  const secondaryQueries = [
    rates,
    members,
    categories,
    recognitionFeed,
    exchangeRequests,
  ];
  const unavailableSections = secondaryQueries.filter((query) => query.isError).length;

  if (wallets.isLoading) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center gap-3 px-4 py-10 pb-20">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
        <p className="text-sm text-[var(--color-text-secondary)]">{ui("Loading credit wallets…")}</p>
      </div>
    );
  }

  if (wallets.isError) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 pb-20">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5" />{ui("Credits could not be loaded")}</div>
          <p className="mt-2 text-sm">
            {wallets.error instanceof Error ? wallets.error.message : ui("Please try again.")}
          </p>
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold"
            onClick={() => void wallets.refetch()}
          >
            <RefreshCw className="h-4 w-4" />{ui("Retry")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 pb-20">
      <header>
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">{ui("Wallets")}</p>
        <h1 className="mt-1 text-2xl font-bold">{ui("Points & recognition")}</h1>
      </header>

      {unavailableSections > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{unavailableSections} {ui("supporting section(s) could not be loaded.")}</p>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 font-semibold"
            onClick={() => {
              secondaryQueries
                .filter((query) => query.isError)
                .forEach((query) => {
                  void query.refetch();
                });
            }}
          >
            <RefreshCw className="h-4 w-4" />{ui("Retry unavailable sections")}</button>
        </div>
      )}

      <details open className="rounded-2xl border border-[var(--color-border)] p-4">
        <summary className="cursor-pointer list-none text-lg font-semibold">{ui("Point balances")}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2" aria-label={ui("Point balances")}>
          {(wallets.data ?? []).map((wallet) => (
            <div
              key={wallet.pointTypeId}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4"
              style={{ borderTopColor: wallet.color ?? undefined, borderTopWidth: 3 }}
            >
              <div className="flex items-center justify-between gap-2 text-sm font-semibold">
                <span className="flex items-center gap-2">
                  <PointTypeIcon icon={wallet.icon} className="h-4 w-4" /> {wallet.name}
                </span>
                <span className="text-xs text-[var(--color-text-secondary)]">{wallet.code}</span>
              </div>
              <p className="mt-2 text-3xl font-bold">{wallet.balance.toLocaleString()}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">{wallet.unitLabel}</p>
              <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{expiryLabel(wallet)}</p>
              {wallet.allowance && (
                <p className="mt-1 text-xs font-medium text-[var(--color-primary)]">
                  {ui("Give allowance:")} {wallet.allowance.remaining.toLocaleString()} /{" "}
                  {wallet.allowance.allocated.toLocaleString()}
                </p>
              )}
            </div>
          ))}
          {(wallets.data ?? []).length === 0 && (
            <p className="sm:col-span-2 rounded-xl border border-dashed p-5 text-sm text-[var(--color-text-secondary)]">{ui("No member-visible point types are currently configured.")}</p>
          )}
        </div>
      </details>

      {giveWallets.length > 0 && (
        <details className="rounded-2xl border border-[var(--color-border)] p-4">
          <summary className="flex cursor-pointer list-none items-center gap-2">
            <Send className="h-5 w-5 text-[var(--color-primary)]" />
            <h2 className="text-lg font-semibold">{ui("Give recognition")}</h2>
          </summary>
          <div className="mt-4 space-y-3">
            <label
              className="block text-sm font-medium"
              data-help={ui("Select which owned wallet or separate allowance funds this Give operation.")}
            >{ui("Source point type")}<select
                className={`mt-1 ${controlClass}`}
                value={sourcePointTypeId}
                onChange={(event) => {
                  const sourceId = event.target.value;
                  const source = giveWallets.find((wallet) => wallet.pointTypeId === sourceId);
                  setSourcePointTypeId(sourceId);
                  setDestinationPointTypeId(source?.transferTargets[0]?.id ?? "");
                  setFundingSource(
                    source?.giveSource === "ALLOWANCE" || source?.giveSource === "BOTH"
                      ? "ALLOWANCE"
                      : "BALANCE",
                  );
                }}
              >
                {giveWallets.map((wallet) => (
                  <option key={wallet.pointTypeId} value={wallet.pointTypeId}>
                    {wallet.name} — {wallet.giveSource.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            {sourceWallet?.giveSource === "BOTH" && (
              <label
                className="block text-sm font-medium"
                data-help={ui("Choose whether this Give consumes your owned wallet balance or your renewable Give allowance.")}
              >{ui("Funds from")}<select
                  className={`mt-1 ${controlClass}`}
                  value={fundingSource}
                  onChange={(event) => {
                    setFundingSource(event.target.value as "BALANCE" | "ALLOWANCE");
                  }}
                >
                  <option value="ALLOWANCE">{ui("Give allowance")}</option>
                  <option value="BALANCE">{ui("Owned balance")}</option>
                </select>
              </label>
            )}
            <label
              className="block text-sm font-medium"
              data-help={ui("Only destinations explicitly allowed by the administrator appear here.")}
            >{ui("Recipient receives")}<select
                className={`mt-1 ${controlClass}`}
                value={destinationPointTypeId}
                onChange={(event) => {
                  setDestinationPointTypeId(event.target.value);
                }}
              >
                {(sourceWallet?.transferTargets ?? []).map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name} ({target.sourceAmount}:{target.destinationAmount})
                  </option>
                ))}
              </select>
            </label>

            {recipients.map((recipient, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_7rem_auto] gap-2 rounded-xl bg-[var(--color-surface-secondary)] p-3"
              >
                <label
                  className="text-xs font-medium"
                  data-help={ui("The active colleague receiving this recognition.")}
                >{ui("Recipient")}<select
                    aria-label={`Recipient ${String(index + 1)}`}
                    value={recipient.memberId}
                    onChange={(event) => {
                      setRecipients((rows) =>
                        rows.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, memberId: event.target.value } : row,
                        ),
                      );
                    }}
                    className={`mt-1 ${controlClass}`}
                  >
                    <option value="">{ui("Select colleague")}</option>
                    {(members.data?.items ?? []).map((member) => (
                      <option key={member.id} value={member.id}>
                        {memberName(member)}
                        {member.department ? ` · ${member.department}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className="text-xs font-medium"
                  data-help={ui("Amount consumed from the source. The recipient amount follows the configured ratio.")}
                >{ui("Amount")}<input
                    aria-label={`Amount for recipient ${String(index + 1)}`}
                    type="number"
                    min={destination?.sourceAmount ?? 1}
                    step={destination?.sourceAmount ?? 1}
                    value={recipient.amount}
                    onChange={(event) => {
                      setRecipients((rows) =>
                        rows.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, amount: event.target.value } : row,
                        ),
                      );
                    }}
                    className={`mt-1 ${controlClass}`}
                  />
                </label>
                <button
                  type="button"
                  aria-label={ui("Remove recipient")}
                  disabled={recipients.length === 1}
                  onClick={() => {
                    setRecipients((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
                  }}
                  className="mt-5 rounded-lg p-2 text-[var(--color-text-secondary)] disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <label
                  className="col-span-3 text-xs font-medium"
                  data-help={ui("Optional recipient-specific message; it overrides the shared message for this person.")}
                >{ui("Recipient-specific message")}<input
                    value={recipient.message}
                    onChange={(event) => {
                      setRecipients((rows) =>
                        rows.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, message: event.target.value } : row,
                        ),
                      );
                    }}
                    placeholder={ui("Optional override")}
                    className={`mt-1 ${controlClass}`}
                  />
                </label>
              </div>
            ))}

            {sourceWallet?.allowMultiRecipient &&
              recipients.length < sourceWallet.maxRecipients && (
                <button
                  type="button"
                  onClick={() => {
                    setRecipients((rows) => [
                      ...rows,
                      {
                        memberId: "",
                        amount: destination?.sourceAmount.toString() ?? "1",
                        message: "",
                      },
                    ]);
                  }}
                  className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-primary)]"
                >
                  <Plus className="h-4 w-4" />{ui("Add recipient")}</button>
              )}

            <label
              className="block text-sm font-medium"
              data-help={ui("Shared recognition context. It is required when the selected point type requires a message.")}
            >
              {ui("Shared message")}{sourceWallet?.requireGiveMessage ? ui(" (required)") : ui(" (optional)")}
              <textarea
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value);
                }}
                className={`mt-1 min-h-20 ${controlClass}`}
              />
            </label>
            <label
              className="block text-sm font-medium"
              data-help={ui("Optional reporting category selected by your program administrator.")}
            >{ui("Category")}<select
                className={`mt-1 ${controlClass}`}
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                }}
              >
                <option value="">{ui("No category")}</option>
                {(categories.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-lg bg-[var(--color-surface-secondary)] p-3 text-sm">
              <p>
                {ui("Available source:")} {" "}
                <strong>
                  {sourceAvailable.toLocaleString()} {sourceWallet?.unitLabel}
                </strong>
              </p>
              <p>
                {ui("Recipient total:")} {" "}
                <strong>
                  {destinationTotal.toLocaleString()} {destination?.unitLabel}
                </strong>
              </p>
            </div>
            <button
              type="button"
              disabled={
                give.isPending ||
                !sourcePointTypeId ||
                !destinationPointTypeId ||
                sourceTotal <= 0 ||
                sourceTotal > sourceAvailable ||
                messageMissing ||
                recipients.some((row) => !row.memberId || Number(row.amount) <= 0)
              }
              onClick={() => {
                if (
                  window.confirm(
                    `Send ${sourceTotal.toLocaleString()} ${sourceWallet?.unitLabel ?? "points"} to ${String(recipients.length)} recipient(s)?`,
                  )
                )
                  give.mutate();
              }}
              className="w-full rounded-lg bg-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {give.isPending ? ui("Sending…") : ui("Confirm & send")}
            </button>
          </div>
        </details>
      )}

      {exchangeTypes.length > 0 && (
        <details className="rounded-2xl border border-[var(--color-border)] p-4">
          <summary className="flex cursor-pointer list-none items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-[var(--color-primary)]" />
            <h2 className="text-lg font-semibold">{ui("Exchange points")}</h2>
          </summary>
          <div className="mt-4 space-y-3">
            <label
              className="block text-sm font-medium"
              data-help={ui("A point type appears only when an active exchange rate has been configured.")}
            >{ui("Point type")}<select
                className={`mt-1 ${controlClass}`}
                value={exchangePointTypeId}
                onChange={(event) => {
                  setExchangePointTypeId(event.target.value);
                }}
              >
                {exchangeTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="block text-sm font-medium"
              data-help={ui("The payout choices available for the selected point type and active rate version.")}
            >{ui("Payout type")}<select
                className={`mt-1 ${controlClass}`}
                value={payoutType}
                onChange={(event) => {
                  setPayoutType(event.target.value as "CASH" | "NON_CASH");
                }}
              >
                {availablePayoutTypes.map((rate) => (
                  <option key={rate.id} value={rate.payoutType}>
                    {rate.payoutType === "CASH" ? ui("Cash") : ui("Non-cash")} · {rate.payoutMechanism}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="block text-sm font-medium"
              data-help={ui("Points deducted immediately when the exchange request is submitted.")}
            >{ui("Amount")}<input
                className={`mt-1 ${controlClass}`}
                type="number"
                min={activeRate?.minPoints ?? 1}
                max={activeRate?.maxPoints ?? undefined}
                value={exchangeAmount}
                onChange={(event) => {
                  setExchangeAmount(event.target.value);
                }}
              />
            </label>
            <p className="rounded-lg bg-[var(--color-surface-secondary)] p-3 text-sm text-[var(--color-text-secondary)]">
              {ui("Preview:")} {" "}
              {activeRate
                ? formatExchangeValue(exchangeValueMinor / 100, activeRate.currency)
                : ui("Rate not configured")}
              {activeRate?.periodLimitPoints
                ? ` · Limit ${activeRate.periodLimitPoints.toLocaleString()} every ${String(activeRate.periodDays)} days`
                : ""}
            </p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              {ui("Submitting creates a stored accounting voucher in Pending status. Authorized staff review it, approve it and then record completion; no automatic cash payout is made.")}
            </p>
            <button
              type="button"
              disabled={
                !activeRate ||
                exchange.isPending ||
                Number(exchangeAmount) <= 0 ||
                Number(exchangeAmount) > (exchangeWallet?.balance ?? 0)
              }
              onClick={() => {
                exchange.mutate();
              }}
              className="w-full rounded-lg border border-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)] disabled:opacity-50"
            >
              {exchange.isPending ? ui("Submitting…") : ui("Submit exchange request")}
            </button>
          </div>
        </details>
      )}

      <details className="rounded-2xl border border-[var(--color-border)] p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-[var(--color-primary)]" />
            <h2 className="text-lg font-semibold">{ui("My exchange requests")}</h2>
          </div>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {ui("Page")} {exchangeRequests.data?.page ?? 1} / {exchangeRequests.data?.totalPages ?? 1}
          </span>
        </summary>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {ui("Track approval and completion status for every exchange request.")}
        </p>
        <div className="mt-3 space-y-3">
          {(exchangeRequests.data?.items ?? []).map((item) => (
            <article key={item.id} className="rounded-xl bg-[var(--color-surface-secondary)] p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{item.documentNumber}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {item.pointType.name} · {item.amount.toLocaleString()} {item.pointType.unitLabel}
                  </p>
                </div>
                <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${exchangeStatusClass(item.status)}`}>
                  {exchangeStatusLabel(item.status)}
                </span>
              </div>
              <div className="mt-2 grid gap-1 text-xs text-[var(--color-text-secondary)] sm:grid-cols-2">
                <p>{ui("Value:")} {formatExchangeValue(item.valueMinor / 100, item.currency)}</p>
                <p>{ui("Payout:")} {item.payoutType} · {item.payoutMechanism}</p>
                <p>{ui("Requested:")} {new Date(item.requestedAt).toLocaleString()}</p>
                {item.approvedAt && <p>{ui("Approved:")} {new Date(item.approvedAt).toLocaleString()}</p>}
                {item.completedAt && <p>{ui("Completed:")} {new Date(item.completedAt).toLocaleString()}</p>}
                {item.completionReference && <p>{ui("Reference:")} {item.completionReference}</p>}
              </div>
              {item.approvalNote && <p className="mt-2 text-xs">{ui("Approval note:")} {item.approvalNote}</p>}
              {item.completionNote && <p className="mt-2 text-xs">{ui("Completion note:")} {item.completionNote}</p>}
              {item.cancellationReason && (
                <p className="mt-2 text-xs text-red-600">{ui("Cancellation:")} {item.cancellationReason}</p>
              )}
            </article>
          ))}
          {!exchangeRequests.isLoading && (exchangeRequests.data?.items ?? []).length === 0 && (
            <p className="py-4 text-sm text-[var(--color-text-secondary)]">{ui("No exchange requests.")}</p>
          )}
          {exchangeRequests.isError && (
            <p className="py-4 text-sm text-red-600">{ui("Exchange requests could not be loaded.")}</p>
          )}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            disabled={exchangePage <= 1}
            onClick={() => {
              setExchangePage((page) => page - 1);
            }}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40"
          >{ui("Previous")}</button>
          <button
            type="button"
            disabled={exchangePage >= (exchangeRequests.data?.totalPages ?? 1)}
            onClick={() => {
              setExchangePage((page) => page + 1);
            }}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40"
          >{ui("Next")}</button>
        </div>
      </details>

      <details className="rounded-2xl border border-[var(--color-border)] p-4">
        <summary className="flex cursor-pointer list-none items-center gap-2">
          <History className="h-5 w-5 text-[var(--color-primary)]" />
          <h2 className="text-lg font-semibold">{ui("Recognition feed")}</h2>
        </summary>
        <div className="mt-3 flex items-center justify-between gap-3">
          <label
            className="text-sm font-medium"
            data-help={ui("All shows the program feed; Received and Given are limited to your own activity.")}
          >{ui("View")}<select
              className={`mt-1 ${controlClass}`}
              value={feedKind}
              onChange={(event) => {
                setFeedKind(event.target.value as "all" | "received" | "given");
                setFeedPage(1);
              }}
            >
              <option value="all">{ui("All recognition")}</option>
              <option value="received">{ui("Received by me")}</option>
              <option value="given">{ui("Given by me")}</option>
            </select>
          </label>
          <span className="text-xs text-[var(--color-text-secondary)]">
            Page {recognitionFeed.data?.page ?? 1} / {recognitionFeed.data?.totalPages ?? 1}
          </span>
        </div>
        <div className="mt-3 space-y-3">
          {(recognitionFeed.data?.items ?? []).map((item) => {
            const amount = displayAmount(item);
            return (
              <article key={item.id} className="rounded-xl bg-[var(--color-surface-secondary)] p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold">
                    {item.member
                      ? [item.member.firstName, item.member.lastName].filter(Boolean).join(" ") ||
                        item.member.email
                      : "Member"}
                  </span>
                  <span
                    className={`font-semibold ${amount >= 0 ? "text-green-600" : "text-red-600"}`}
                  >
                    {amount > 0 ? "+" : ""}
                    {amount.toLocaleString()} {item.pointType.unitLabel}
                  </span>
                </div>
                {item.message && <p className="mt-1 text-sm">{item.message}</p>}
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                  {item.categoryRef?.name ?? item.category ?? ui("Recognition")} ·{" "}
                  {new Date(item.createdAt).toLocaleString()}
                </p>
              </article>
            );
          })}
          {(recognitionFeed.data?.items ?? []).length === 0 && (
            <p className="text-sm text-[var(--color-text-secondary)]">{ui("No recognition activity yet.")}</p>
          )}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            disabled={feedPage <= 1}
            onClick={() => {
              setFeedPage((page) => page - 1);
            }}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40"
          >{ui("Previous")}</button>
          <button
            type="button"
            disabled={feedPage >= (recognitionFeed.data?.totalPages ?? 1)}
            onClick={() => {
              setFeedPage((page) => page + 1);
            }}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40"
          >{ui("Next")}</button>
        </div>
      </details>

      {notice && (
        <p role="status" className="rounded-lg bg-[var(--color-surface-secondary)] p-3 text-sm">
          {notice}
        </p>
      )}
    </div>
  );
}
