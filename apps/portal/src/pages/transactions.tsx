import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Filter, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchApi } from "../lib/api-client";
import type { PaginatedResponse, PointTransaction } from "../types";

const typeIcons: Record<string, React.ElementType> = {
  EARN: ArrowUp,
  REDEEM: ArrowDown,
  ADJUSTMENT: Filter,
  REVERSAL: RotateCcw,
  EXPIRY: XCircle,
  GIVE_IN: ArrowUp,
  GIVE_OUT: ArrowDown,
  GIVE_ALLOWANCE_OUT: ArrowDown,
  EXCHANGE: ArrowDown,
};

const typeColors: Record<string, string> = {
  EARN: "text-green-500",
  REDEEM: "text-red-500",
  ADJUSTMENT: "text-blue-500",
  REVERSAL: "text-amber-500",
  EXPIRY: "text-slate-400",
  GIVE_IN: "text-green-500",
  GIVE_OUT: "text-purple-500",
  GIVE_ALLOWANCE_OUT: "text-purple-500",
  EXCHANGE: "text-red-500",
};

interface TransactionLabels {
  exchange: string;
  reward: string;
  campaign: string;
  admin: string;
  recognition: string;
  system: string;
  transaction: string;
}

function cleanTransactionReason(reason: string | null): string {
  return (reason ?? "")
    .replace(/^Reward redemption:\s*/i, "")
    .replace(/^Claimed campaign:\s*/i, "")
    .replace(/^Automatic issuance rule:\s*/i, "")
    .trim();
}

function transactionTitle(tx: PointTransaction, labels: TransactionLabels): string {
  const reason = cleanTransactionReason(tx.reason);
  if (tx.source.startsWith("reward:")) return reason || labels.reward;
  if (tx.source.startsWith("campaign:")) return reason || labels.campaign;
  if (tx.source === "member:exchange") return labels.exchange;
  if (tx.source.startsWith("admin:")) return labels.admin;
  if (tx.source.startsWith("member:give")) return labels.recognition;
  if (tx.source.startsWith("system:")) return labels.system;
  return reason || labels.transaction;
}

export default function Transactions() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<string>("");
  const labels: TransactionLabels = {
    exchange: t("transactionTitles.exchange"),
    reward: t("transactionTitles.reward"),
    campaign: t("transactionTitles.campaign"),
    admin: t("transactionTitles.admin"),
    recognition: t("transactionTitles.recognition"),
    system: t("transactionTitles.system"),
    transaction: t("transactionTitles.transaction"),
  };

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", filter],
    queryFn: () =>
      fetchApi<PaginatedResponse<PointTransaction>>(
        `/members/me/transactions?page=1&pageSize=50${filter && filter !== "ALL" ? `&type=${filter}` : ""}`,
      ),
  });

  const transactions = data?.items ?? [];

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold">{t("transactions")}</h1>

      <div className="flex gap-2 overflow-x-auto" role="group" aria-label={t("filterAll")}>
        {[
          "",
          "EARN",
          "REDEEM",
          "ADJUSTMENT",
          "GIVE_IN",
          "GIVE_OUT",
          "EXCHANGE",
          "EXPIRY",
          "REVERSAL",
        ].map((type) => (
          <button
            key={type}
            onClick={() => {
              setFilter(type);
            }}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === type
                ? "bg-[var(--color-primary)] text-white"
                : "border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]"
            }`}
          >
            {type === "" ? t("filterAll") : t(`transactionTypes.${type}`)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl bg-[var(--color-surface-secondary)]"
            />
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <div className="py-12 text-center text-[var(--color-text-secondary)]">
          <p>{t("noTransactions")}</p>
        </div>
      ) : (
        <ul className="space-y-2" role="list">
          {transactions.map((tx) => {
            const Icon = typeIcons[tx.action] ?? Filter;
            const sign = tx.amount > 0 ? "+" : "";
            return (
              <li
                key={tx.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-4 py-3"
              >
                <div
                  className={`rounded-full p-1.5 ${typeColors[tx.action] ?? "text-slate-400"} bg-opacity-10`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{transactionTitle(tx, labels)}</p>
                  {cleanTransactionReason(tx.reason) &&
                    cleanTransactionReason(tx.reason) !== transactionTitle(tx, labels) && (
                    <p className="truncate text-xs text-[var(--color-text-secondary)]">
                      {cleanTransactionReason(tx.reason)}
                    </p>
                  )}
                  {tx.message && (
                    <p className="truncate text-xs text-[var(--color-text-secondary)]">{tx.message}</p>
                  )}
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {new Date(tx.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${tx.amount > 0 ? "text-green-500" : ""}`}>
                    {sign}
                    {tx.amount.toLocaleString()} {tx.pointType.unitLabel}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {tx.balanceAfter.toLocaleString()}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
