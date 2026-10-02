import { useQuery } from "@tanstack/react-query";
import { Award, Bell, BookOpen, BriefcaseBusiness, Gift, Home, MoreHorizontal, Star, User, WalletCards } from "lucide-react";
import { useEffect, useRef, useState, type ElementType } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation } from "react-router-dom";

import { isAuthenticated } from "../../lib/auth";
import { fetchApi } from "../../lib/api-client";
import { useCustomerCopy } from "../../lib/customer-copy";

interface NavItem { to: string; label: string; icon: ElementType; authRequired: boolean }

function useUnreadCount() {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => fetchApi<{ unreadCount: number }>("/members/me/notifications/unread-count"),
    enabled: isAuthenticated(),
    refetchInterval: 30_000,
  }).data?.unreadCount ?? 0;
}

function UnreadBadge({ count }: { count: number }) {
  const copy = useCustomerCopy();
  return count > 0 ? <span className="absolute -right-2 -top-2 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white" aria-label={copy(`${count} unread notifications`, `${count} thông báo chưa đọc`)}>{count > 99 ? "99+" : count}</span> : null;
}

export function NotificationBell() {
  const count = useUnreadCount();
  const copy = useCustomerCopy();
  if (!isAuthenticated()) return null;
  return <Link to="/notifications" className="inline-flex rounded-lg p-3 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] focus-visible:outline focus-visible:outline-2" aria-label={copy(`Notifications, ${count} unread`, `Thông báo, ${count} chưa đọc`)}>
    <span className="relative"><Bell className="h-5 w-5" aria-hidden="true" /><UnreadBadge count={count} /></span>
  </Link>;
}

export default function BottomNav() {
  const { t } = useTranslation();
  const copy = useCustomerCopy();
  const authed = isAuthenticated();
  const unreadCount = useUnreadCount();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const morePanel = useRef<HTMLDivElement>(null);
  const moreContainer = useRef<HTMLLIElement>(null);
  useEffect(() => { setMoreOpen(false); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!moreOpen) return;
    morePanel.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMoreOpen(false); moreButton.current?.focus(); }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreContainer.current?.contains(event.target)) setMoreOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [moreOpen]);

  const items: NavItem[] = [
    { to: "/", label: t("home"), icon: Home, authRequired: false },
    { to: "/credits", label: copy("Points", "Điểm"), icon: WalletCards, authRequired: true },
    { to: "/rewards", label: t("rewards"), icon: Gift, authRequired: true },
    { to: "/projects", label: copy("Projects", "Dự án"), icon: BriefcaseBusiness, authRequired: true },
  ];
  const moreItems: NavItem[] = [
    { to: "/notifications", label: copy("Notifications", "Thông báo"), icon: Bell, authRequired: true },
    { to: "/transactions", label: t("transactions"), icon: Star, authRequired: true },
    { to: "/badges", label: t("badges"), icon: Award, authRequired: true },
    { to: "/profile", label: t("profile"), icon: User, authRequired: false },
    { to: "/document", label: copy("User guide", "Hướng dẫn sử dụng"), icon: BookOpen, authRequired: false },
  ];
  const moreActive = moreItems.some((item) => location.pathname.startsWith(item.to));

  return <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--color-border)] bg-[var(--color-surface)] pb-[env(safe-area-inset-bottom)]" aria-label={copy("Main navigation", "Điều hướng chính")}>
    <ul className="mx-auto flex max-w-3xl">
      {items.filter((item) => !item.authRequired || authed).map((item) => <li key={item.to} className="min-w-0 flex-1">
        <NavLink to={item.to} end={item.to === "/"} className={({ isActive }) => `flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-xs font-medium focus-visible:outline focus-visible:outline-2 ${isActive ? "text-[var(--color-primary)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"}`}>
          <item.icon className="h-5 w-5" aria-hidden="true" /><span>{item.label}</span>
        </NavLink>
      </li>)}
      <li ref={moreContainer} className="min-w-0 flex-1" onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setMoreOpen(false);
      }}>
        <button ref={moreButton} type="button" aria-expanded={moreOpen} aria-controls="customer-more-navigation" onClick={() => setMoreOpen((open) => !open)} className={`flex min-h-16 w-full flex-col items-center justify-center gap-1 px-1 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 ${moreActive || moreOpen ? "text-[var(--color-primary)]" : "text-[var(--color-text-secondary)]"}`}>
          <span className="relative"><MoreHorizontal className="h-5 w-5" aria-hidden="true" /><UnreadBadge count={unreadCount} /></span>{copy("More", "Thêm")}
        </button>
        {moreOpen && <div ref={morePanel} id="customer-more-navigation" className="absolute bottom-full left-3 right-3 mx-auto mb-2 max-h-[70vh] max-w-3xl overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg" aria-label={copy("More pages", "Các trang khác")}>
          {moreItems.filter((item) => !item.authRequired || authed).map((item) => <NavLink key={item.to} to={item.to} onClick={() => setMoreOpen(false)} className={({ isActive }) => `flex min-h-12 items-center gap-3 rounded-lg px-3 py-3 text-sm focus-visible:outline focus-visible:outline-2 ${isActive ? "bg-[var(--color-surface-secondary)] font-semibold text-[var(--color-primary)]" : "hover:bg-[var(--color-surface-secondary)]"}`}>
            <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" /><span className="flex-1">{item.label}</span>
            {item.to === "/notifications" && unreadCount > 0 && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
          </NavLink>)}
        </div>}
      </li>
    </ul>
  </nav>;
}
