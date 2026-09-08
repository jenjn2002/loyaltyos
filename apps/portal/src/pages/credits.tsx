import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, History, Plus, Send, WalletCards } from "lucide-react";
import { useState } from "react";

import { fetchApi, postApi } from "../lib/api-client";
import type { CreditBalance, CreditCategory, CreditExchangeRate, CreditHistory, CreditType, MemberProfile, MemberRewardRedemption, RecognitionFeedItem } from "../types";

interface RecipientRow {
  memberId: string;
  amount: string;
  message: string;
}

function requestKey(): string {
  return `${crypto.randomUUID()}-${Date.now().toString(36)}`;
}

export default function Credits() {
  const queryClient = useQueryClient();
  const [creditType, setCreditType] = useState<CreditType>("R");
  const [recipients, setRecipients] = useState<RecipientRow[]>([{ memberId: "", amount: "10", message: "" }]);
  const [message, setMessage] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [exchangeType, setExchangeType] = useState<CreditType>("P");
  const [exchangeAmount, setExchangeAmount] = useState("1");
  const [payoutType, setPayoutType] = useState<"CASH" | "NON_CASH">("CASH");
  const [notice, setNotice] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyType, setHistoryType] = useState<"" | CreditType>("");
  const [feedPage, setFeedPage] = useState(1);
  const [feedKind, setFeedKind] = useState<"all" | "received" | "given">("all");

  const balances = useQuery({
    queryKey: ["credits", "balances"],
    queryFn: () => fetchApi<CreditBalance[]>("/members/me/credits"),
  });
  const rates = useQuery({
    queryKey: ["credits", "rates"],
    queryFn: () => fetchApi<CreditExchangeRate[]>("/credits/exchange/rates"),
  });
  const members = useQuery({
    queryKey: ["members", "directory"],
    queryFn: () => fetchApi<{ items: MemberProfile[] }>("/members?page=1&pageSize=100"),
  });
  const categories = useQuery({
    queryKey: ["credits", "categories"],
    queryFn: () => fetchApi<CreditCategory[]>("/credits/categories"),
  });
  const history = useQuery({
    queryKey: ["credits", "history", historyPage, historyType],
    queryFn: () => fetchApi<CreditHistory>(`/members/me/credits/transactions?page=${String(historyPage)}&pageSize=20${historyType ? `&creditType=${historyType}` : ""}`),
  });
  const recognitionFeed = useQuery({
    queryKey: ["credits", "recognition-feed", feedPage, feedKind],
    queryFn: () => fetchApi<{ items: RecognitionFeedItem[]; page: number; totalPages: number }>(`/members/me/recognition-feed?page=${String(feedPage)}&pageSize=10&kind=${feedKind}`),
  });
  const notifications = useQuery({
    queryKey: ["notifications", "me"],
    queryFn: () => fetchApi<{ items: Array<{ id: string; subject: string | null; body: string | null; status: string; createdAt: string }> }>("/members/me/notifications?page=1&pageSize=10"),
  });
  const redemptions = useQuery({
    queryKey: ["reward-redemptions", "me"],
    queryFn: () => fetchApi<MemberRewardRedemption[]>("/members/me/reward-redemptions"),
  });

  const give = useMutation({
    mutationFn: () =>
      postApi("/credits/give", {
        creditType,
        recipients: recipients.map((row) => ({ memberId: row.memberId, amount: Number(row.amount), ...(row.message.trim() ? { message: row.message.trim() } : {}) })),
        message,
        ...(categoryId ? { categoryId } : {}),
      }, { "Idempotency-Key": requestKey() }),
    onSuccess: () => {
      setNotice("Recognition sent successfully.");
      setShowSuccess(true);
      window.setTimeout(() => setShowSuccess(false), 1800);
      setMessage("");
      void queryClient.invalidateQueries({ queryKey: ["credits"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const exchange = useMutation({
    mutationFn: () =>
      postApi("/credits/exchange", {
        creditType: exchangeType,
        amount: Number(exchangeAmount),
        payoutType,
      }, { "Idempotency-Key": requestKey() }),
    onSuccess: () => {
      setNotice("Exchange submitted successfully.");
      void queryClient.invalidateQueries({ queryKey: ["credits"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const balanceFor = (type: CreditType) => balances.data?.find((item) => item.creditType === type);
  const activeRate = rates.data?.find((rate) => rate.creditType === exchangeType);
  const exchangePreview = activeRate ? Number(exchangeAmount || 0) * activeRate.valueMinorPerCredit : 0;

  return (
    <div className="space-y-6 pb-20">
      <header>
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">Credit wallet</p>
        <h1 className="mt-1 text-2xl font-bold">Stars & recognition</h1>
      </header>

      <section className="grid grid-cols-2 gap-3" aria-label="Credit balances">
        {(["P", "R"] as CreditType[]).map((type) => (
          <div key={type} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <WalletCards className="h-4 w-4" /> {type}-credit
            </div>
            <p className="mt-2 text-3xl font-bold">{(balanceFor(type)?.balance ?? 0).toLocaleString()}</p>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              {type === "P" ? "Project credit · expires" : "Recognition credit · no expiry"}
            </p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] p-4">
        <div className="flex items-center gap-2">
          <Send className="h-5 w-5 text-[var(--color-primary)]" />
          <h2 className="text-lg font-semibold">Give recognition</h2>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium">
            Credit wallet
            <select value={creditType} onChange={(event) => setCreditType(event.target.value as CreditType)} className="mt-1 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <option value="R">R-credit</option>
              <option value="P">P-credit → receiver gets R-credit</option>
            </select>
          </label>
          {recipients.map((recipient, index) => (
            <div key={index} className="grid grid-cols-[1fr_6rem] gap-2">
              <select value={recipient.memberId} onChange={(event) => setRecipients((rows) => rows.map((row, i) => i === index ? { ...row, memberId: event.target.value } : row))} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
                <option value="">Select colleague</option>
                {(members.data?.items ?? []).map((member) => <option key={member.id} value={member.id}>{[member.firstName, member.lastName].filter(Boolean).join(" ") || member.email || member.id}</option>)}
              </select>
              <input type="number" min="1" value={recipient.amount} onChange={(event) => setRecipients((rows) => rows.map((row, i) => i === index ? { ...row, amount: event.target.value } : row))} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
              <input value={recipient.message} onChange={(event) => setRecipients((rows) => rows.map((row, i) => i === index ? { ...row, message: event.target.value } : row))} placeholder="Message (optional override)" className="col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
            </div>
          ))}
          <button type="button" onClick={() => setRecipients((rows) => [...rows, { memberId: "", amount: "10", message: "" }])} className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-primary)]"><Plus className="h-4 w-4" /> Add recipient</button>
          <textarea required minLength={1} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a recognition message (required)" className="block min-h-20 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"><option value="">Category (optional)</option>{(categories.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <button type="button" disabled={give.isPending || !message.trim() || recipients.some((row) => !row.memberId)} onClick={() => { if (!window.confirm(`Confirm recognition to ${String(recipients.length)} colleague(s)?`)) return; setNotice(null); give.mutate(); }} className="w-full rounded-lg bg-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{give.isPending ? "Sending…" : "Confirm & send recognition"}</button>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] p-4">
        <h2 className="text-lg font-semibold">Notifications</h2>
        <div className="mt-3 space-y-2">{(notifications.data?.items ?? []).map((item) => <div key={item.id} className="rounded-lg bg-[var(--color-surface-secondary)] p-3 text-sm"><p className="font-medium">{item.subject ?? "LoyaltyOS update"}</p>{item.body && <p className="mt-1">{item.body}</p>}<p className="mt-1 text-xs text-[var(--color-text-secondary)]">{new Date(item.createdAt).toLocaleString()} · {item.status}</p></div>)}{(notifications.data?.items ?? []).length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">No notifications.</p>}</div>
      </section>

      {!redemptions.isError && redemptions.data && <section className="rounded-2xl border border-[var(--color-border)] p-4">
        <h2 className="text-lg font-semibold">My reward fulfillment</h2>
        <div className="mt-3 space-y-2">{redemptions.data.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">No reward redemptions yet.</p> : redemptions.data.map((redemption) => <div key={redemption.id} className="flex items-center justify-between rounded-lg bg-[var(--color-surface-secondary)] p-3 text-sm"><div><p className="font-medium">{redemption.reward.name}</p><p className="text-xs text-[var(--color-text-secondary)]">{redemption.pointsSpent.toLocaleString()} credits · {new Date(redemption.redeemedAt).toLocaleString()}</p></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${redemption.fulfillmentStatus === "FULFILLED" ? "bg-green-100 text-green-800" : redemption.fulfillmentStatus === "CANCELLED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{redemption.fulfillmentStatus}</span></div>)}</div>
      </section>}

      <section className="rounded-2xl border border-[var(--color-border)] p-4">
        <div className="flex items-center gap-2"><History className="h-5 w-5 text-[var(--color-primary)]" /><h2 className="text-lg font-semibold">Recognition feed</h2></div>
        <div className="mt-3 flex items-center justify-between"><select value={feedKind} onChange={(event) => { setFeedKind(event.target.value as "all" | "received" | "given"); setFeedPage(1); }} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"><option value="all">All recognition</option><option value="received">Received</option><option value="given">Given</option></select><span className="text-xs text-[var(--color-text-secondary)]">Page {recognitionFeed.data?.page ?? 1} / {recognitionFeed.data?.totalPages ?? 1}</span></div>
        <div className="mt-3 space-y-3">
          {(recognitionFeed.data?.items ?? []).length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">No recognition activity yet.</p> : (recognitionFeed.data?.items ?? []).map((item) => <article key={item.id} className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="flex items-center justify-between text-sm"><span className="font-semibold">{item.type === "GIVE_OUT" ? "To" : "From"} {item.counterparty ? [item.counterparty.firstName, item.counterparty.lastName].filter(Boolean).join(" ") || item.counterparty.email : "A colleague"}</span><span className={`font-semibold ${item.amount >= 0 ? "text-green-600" : "text-red-600"}`}>{item.amount > 0 ? "+" : ""}{item.amount} R</span></div>{item.message && <p className="mt-1 text-sm">{item.message}</p>}<p className="mt-1 text-xs text-[var(--color-text-secondary)]">{item.category ?? "Recognition"} · {new Date(item.createdAt).toLocaleString()}</p></article>)}
        </div>
        <div className="mt-3 flex justify-end gap-2"><button type="button" disabled={feedPage <= 1} onClick={() => setFeedPage((page) => page - 1)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40">Previous</button><button type="button" disabled={feedPage >= (recognitionFeed.data?.totalPages ?? 1)} onClick={() => setFeedPage((page) => page + 1)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40">Next</button></div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] p-4">
        <h2 className="text-lg font-semibold">Credit transaction history</h2>
        <div className="mt-3 flex items-center justify-between"><select value={historyType} onChange={(event) => { setHistoryType(event.target.value as "" | CreditType); setHistoryPage(1); }} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"><option value="">All wallets</option><option value="P">P-credit</option><option value="R">R-credit</option></select><span className="text-xs text-[var(--color-text-secondary)]">Page {history.data?.page ?? 1} / {history.data?.totalPages ?? 1}</span></div><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--color-border)]"><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Wallet</th><th className="py-2 pr-3">Action / counterparty</th><th className="py-2 text-right">Amount · balance</th></tr></thead><tbody>{(history.data?.items ?? []).map((item) => <tr key={item.id} className="border-b border-[var(--color-border)] last:border-0"><td className="py-2 pr-3 text-xs text-[var(--color-text-secondary)]">{new Date(item.createdAt).toLocaleString()}</td><td className="py-2 pr-3">{item.creditType}</td><td className="py-2 pr-3">{item.type}{item.counterparty ? <span className="ml-2 text-xs text-[var(--color-text-secondary)]">{[item.counterparty.firstName, item.counterparty.lastName].filter(Boolean).join(" ") || item.counterparty.email}</span> : null}{item.message ? <span className="ml-2 text-xs text-[var(--color-text-secondary)]">{item.message}</span> : null}</td><td className="py-2 text-right"><span className={`font-semibold ${item.amount >= 0 ? "text-green-600" : "text-red-600"}`}>{item.amount > 0 ? "+" : ""}{item.amount}</span><span className="ml-2 text-xs text-[var(--color-text-secondary)]">→ {item.balanceAfter}</span></td></tr>)}</tbody></table>{(history.data?.items ?? []).length === 0 && <p className="py-4 text-sm text-[var(--color-text-secondary)]">No transactions yet.</p>}</div><div className="mt-3 flex justify-end gap-2"><button type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage((page) => page - 1)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40">Previous</button><button type="button" disabled={historyPage >= (history.data?.totalPages ?? 1)} onClick={() => setHistoryPage((page) => page + 1)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40">Next</button></div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] p-4">
        <div className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-[var(--color-primary)]" /><h2 className="text-lg font-semibold">Exchange credits</h2></div>
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium">Wallet<select value={exchangeType} onChange={(event) => { const value = event.target.value as CreditType; setExchangeType(value); if (value === "R") setPayoutType("NON_CASH"); }} className="mt-1 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"><option value="P">P-credit</option><option value="R">R-credit</option></select></label>
          <input type="number" min={activeRate?.minCredits ?? 1} max={activeRate?.maxCredits ?? undefined} value={exchangeAmount} onChange={(event) => setExchangeAmount(event.target.value)} className="block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2" />
          <select value={payoutType} onChange={(event) => setPayoutType(event.target.value as "CASH" | "NON_CASH")} className="block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"><option value="CASH" disabled={exchangeType === "R"}>Cash exchange (P-credit only)</option><option value="NON_CASH">Gift card / non-cash</option></select>
          <p className="text-sm text-[var(--color-text-secondary)]">Preview: {exchangePreview.toLocaleString()} {activeRate?.currency ?? ""} · {activeRate?.payoutMechanism ?? "Rate not configured"}</p>
          <button type="button" disabled={exchange.isPending || !activeRate || (balanceFor(exchangeType)?.balance ?? 0) < Number(exchangeAmount)} onClick={() => { setNotice(null); exchange.mutate(); }} className="w-full rounded-lg border border-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)] disabled:opacity-50">{exchange.isPending ? "Submitting…" : "Confirm exchange"}</button>
        </div>
      </section>

      {notice && <p role="status" className={`rounded-lg bg-[var(--color-surface-secondary)] p-3 text-sm ${showSuccess ? "animate-bounce text-green-700" : ""}`}>{showSuccess ? "✓ " : ""}{notice}</p>}
    </div>
  );
}
