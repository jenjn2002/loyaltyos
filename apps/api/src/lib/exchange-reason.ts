interface ExchangeReasonContext {
  documentNumber?: string | null;
  payoutType?: string | null;
}

export function formatPointExchangeReason(context: ExchangeReasonContext, locale = "en-US"): string {
  const vietnamese = locale.startsWith("vi");
  const title = vietnamese ? "Đổi điểm" : "Point exchange";
  const documentNumber = context.documentNumber?.trim();
  const payout = context.payoutType === "CASH"
    ? vietnamese ? "Tiền mặt" : "Cash"
    : context.payoutType === "NON_CASH" ? vietnamese ? "Phi tiền mặt" : "Non-cash" : null;
  return [documentNumber ? `${title}: ${documentNumber}` : title, payout].filter(Boolean).join(" · ");
}

/** Presentation fallback only: never rewrite historical hash-protected ledger records. */
export function ledgerReasonForDisplay(transaction: {
  action: string;
  reason: string | null;
  metadata?: unknown;
  exchangeRequest?: ExchangeReasonContext | null;
}, locale = "en-US"): string | null {
  if (transaction.action !== "EXCHANGE") return transaction.reason;
  const metadata = transaction.metadata && typeof transaction.metadata === "object" && !Array.isArray(transaction.metadata)
    ? transaction.metadata as Record<string, unknown> : {};
  const context: ExchangeReasonContext = {
    documentNumber: transaction.exchangeRequest?.documentNumber ?? (typeof metadata.documentNumber === "string" ? metadata.documentNumber : null),
    payoutType: transaction.exchangeRequest?.payoutType ?? (typeof metadata.payoutType === "string" ? metadata.payoutType : null),
  };
  if (transaction.reason?.trim() && transaction.reason !== formatPointExchangeReason(context)) return transaction.reason;
  return formatPointExchangeReason(context, locale);
}
