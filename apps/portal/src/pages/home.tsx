import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, ChevronRight, Gift, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";

import { MemberLoginForm } from "../components/member-login-form";
import { PointTypeIcon } from "../components/point-type-icon";
import { fetchApi } from "../lib/api-client";
import { isAuthenticated } from "../lib/auth";
import type { BadgeProgress, Balance, CampaignClaim, CreditBalance, Reward, TierStatus } from "../types";

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
          <p className="mt-1 text-4xl font-bold text-[var(--color-text)]">{balance.total.toLocaleString()}</p>
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
      <div className="mt-3 flex gap-4 text-xs text-[var(--color-text-secondary)]">
        <span>
          {t("confirmed")}: {balance.confirmed.toLocaleString()}
        </span>
        <span>
          {t("pending")}: {balance.pending.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function TierCard({ tier }: { tier: TierStatus }) {
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
            <span>
              {tier.pointsProgress.toLocaleString()} / {tier.nextTier.minPoints.toLocaleString()}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-border)]">
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-all"
              style={{
                width: `${String(Math.min((tier.pointsProgress / tier.nextTier.minPoints) * 100, 100))}%`,
              }}
            />
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {tier.pointsToNext?.toLocaleString()} {t("pointsToNext")}
          </p>
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

function CampaignClaims({ claims }: { claims: CampaignClaim[] }): JSX.Element | null {
  const queryClient = useQueryClient();
  const claim = useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/members/me/campaign-claims/${id}/claim`, { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["campaign-claims"] }),
        queryClient.invalidateQueries({ queryKey: ["balance"] }),
        queryClient.invalidateQueries({ queryKey: ["credits"] }),
      ]);
    },
  });
  if (claims.length === 0) return null;
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4" aria-labelledby="campaign-claims-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="campaign-claims-heading" className="text-lg font-semibold">{ui("Points waiting for you")}</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{claims.length.toLocaleString()} {ui("pending claims")}</p>
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
      {claim.isError && <p role="alert" className="mt-2 text-sm text-red-700">{claim.error instanceof Error ? claim.error.message : ui("Unable to claim points.")}</p>}
    </section>
  );
}

export default function Home() {
  const { t } = useTranslation();
  const authed = isAuthenticated();

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
    queryKey: ["campaign-claims", "pending"],
    queryFn: () => fetchApi<{ items: CampaignClaim[] }>("/members/me/campaign-claims?status=PENDING&page=1&pageSize=20"),
    enabled: authed,
  });

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold">{t("home")}</h1>

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
          {(balance.isError || tier.isError || rewards.isError || badges.isError || claims.isError) && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {ui("Session expired or account data could not be loaded. Please sign in again from Profile.")}
            </div>
          )}
          {claims.data && <CampaignClaims claims={claims.data.items} />}
          {balance.data && <BalanceCard balance={balance.data} creditWallets={credits.data ?? []} />}
          {tier.data ? <TierCard tier={tier.data} /> : null}
          {rewards.data && rewards.data.length > 0 && <TopRewards rewards={rewards.data} />}
          {badges.data && <BadgePreview badges={badges.data} />}
        </>
      )}
    </div>
  );
}
