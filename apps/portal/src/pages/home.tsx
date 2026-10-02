import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, BookOpen, CalendarDays, Check, ChevronRight, Gift, Loader2, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";

import { MemberLoginForm } from "../components/member-login-form";
import { PointTypeIcon } from "../components/point-type-icon";
import { fetchApi, postApi } from "../lib/api-client";
import { isAuthenticated } from "../lib/auth";
import type { BadgeProgress, Balance, CampaignClaim, CreditBalance, Reward, TierStatus } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

interface CheckInCampaignReward {
  id: string;
  name: string;
  points: number;
  issuanceMode: "AUTO" | "CLAIM";
  pointType: { id: string; code: string; name: string; unitLabel: string } | null;
}

interface CheckInEvent {
  key: string;
  name: string;
  timezone: string;
  today: string;
  checkedInDates: string[];
  checkedInToday: boolean;
  canCheckIn: boolean;
  campaigns: CheckInCampaignReward[];
}

interface CheckInResult {
  eventKey: string;
  checkInDate: string;
  alreadyCheckedIn: boolean;
  rewards: Array<{ campaignId: string; campaignName: string; points: number; pointType: string; claimPending: boolean }>;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function contributionWeeks(todayKey: string): Date[][] {
  const today = new Date(`${todayKey}T12:00:00`);
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const weeks: Date[][] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const week: Date[] = [];
    for (let day = 0; day < 7; day += 1) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function checkInDisplayName(name: string): string {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ["daily check-in", "daily check in", "diem danh hang ngay"].includes(normalized)
    ? ui("Daily check-in")
    : name;
}

function CheckInCard({
  event,
  pending,
  notice,
  onCheckIn,
}: {
  event: CheckInEvent;
  pending: boolean;
  notice: string | null;
  onCheckIn: () => void;
}): JSX.Element {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const displayName = checkInDisplayName(event.name);
  const checkedInDates = new Set(event.checkedInDates);
  const weeks = contributionWeeks(event.today);
  const today = new Date(`${event.today}T12:00:00`);
  const firstDay = new Date(today);
  firstDay.setDate(firstDay.getDate() - 364);
  const monthLabels = weeks.flatMap((week, index) => {
    const firstOfMonth = week.find((day) => day.getDate() === 1);
    return firstOfMonth
      ? [{ index, label: firstOfMonth.toLocaleDateString(locale, { month: "short" }) }]
      : [];
  });
  const checkInCount = event.checkedInDates.length;

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4 shadow-sm" aria-label={displayName}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text)]">
            <CalendarDays className="h-5 w-5 text-[var(--color-primary)]" />
            {displayName}
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {event.campaigns.length > 0
              ? event.campaigns.map((campaign) => `${campaign.name}: +${campaign.points.toLocaleString()} ${campaign.pointType?.unitLabel ?? ui("points")}`).join(" · ")
              : ui("No check-in campaign is currently available.")}
          </p>
        </div>
        <button
          type="button"
          onClick={onCheckIn}
          disabled={!event.canCheckIn || pending}
          className="inline-flex shrink-0 items-center rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : event.checkedInToday ? <Check className="mr-2 h-4 w-4" /> : null}
          {event.checkedInToday ? ui("Checked in today") : ui("Check in today")}
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div className="overflow-x-auto pb-1">
          <div
            className="mb-1 grid gap-[3px] pl-0.5 text-[9px] leading-3 text-[var(--color-text-secondary)]"
            style={{ gridTemplateColumns: `repeat(${weeks.length}, 11px)` }}
          >
            {monthLabels.map(({ index, label }) => (
              <span key={`${index}-${label}`} className="whitespace-nowrap" style={{ gridColumn: `${index + 1} / span 4` }}>
                {label}
              </span>
            ))}
          </div>
          <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]" aria-label={ui("Check-in activity over the last year")}>
            {weeks.flatMap((week, weekIndex) => week.map((day) => {
              const key = dateKey(day);
              const isInRange = key >= dateKey(firstDay) && key <= event.today;
              const checkedIn = isInRange && checkedInDates.has(key);
              return (
                <span
                  key={`${weekIndex}-${key}`}
                  title={`${day.toLocaleDateString(locale)}${checkedIn ? ` · ${ui("Checked in")}` : ""}`}
                  aria-label={`${day.toLocaleDateString(locale)}${checkedIn ? ` · ${ui("Checked in")}` : ""}`}
                  className={`h-[11px] w-[11px] rounded-[3px] ${
                    !isInRange
                      ? "bg-transparent"
                      : checkedIn
                        ? "bg-emerald-600 dark:bg-emerald-500"
                        : "bg-[var(--color-border)]"
                  }`}
                />
              );
            }))}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--color-text-secondary)]">
          <span>{checkInCount} {ui("check-in days in the last year")}</span>
          <span className="flex items-center gap-1"><span>{ui("Less")}</span><span className="h-[11px] w-[11px] rounded-[3px] bg-[var(--color-border)]" /><span className="h-[11px] w-[11px] rounded-[3px] bg-emerald-600 dark:bg-emerald-500" /><span>{ui("More")}</span></span>
        </div>
      </div>
      {notice && <p role="status" className="mt-3 text-sm text-[var(--color-primary)]">{notice}</p>}
    </section>
  );
}

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

