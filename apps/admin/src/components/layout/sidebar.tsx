import { useQuery } from "@tanstack/react-query";
import {
  Award,
  BarChart3,
  ChevronDown,
  Gift,
  LayoutDashboard,
  Link2,
  LogOut,
  Megaphone,
  PieChart,
  ShieldCheck,
  Ticket,
  Users,
  WalletCards,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { persistLocale } from "@/i18n";
import { adminLogout, fetchApi, isAdminAuthenticated } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function Sidebar(): JSX.Element {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [creditsOpen, setCreditsOpen] = useState(
    () => location.pathname.startsWith("/credits") || location.pathname.startsWith("/point-types"),
  );
  const authenticated = isAdminAuthenticated();
  const admin = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => fetchApi<{ capabilities: Record<string, boolean> }>("/admin/me"),
    enabled: authenticated,
    staleTime: 30_000,
  });

  const links = [
    {
      to: "/",
      label: t("navigation.dashboard"),
      icon: LayoutDashboard,
      end: true,
      capability: "dashboard.view",
    },
    { to: "/members", label: t("navigation.members"), icon: Users, capability: "member.view" },
    {
      to: "/permissions",
      label: "Roles & Permissions",
      icon: ShieldCheck,
      capability: "permission.manage",
    },
    {
      to: "/campaigns",
      label: t("navigation.campaigns"),
      icon: Megaphone,
      capability: "campaign.view",
    },
    { to: "/coupons", label: t("navigation.coupons"), icon: Ticket, capability: "campaign.view" },
    {
      to: "/segments",
      label: t("navigation.segments"),
      icon: PieChart,
      capability: "campaign.view",
    },
    { to: "/badges", label: t("navigation.badges"), icon: Award, capability: "campaign.view" },
    { to: "/tiers", label: t("navigation.tiers"), icon: BarChart3, capability: "campaign.view" },
    { to: "/rewards", label: t("navigation.rewards"), icon: Gift, capability: "reward.view" },
    {
      to: "/coalition",
      label: t("navigation.coalition"),
      icon: Link2,
      capability: "campaign.view",
    },
    { to: "/giftcards", label: t("navigation.giftcards"), icon: Gift, capability: "reward.view" },
  ].filter(
    ({ capability }) =>
      !authenticated || admin.isLoading || admin.data?.capabilities[capability] !== false,
  );
  const creditLinks = [
    { to: "/credits/wallets", label: "Wallet adjustments", capability: "wallet.view" },
    { to: "/credits/banks", label: "Banks & cycles", capability: "bank.view" },
    { to: "/credits/ledger", label: "Ledger", capability: "wallet.view" },
    { to: "/credits/exchange", label: "Exchange vouchers", capability: "exchange.view" },
    { to: "/credits/categories", label: "Recognition categories", capability: "wallet.view" },
    { to: "/credits/import", label: "Member import", capability: "member.manage" },
    { to: "/point-types", label: "Point type registry", capability: "point_type.view" },
    { to: "/point-types/new", label: "Create point type", capability: "point_type.manage" },
  ].filter(
    ({ capability }) =>
      !authenticated || admin.isLoading || admin.data?.capabilities[capability] !== false,
  );
  const creditSectionActive =
    location.pathname.startsWith("/credits") || location.pathname.startsWith("/point-types");

  function handleLocaleChange(locale: string): void {
    void i18n.changeLanguage(locale);
    persistLocale(locale);
  }

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r bg-background">
      <div className="flex h-14 items-center border-b px-6">
        <span className="text-lg font-semibold">LoyaltyOS</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {links.slice(0, 2).map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
        {creditLinks.length > 0 && (
          <div className="space-y-1">
            <button
              type="button"
              aria-expanded={creditsOpen}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                creditSectionActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              onClick={() => {
                setCreditsOpen((open) => !open);
              }}
            >
              <WalletCards className="h-4 w-4" />
              <span className="flex-1 text-left">Credits & point types</span>
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", creditsOpen && "rotate-180")}
              />
            </button>
            {creditsOpen && (
              <div className="ml-5 space-y-1 border-l pl-3">
                {creditLinks.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === "/point-types"}
                    className={({ isActive }) =>
                      cn(
                        "block rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )
                    }
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}
        {links.slice(2).map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-4 space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("settings.language")}</label>
          <Select value={i18n.language} onValueChange={handleLocaleChange}>
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="es-MX">Español</SelectItem>
              <SelectItem value="en-US">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {authenticated && (
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3 text-sm text-muted-foreground hover:text-accent-foreground"
            onClick={() => {
              void adminLogout();
            }}
          >
            <LogOut className="h-4 w-4" />
            {t("navigation.signOut")}
          </Button>
        )}
      </div>
      <Separator />
    </aside>
  );
}
