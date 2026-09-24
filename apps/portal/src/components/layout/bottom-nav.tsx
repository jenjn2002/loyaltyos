import { ui } from "@/lib/ui-text";
import { useQuery } from "@tanstack/react-query";
import { Award, Bell, Gift, Home, Star, User, WalletCards } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import { isAuthenticated } from "../../lib/auth";
import { fetchApi } from "../../lib/api-client";

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  authRequired: boolean;
}

export default function BottomNav() {
  const { t } = useTranslation();
  const authed = isAuthenticated();
  const unreadNotifications = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => fetchApi<{ unreadCount: number }>("/members/me/notifications/unread-count"),
    enabled: authed,
    refetchInterval: 30_000,
  });
  const unreadCount = unreadNotifications.data?.unreadCount ?? 0;

  const items: NavItem[] = [
    { to: "/", label: t("home"), icon: Home, authRequired: false },
    { to: "/transactions", label: t("transactions"), icon: Star, authRequired: true },
    { to: "/credits", label: "Credits", icon: WalletCards, authRequired: true },
    { to: "/notifications", label: ui("Notifications"), icon: Bell, authRequired: true },
    { to: "/rewards", label: t("rewards"), icon: Gift, authRequired: true },
    { to: "/badges", label: t("badges"), icon: Award, authRequired: true },
    { to: "/profile", label: t("profile"), icon: User, authRequired: false },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--color-border)] bg-[var(--color-surface)]"
      role="navigation"
      aria-label={t("profile")}
    >
      <ul className="mx-auto flex max-w-lg justify-around">
        {items.map((item) => {
          if (item.authRequired && !authed) return null;
          return (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 px-3 py-2 text-xs font-medium transition-colors ${
                    isActive
                      ? "text-[var(--color-primary)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                  }`
                }
                end={item.to === "/"}
              >
                <span className="relative">
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                  {item.to === "/notifications" && unreadCount > 0 && (
                    <span className="absolute -right-2 -top-2 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white" aria-label={`${unreadCount} unread notifications`}>
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </span>
                <span>{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
