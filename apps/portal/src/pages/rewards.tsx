import { useQuery } from "@tanstack/react-query";
import { Gift, Heart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { fetchApi } from "../lib/api-client";
import type { MemberRewardRedemption, PaginatedResponse, Reward } from "../types";

function useWishlist() {
  const read = (): string[] => {
    try {
      return JSON.parse(localStorage.getItem("loyaltyos-wishlist") ?? "[]") as string[];
    } catch {
      return [];
    }
  };

  const toggle = (id: string) => {
    const list = read();
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    localStorage.setItem("loyaltyos-wishlist", JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("loyaltyos:wishlist-updated"));
  };

  const removeUnavailable = (ids: string[]) => {
    const removed = new Set(ids);
    const next = read().filter((id) => !removed.has(id));
    localStorage.setItem("loyaltyos-wishlist", JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("loyaltyos:wishlist-updated"));
  };

  return { read, toggle, removeUnavailable };
}

const WISHLIST_PAGE_SIZE = 24;

export default function Rewards() {
  const { t } = useTranslation();
  const wishlist = useWishlist();
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [redemptionPage, setRedemptionPage] = useState(1);
  const [wishlistOnly, setWishlistOnly] = useState(false);
  const [wishlistIds, setWishlistIds] = useState<string[]>(() => wishlist.read());

  useEffect(() => {
    const handler = () => {
      setWishlistIds(wishlist.read());
      setPage(1);
    };
    window.addEventListener("loyaltyos:wishlist-updated", handler);
    return () => {
      window.removeEventListener("loyaltyos:wishlist-updated", handler);
    };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["rewards", "catalog", category, page, wishlistOnly, wishlistOnly ? wishlistIds : []],
    queryFn: () => {
      const params = new URLSearchParams({
        isActive: "true",
        page: wishlistOnly ? "1" : String(page),
        pageSize: String(WISHLIST_PAGE_SIZE),
      });
      if (category && !wishlistOnly) params.set("category", category);
      if (wishlistOnly) {
        const pageIds = wishlistIds.slice((page - 1) * WISHLIST_PAGE_SIZE, page * WISHLIST_PAGE_SIZE);
        params.set("ids", pageIds.join(","));
      }
      return fetchApi<PaginatedResponse<Reward>>(`/rewards?${params.toString()}`);
    },
  });

  const rewards = useMemo(() => {
    const items = data?.items ?? [];
    if (wishlistOnly) return items.filter((r) => wishlistIds.includes(r.id));
    return items;
  }, [data, wishlistOnly, wishlistIds]);

  useEffect(() => {
    if (!wishlistOnly || !data) return;
    const pageIds = wishlistIds.slice((page - 1) * WISHLIST_PAGE_SIZE, page * WISHLIST_PAGE_SIZE);
    if (pageIds.length === 0) return;
    const availableIds = new Set(data.items.map((reward) => reward.id));
    const unavailableIds = pageIds.filter((id) => !availableIds.has(id));
    if (unavailableIds.length > 0) wishlist.removeUnavailable(unavailableIds);
  }, [data, page, wishlist, wishlistIds, wishlistOnly]);

  const categories = useQuery({
    queryKey: ["rewards", "categories"],
    queryFn: () => fetchApi<string[]>("/rewards/categories"),
  });

  const redemptions = useQuery({
    queryKey: ["reward-redemptions", "me", redemptionPage],
    queryFn: () => fetchApi<PaginatedResponse<MemberRewardRedemption>>(`/members/me/reward-redemptions?page=${String(redemptionPage)}&pageSize=10`),
  });

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("rewardsAvailable")}</h1>
        <button
          onClick={() => {
            setPage(1);
            setWishlistOnly(!wishlistOnly);
          }}
          className={`rounded-lg p-2 transition-colors ${
            wishlistOnly
              ? "bg-[var(--color-primary)] text-white"
              : "text-[var(--color-text-secondary)]"
          }`}
          aria-label={t("wishlist")}
        >
          <Heart className="h-5 w-5" fill={wishlistOnly ? "white" : "none"} />
        </button>
      </div>

      {!wishlistOnly && categories.data && categories.data.length > 0 && (
        <div className="flex gap-2 overflow-x-auto" role="group" aria-label={t("filterAll")}>
          <button
            onClick={() => {
              setCategory("");
              setPage(1);
            }}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              category === ""
                ? "bg-[var(--color-primary)] text-white"
                : "border border-[var(--color-border)] text-[var(--color-text-secondary)]"
            }`}
          >
            {t("filterAll")}
          </button>
          {categories.data.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setCategory(cat);
                setPage(1);
              }}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                category === cat
                  ? "bg-[var(--color-primary)] text-white"
                  : "border border-[var(--color-border)] text-[var(--color-text-secondary)]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-xl bg-[var(--color-surface-secondary)]"
            />
          ))}
        </div>
      ) : rewards.length === 0 ? (
        <div className="py-12 text-center text-[var(--color-text-secondary)]">
          <Gift className="mx-auto h-12 w-12" aria-hidden="true" />
          <p className="mt-2">{t("noRewards")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {rewards.map((reward) => {
            const isWishlisted = wishlistIds.includes(reward.id);
            return (
              <div
                key={reward.id}
                className="relative rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3 transition-shadow hover:shadow-md"
              >
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    wishlist.toggle(reward.id);
                  }}
                  className="absolute right-2 top-2 z-10 rounded-full bg-[var(--color-surface)] p-1 shadow-sm"
                  aria-label={isWishlisted ? t("favorites") : t("wishlist")}
                >
                  <Heart
                    className="h-4 w-4"
                    fill={isWishlisted ? "var(--color-primary)" : "none"}
                    color={isWishlisted ? "var(--color-primary)" : "currentColor"}
                  />
                </button>
                <Link to={`/rewards/${reward.id}`}>
                  {reward.imageUrl ? (
                    <img
                      src={reward.imageUrl}
                      alt=""
                      className="mx-auto h-24 w-full rounded-lg object-cover"
                    />
                  ) : (
                    <div className="mx-auto flex h-24 w-full items-center justify-center rounded-lg bg-[var(--color-border)]">
                      <Gift
                        className="h-10 w-10 text-[var(--color-text-secondary)]"
                        aria-hidden="true"
                      />
                    </div>
                  )}
                  <p className="mt-2 truncate text-sm font-medium">{reward.name}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--color-primary)]">
                      {reward.pointPrices?.[0]
                        ? `${reward.pointPrices[0].amount.toLocaleString()} ${reward.pointPrices[0].pointType.unitLabel}`
                        : `${reward.pointsCost.toLocaleString()} ${t("pointsCost")}`}
                    </span>
                    {reward.stock !== null && reward.stock <= 0 && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-600">
                        {t("outOfStock")}
                      </span>
                    )}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {data && (wishlistOnly ? Math.ceil(wishlistIds.length / WISHLIST_PAGE_SIZE) : data.totalPages) > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="text-[var(--color-primary)] underline disabled:opacity-40">{t("previous")}</button>
          <span>{page} / {wishlistOnly ? Math.ceil(wishlistIds.length / WISHLIST_PAGE_SIZE) : data.totalPages}</span>
          <button type="button" disabled={page >= (wishlistOnly ? Math.ceil(wishlistIds.length / WISHLIST_PAGE_SIZE) : data.totalPages)} onClick={() => setPage((value) => value + 1)} className="text-[var(--color-primary)] underline disabled:opacity-40">{t("next")}</button>
        </div>
      )}

      {redemptions.data && (
        <details className="rounded-2xl border border-[var(--color-border)] p-4">
          <summary className="cursor-pointer list-none text-lg font-semibold">{t("rewarded")}</summary>
          <div className="mt-3 space-y-2">
            {redemptions.data.items.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">{t("noRewarded")}</p>
            ) : (
              redemptions.data.items.map((redemption) => (
                <div
                  key={redemption.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-[var(--color-surface-secondary)] p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{redemption.reward.name}</p>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {redemption.pointsSpent.toLocaleString()} {redemption.pointType?.unitLabel ?? "points"} · {new Date(redemption.redeemedAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border px-2 py-1 text-xs font-semibold">
                    {redemption.fulfillmentStatus}
                  </span>
                </div>
              ))
            )}
          </div>
          {redemptions.data.totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <button type="button" disabled={redemptionPage <= 1} onClick={() => setRedemptionPage((value) => value - 1)} className="text-[var(--color-primary)] underline disabled:opacity-40">{t("previous")}</button>
              <span>{redemptionPage} / {redemptions.data.totalPages}</span>
              <button type="button" disabled={redemptionPage >= redemptions.data.totalPages} onClick={() => setRedemptionPage((value) => value + 1)} className="text-[var(--color-primary)] underline disabled:opacity-40">{t("next")}</button>
            </div>
          )}
        </details>
      )}
    </div>
  );
}