function BalanceCard({
  balance,
  creditWallets,
}: {
  balance: Balance;
  creditWallets: CreditBalance[];
}) {
  const { t } = useTranslation();
  useExpiryRefresh();
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">{t("balance")}</p>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{ui("Balances are shown separately by point type.")}</p>
        </div>
        <Link to="/credits" className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-surface)]">
          {ui("View details")}
        </Link>
      </div>
      {(balance.wallets ?? []).length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[var(--color-border)] pt-3">
          {(balance.wallets ?? []).map((wallet) => {
            const creditWallet = creditWallets.find((item) => item.pointTypeId === wallet.pointTypeId);
            return (
              <div key={wallet.pointTypeId} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                <p className="flex items-center gap-1 truncate text-xs text-[var(--color-text-secondary)]">
                  <PointTypeIcon icon={wallet.icon ?? creditWallet?.icon} className="h-3.5 w-3.5 shrink-0" />
                  {wallet.name}
                </p>
                <p className="mt-1 text-lg font-semibold text-[var(--color-text)]">{wallet.balance.toLocaleString()}</p>
                <p className="text-[10px] text-[var(--color-text-secondary)]">{wallet.unitLabel}</p>
                {creditWallet && (
                  <p className="mt-1 text-[10px] text-[var(--color-text-secondary)]">
                    {expiryLabel(creditWallet)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TierCard({ tier, pointTypes }: { tier: TierStatus; pointTypes: CreditBalance[] }) {
  const { t } = useTranslation();
  if (!tier.currentTier) return null;
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">{t("yourTier")}</p>
          <p className="mt-1 text-xl font-bold">{tier.currentTier.name}</p>
        </div>
        {tier.currentTier.color && (
          <div
            className="h-10 w-10 rounded-full"
            style={{ backgroundColor: tier.currentTier.color }}
            aria-hidden="true"
          />
        )}
      </div>
      {tier.nextTier ? (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-[var(--color-text-secondary)]">
            <span>{t("progress")}</span>
            <span>{tier.pointsProgress.toLocaleString()}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-border)]">
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-all"
              style={{
                width: `${String(Math.min(Math.max(tier.pointsProgress, 0), 100))}%`,
              }}
            />
          </div>
          {(tier.nextTierProgress ?? []).length > 1 && (
            <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
              {tier.nextTier.qualificationOperator === "OR" ? t("meetAnyTierRequirement") : t("meetAllTierRequirements")}
            </p>
          )}
          {(tier.nextTierProgress ?? []).length > 0 ? (
            <div className="mt-2 space-y-2">
              {tier.nextTierProgress!.map((requirement) => {
                const pointType = pointTypes.find((candidate) => candidate.pointTypeId === requirement.pointTypeId);
                return (
                  <div key={requirement.pointTypeId} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="font-medium text-[var(--color-text)]">{pointType?.name ?? pointType?.code ?? requirement.pointTypeId}</span>
                      <span className="shrink-0 text-[var(--color-text-secondary)]">
                        {requirement.earned.toLocaleString()} / {requirement.required.toLocaleString()} {pointType?.unitLabel ?? ""}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-[var(--color-text-secondary)]">
                      {requirement.remaining.toLocaleString()} {pointType?.unitLabel ?? ""} {t("pointsToNext")}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : tier.pointsToNext !== null ? (
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              {tier.pointsToNext?.toLocaleString()} {t("pointsToNext")}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{t("maxTier")}</p>
      )}
    </div>
  );
}

function TopRewards({ rewards }: { rewards: Reward[] }) {
  const { t } = useTranslation();
  if (rewards.length === 0) return null;
  return (
    <section aria-labelledby="top-rewards-heading">
      <div className="flex items-center justify-between">
        <h2 id="top-rewards-heading" className="text-lg font-semibold">
          {t("rewardsAvailable")}
        </h2>
        <Link to="/rewards" className="flex items-center gap-1 text-sm text-[var(--color-primary)]">
          {t("viewDetails")} <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {rewards.slice(0, 3).map((r) => (
          <Link
            key={r.id}
            to={`/rewards/${r.id}`}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3 transition-shadow hover:shadow-md"
          >
            {r.imageUrl ? (
              <img src={r.imageUrl} alt="" className="mx-auto h-14 w-14 rounded-lg object-cover" />
            ) : (
              <Gift
                className="mx-auto h-14 w-14 text-[var(--color-text-secondary)]"
                aria-hidden="true"
              />
            )}
            <p className="mt-2 truncate text-center text-xs font-medium">{r.name}</p>
            <p className="text-center text-xs text-[var(--color-text-secondary)]">
              {r.pointPrices?.[0]
                ? `${r.pointPrices[0].amount.toLocaleString()} ${r.pointPrices[0].pointType.unitLabel}`
                : `${r.pointsCost.toLocaleString()} ${t("pointsCost")}`}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function BadgePreview({ badges }: { badges: BadgeProgress[] }) {
  const { t } = useTranslation();
  const unlocked = badges.filter((b) => b.unlocked);
  if (unlocked.length === 0) return null;
  return (
    <section aria-labelledby="badges-preview-heading">
      <div className="flex items-center justify-between">
        <h2 id="badges-preview-heading" className="text-lg font-semibold">
          {t("badges")}
        </h2>
        <Link to="/badges" className="flex items-center gap-1 text-sm text-[var(--color-primary)]">
          {t("viewDetails")} <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {unlocked.slice(0, 6).map((b) => (
          <div
            key={b.badge.id}
            className="flex shrink-0 flex-col items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3"
            style={{ width: 80 }}
          >
            {b.badge.imageUrl ? (
              <img
                src={b.badge.imageUrl}
                alt={b.badge.name}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <Award className="h-10 w-10 text-[var(--color-primary)]" aria-hidden="true" />
            )}
            <span className="text-center text-xs font-medium leading-tight">{b.badge.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CampaignClaims({
  claims,
  total,
  page,
  totalPages,
  onPageChange,
}: {
  claims: CampaignClaim[];
  total: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}): JSX.Element | null {
  const queryClient = useQueryClient();
  const claim = useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/members/me/campaign-claims/${id}/claim`, { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["campaign-claims"] }),
        queryClient.invalidateQueries({ queryKey: ["balance"] }),
        queryClient.invalidateQueries({ queryKey: ["credits"] }),
        queryClient.invalidateQueries({ queryKey: ["tier"] }),
      ]);
      if (claims.length <= 1 && page > 1) onPageChange(page - 1);
    },
  });
  if (claims.length === 0) return null;
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4" aria-labelledby="campaign-claims-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="campaign-claims-heading" className="text-lg font-semibold">{ui("Points waiting for you")}</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{total.toLocaleString()} {ui("pending claims")}</p>
        </div>
        <Link to="/notifications" className="text-sm font-medium text-[var(--color-primary)]">{ui("View notifications")}</Link>
      </div>
      <div className="mt-3 max-h-80 divide-y divide-[var(--color-border)] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {claims.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{item.campaign.name}</p>
              <p className="text-sm text-[var(--color-text-secondary)]">{item.pointsAwarded.toLocaleString()} {item.campaign.pointType?.unitLabel ?? ui("points")}</p>
            </div>
            <button
              type="button"
              disabled={claim.isPending}
              onClick={() => claim.mutate(item.id)}
              className="shrink-0 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {claim.isPending ? ui("Claiming…") : ui("Claim points")}
            </button>
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="text-[var(--color-primary)] underline disabled:opacity-40">{ui("Previous")}</button>
          <span className="text-[var(--color-text-secondary)]">{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className="text-[var(--color-primary)] underline disabled:opacity-40">{ui("Next")}</button>
        </div>
      )}
      {claim.isError && <p role="alert" className="mt-2 text-sm text-red-700">{claim.error instanceof Error ? claim.error.message : ui("Unable to claim points.")}</p>}
    </section>
  );
}

export default function Home() {
  const { t, i18n } = useTranslation();
  const authed = isAuthenticated();
  const queryClient = useQueryClient();
  const [checkInNotices, setCheckInNotices] = useState<Record<string, string>>({});
  const [claimPage, setClaimPage] = useState(1);

  const balance = useQuery({
    queryKey: ["balance"],
    queryFn: () => fetchApi<Balance>("/members/me/balance"),
    enabled: authed,
  });
  const credits = useQuery({
    queryKey: ["credits", "balances"],
    queryFn: () => fetchApi<CreditBalance[]>("/members/me/credits"),
    enabled: authed,
  });

  const tier = useQuery({
    queryKey: ["tier"],
    queryFn: () => fetchApi<TierStatus>("/members/me/tier"),
    enabled: authed,
  });

  const rewards = useQuery({
    queryKey: ["rewards", "top"],
    queryFn: () => fetchApi<Reward[]>("/rewards?isActive=true&pageSize=6&page=1"),
    select: (data) => (data as unknown as { items: Reward[] }).items,
    enabled: authed,
  });

  const badges = useQuery({
    queryKey: ["badges"],
    queryFn: () => fetchApi<BadgeProgress[]>("/members/me/badges"),
    enabled: authed,
  });

  const claims = useQuery({
    queryKey: ["campaign-claims", "pending", claimPage],
    queryFn: () => fetchApi<{ items: CampaignClaim[]; total: number; totalPages: number }>(`/members/me/campaign-claims?status=PENDING&page=${String(claimPage)}&pageSize=10`),
    enabled: authed,
  });

  const checkIns = useQuery({
    queryKey: ["member-check-ins"],
    queryFn: () => fetchApi<{ events: CheckInEvent[] }>("/members/me/check-ins"),
    enabled: authed,
  });

  const checkInMutation = useMutation({
    mutationFn: (eventKey: string) => postApi<CheckInResult>(`/members/me/check-ins/${encodeURIComponent(eventKey)}`, {}),
    onSuccess: async (result) => {
      const notice = result.alreadyCheckedIn
        ? ui("You have already checked in today.")
        : result.rewards.some((reward) => reward.claimPending)
          ? ui("Check-in complete. Your points are waiting for you to claim.")
          : ui("Check-in complete. Points have been added to your balance.");
      setCheckInNotices((current) => ({ ...current, [result.eventKey]: notice }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["member-check-ins"] }),
        queryClient.invalidateQueries({ queryKey: ["balance"] }),
        queryClient.invalidateQueries({ queryKey: ["credits", "balances"] }),
        queryClient.invalidateQueries({ queryKey: ["campaign-claims"] }),
        queryClient.invalidateQueries({ queryKey: ["tier"] }),
      ]);
    },
    onError: (_error, eventKey) => {
      setCheckInNotices((current) => ({
        ...current,
        [eventKey]: ui("Check-in failed. Please try again."),
      }));
    },
  });

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("home")}</h1>
        <Link to="/document" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-surface-secondary)]">
          <BookOpen className="h-4 w-4" aria-hidden="true" /> {i18n.resolvedLanguage?.startsWith("en") ? "Guide" : "Hướng dẫn"}
        </Link>
      </div>

      {!authed ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-8 text-center">
          <Star
            className="mx-auto h-12 w-12 text-[var(--color-text-secondary)]"
            aria-hidden="true"
          />
          <p className="mt-4 text-lg font-medium">{t("login")}</p>
          <div className="mt-6 text-left">
            <MemberLoginForm />
          </div>
        </div>
      ) : (
        <>
          {(balance.isError || credits.isError || tier.isError || rewards.isError || badges.isError || claims.isError || checkIns.isError) && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <p>{ui("Some sections could not be loaded. Your session may still be active.")}</p>
              <ul className="mt-2 space-y-1">{[{ label: ui("Balances"), query: balance }, { label: ui("Credits"), query: credits }, { label: t("yourTier"), query: tier }, { label: t("rewards"), query: rewards }, { label: t("badges"), query: badges }, { label: ui("Campaign claims"), query: claims }, { label: ui("Check-in"), query: checkIns }].filter((section) => section.query.isError).map((section) => (
                <li key={section.label} className="flex items-center justify-between gap-3"><span>{section.label}</span><button type="button" disabled={section.query.isFetching} onClick={() => void section.query.refetch()} className="min-h-10 underline">{ui("Try again")}</button></li>
              ))}</ul>
            </div>
          )}
          {claims.data && <CampaignClaims claims={claims.data.items} total={claims.data.total} page={claimPage} totalPages={claims.data.totalPages} onPageChange={setClaimPage} />}
          {checkIns.data?.events.map((event) => (
            <CheckInCard
              key={event.key}
              event={event}
              pending={checkInMutation.isPending && checkInMutation.variables === event.key}
              notice={checkInNotices[event.key] ?? null}
              onCheckIn={() => checkInMutation.mutate(event.key)}
            />
          ))}
          {balance.data && <BalanceCard balance={balance.data} creditWallets={credits.data ?? []} />}
          {tier.data ? <TierCard tier={tier.data} pointTypes={credits.data ?? []} /> : null}
          {rewards.data && rewards.data.length > 0 && <TopRewards rewards={rewards.data} />}
          {badges.data && <BadgePreview badges={badges.data} />}
        </>
      )}
    </div>
  );
}
