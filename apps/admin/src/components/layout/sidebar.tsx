import { ui } from "@/lib/ui-text";
import { useQuery } from "@tanstack/react-query";
import {
  Award,
  BarChart3,
  ChevronDown,
  Gift,
  History,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PieChart,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  Users,
  WalletCards,
  Workflow,
  Zap,
  type LucideIcon,
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

import { useAdminNotifications } from "./admin-notification-context";

interface SidebarItem {
  to: string;
  label: string;
  icon?: LucideIcon;
  end?: boolean;
  capability: string;
  badgeCount?: number;
}

function SidebarLink({ item, nested = false }: { item: SidebarItem; nested?: boolean }): JSX.Element {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          nested
            ? "block rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            : "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )
      }
    >
      {Icon && !nested && <Icon className="h-4 w-4" />}
      <span className="flex-1">{item.label}</span>
      {item.badgeCount !== undefined && item.badgeCount > 0 && (
        <span className="ml-2 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white" aria-label={`${item.badgeCount} pending approvals`}>
          {item.badgeCount > 99 ? "99+" : item.badgeCount}
        </span>
      )}
    </NavLink>
  );
}

function SidebarDropdown({
  label,
  icon: Icon,
  items,
  open,
  active,
  onToggle,
  notificationCount = 0,
}: {
  label: string;
  icon: LucideIcon;
  items: SidebarItem[];
  open: boolean;
  active: boolean;
  onToggle: () => void;
  notificationCount?: number;
}): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
        onClick={onToggle}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-left">{label}</span>
        {notificationCount > 0 && <span className="h-2 w-2 rounded-full bg-red-600" aria-label={`${notificationCount} pending approvals`} />}
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="ml-5 space-y-1 border-l pl-3">
          {items.map((item) => (
            <SidebarLink key={item.to} item={item} nested />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar(): JSX.Element {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [membersOpen, setMembersOpen] = useState(
    () =>
      location.pathname.startsWith("/members") ||
      location.pathname.startsWith("/member-fields") ||
      location.pathname.startsWith("/credits/import"),
  );
  const [automationOpen, setAutomationOpen] = useState(
    () =>
      location.pathname.startsWith("/workflows") ||
      location.pathname.startsWith("/event-definitions") ||
      location.pathname.startsWith("/credits/categories") ||
      location.pathname.startsWith("/settings"),
  );
  const [campaignsOpen, setCampaignsOpen] = useState(
    () =>
      location.pathname.startsWith("/campaigns") ||
      location.pathname.startsWith("/coupons") ||
      location.pathname.startsWith("/rewards"),
  );
  const [approvalsOpen, setApprovalsOpen] = useState(
    () => location.pathname.startsWith("/approvals") || location.pathname.startsWith("/credits/exchange"),
  );
  const [creditsOpen, setCreditsOpen] = useState(
    () =>
      location.pathname.startsWith("/credits") ||
      location.pathname.startsWith("/point-types") ||
      location.pathname.startsWith("/issuance-rules"),
  );
  const authenticated = isAdminAuthenticated();
  const { unreadCount: pendingApprovalCount } = useAdminNotifications();
  const admin = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => fetchApi<{ capabilities: Record<string, boolean> }>("/admin/me"),
    enabled: authenticated,
    staleTime: 30_000,
  });
  const canSee = ({ capability }: SidebarItem): boolean =>
    !authenticated || admin.isLoading || admin.data?.capabilities[capability] !== false;
  const filterLinks = (items: SidebarItem[]): SidebarItem[] => items.filter(canSee);
  const links = filterLinks([
    {
      to: "/",
      label: t("navigation.dashboard"),
      icon: LayoutDashboard,
      end: true,
      capability: "dashboard.view",
    },
    {
      to: "/permissions",
      label: t("navigation.rolesPermissions"),
      icon: ShieldCheck,
      capability: "permission.manage",
    },
    { to: "/logs", label: ui("Logs"), icon: History, capability: "audit.view" },
    { to: "/segments", label: t("navigation.segments"), icon: PieChart, capability: "segment.view" },
    { to: "/badges", label: t("navigation.badges"), icon: Award, capability: "badge.view" },
    { to: "/tiers", label: t("navigation.tiers"), icon: BarChart3, capability: "tier.view" },
  ]);
  const membersLinks = filterLinks([
    { to: "/members", label: t("navigation.members"), icon: Users, capability: "member.view" },
    { to: "/member-fields", label: ui("Member fields"), icon: SlidersHorizontal, capability: "member.manage" },
    { to: "/credits/import", label: ui("Member import"), capability: "member.manage" },
  ]);
  const automationLinks = filterLinks([
    {
      to: "/settings",
      label: t("navigation.settings"),
      icon: Settings,
      capability: "settings.view",
    },
    {
      to: "/workflows",
      label: t("navigation.workflows"),
      icon: Workflow,
      capability: "workflow.view",
    },
    { to: "/event-definitions", label: ui("Event definitions"), icon: Zap, capability: "event.view" },
    { to: "/credits/categories", label: ui("Recognition categories"), capability: "recognition.view" },
  ]);
  const campaignLinks = filterLinks([
    {
      to: "/campaigns",
      label: t("navigation.campaigns"),
      icon: Megaphone,
      capability: "campaign.view",
    },
    { to: "/coupons", label: t("navigation.coupons"), icon: Ticket, capability: "coupon.view" },
    { to: "/rewards", label: t("navigation.rewards"), icon: Gift, capability: "reward.view" },
  ]);
  const approvalLinks = filterLinks([
    {
      to: "/approvals",
      label: t("navigation.approvalInbox"),
      icon: ShieldCheck,
      capability: "approval.inbox",
      badgeCount: pendingApprovalCount,
    },
    { to: "/credits/exchange", label: ui("Exchange vouchers"), capability: "exchange.view" },
  ]);
  const creditLinks = filterLinks([
    { to: "/credits/wallets", label: ui("Wallet adjustments"), capability: "wallet.view" },
    { to: "/credits/banks", label: ui("Banks & cycles"), capability: "bank.view" },
    { to: "/credits/ledger", label: "Ledger", capability: "wallet.view" },
    { to: "/point-types", label: ui("Point type registry"), capability: "point_type.view", end: true },
    { to: "/point-types/new", label: ui("Create point type"), capability: "point_type.manage" },
    { to: "/issuance-rules", label: ui("Point issuance"), capability: "issuance.view" },
  ]);
  const membersSectionActive =
    location.pathname.startsWith("/members") ||
    location.pathname.startsWith("/member-fields") ||
    location.pathname.startsWith("/credits/import");
  const automationSectionActive =
    location.pathname.startsWith("/workflows") ||
    location.pathname.startsWith("/event-definitions") ||
    location.pathname.startsWith("/credits/categories") ||
    location.pathname.startsWith("/settings");
  const campaignsSectionActive =
    location.pathname.startsWith("/campaigns") ||
    location.pathname.startsWith("/coupons") ||
    location.pathname.startsWith("/rewards");
  const approvalsSectionActive =
    location.pathname.startsWith("/approvals") || location.pathname.startsWith("/credits/exchange");
  const creditSectionActive =
    location.pathname.startsWith("/credits") ||
    location.pathname.startsWith("/point-types") ||
    location.pathname.startsWith("/issuance-rules");

  function handleLocaleChange(locale: string): void {
    void i18n.changeLanguage(locale);
    persistLocale(locale);
  }

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r bg-background">
      <div className="flex h-14 items-center border-b px-6">
        <span className="text-lg font-semibold">{ui("LoyaltyOS")}</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {links
          .filter(({ to }) => to === "/" || to === "/permissions")
          .map((item) => <SidebarLink key={item.to} item={item} />)}
        <SidebarDropdown
          label={ui("Members")}
          icon={Users}
          items={membersLinks}
          open={membersOpen}
          active={membersSectionActive}
          onToggle={() => {
            setMembersOpen((open) => !open);
          }}
        />
        <SidebarDropdown
          label={ui("Credits & point types")}
          icon={WalletCards}
          items={creditLinks}
          open={creditsOpen}
          active={creditSectionActive}
          onToggle={() => {
            setCreditsOpen((open) => !open);
          }}
        />
        <SidebarDropdown
          label={ui("Campaigns & rewards")}
          icon={Megaphone}
          items={campaignLinks}
          open={campaignsOpen}
          active={campaignsSectionActive}
          onToggle={() => {
            setCampaignsOpen((open) => !open);
          }}
        />
        <SidebarDropdown
          label={ui("Automation & governance")}
          icon={Workflow}
          items={automationLinks}
          open={automationOpen}
          active={automationSectionActive}
          onToggle={() => {
            setAutomationOpen((open) => !open);
          }}
        />
          <SidebarDropdown
            label={ui("Approvals & exchange")}
            icon={ShieldCheck}
            items={approvalLinks}
            open={approvalsOpen}
            active={approvalsSectionActive}
            notificationCount={pendingApprovalCount}
            onToggle={() => {
            setApprovalsOpen((open) => !open);
          }}
        />
        {links
          .filter(({ to }) => !["/", "/permissions"].includes(to))
          .map((item) => <SidebarLink key={item.to} item={item} />)}
      </nav>
      <div className="border-t p-4 space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("settings.language")}</label>
          <Select value={i18n.language} onValueChange={handleLocaleChange}>
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vi-VN">{t("settings.languages.vietnamese")}</SelectItem>
              <SelectItem value="en-US">{t("settings.languages.english")}</SelectItem>
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
