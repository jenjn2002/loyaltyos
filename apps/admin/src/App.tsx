import { ui } from "@/lib/ui-text";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { AppLayout } from "@/components/layout/app-layout";
import { AutoFieldHelp } from "@/components/ui/auto-field-help";
import { HelpTooltipProvider } from "@/components/ui/help-tooltip";
import { restoreAdminSession } from "@/lib/api-client";
import { useAdminPermissions } from "@/lib/admin-permissions";
import { ApprovalsPage } from "@/pages/approvals";
import { BadgeEditorPage } from "@/pages/badge-editor";
import { BadgesListPage } from "@/pages/badges-list";
import { CampaignBuilderPage } from "@/pages/campaign-builder";
import { CampaignsListPage } from "@/pages/campaigns-list";
import { CoalitionConfigPage } from "@/pages/coalition/config";
import { CoalitionLinkedMembersPage } from "@/pages/coalition/linked-members";
import { CoalitionTransactionsPage } from "@/pages/coalition/transactions";
import { CouponBulkGeneratePage } from "@/pages/coupon-bulk-generate";
import { CouponsListPage } from "@/pages/coupons-list";
import { CreditsManagementPage } from "@/pages/credits-management";
import { DataExportPage } from "@/pages/data-export";
import { AdminDocumentPage } from "@/pages/document";
import { DashboardPage } from "@/pages/dashboard";
import { EventDefinitionsPage } from "@/pages/event-definitions";
import { BatchDetailPage } from "@/pages/giftcards/batch-detail";
import { BatchWizardPage } from "@/pages/giftcards/batch-wizard";
import { BatchesListPage } from "@/pages/giftcards/batches-list";
import { CardDetailPage } from "@/pages/giftcards/card-detail";
import { TermsEditorPage } from "@/pages/giftcards/terms-editor";
import { TermsListPage } from "@/pages/giftcards/terms-list";
import { LoginPage } from "@/pages/login";
import { LogsPage } from "@/pages/logs";
import { MemberDetailPage } from "@/pages/member-detail";
import { MemberFieldsPage } from "@/pages/member-fields";
import { MembersListPage } from "@/pages/members-list";
import { NotificationTemplatesPage } from "@/pages/notification-templates";
import { IssuanceRulesPage } from "@/pages/issuance-rules";
import { PermissionsPage } from "@/pages/permissions";
import { PointTypesPage } from "@/pages/point-types";
import { ProjectsPage } from "@/pages/projects";
import { RewardsEditorPage } from "@/pages/rewards/rewards-editor";
import { RewardsListPage } from "@/pages/rewards/rewards-list";
import { RewardsRedemptionsPage } from "@/pages/rewards/rewards-redemptions";
import { SegmentBuilderPage } from "@/pages/segment-builder";
import { SegmentsListPage } from "@/pages/segments-list";
import { SettingsPage } from "@/pages/settings";
import { TiersListPage } from "@/pages/tiers-list";
import { WorkflowsPage } from "@/pages/workflows";

function AdminGuard({ children }: { children: ReactNode }): JSX.Element {
  const location = useLocation();
  const [state, setState] = useState<"loading" | "authenticated" | "unauthenticated">("loading");

  useEffect(() => {
    let active = true;
    void restoreAdminSession().then((authenticated) => {
      if (active) setState(authenticated ? "authenticated" : "unauthenticated");
    });
    return () => {
      active = false;
    };
  }, []);

  if (state === "loading") {
    return <div className="flex min-h-screen items-center justify-center">{ui("Loading…")}</div>;
  }
  if (state === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function CapabilityGuard({ anyOf, children }: { anyOf: string[]; children: ReactNode }): JSX.Element {
  const permissions = useAdminPermissions();
  if (permissions.isPending) {
    return <div className="p-6 text-sm text-muted-foreground">{ui("Loading…")}</div>;
  }
  if (!anyOf.some(permissions.can)) {
    return <div role="alert" className="m-6 rounded-md border border-destructive/40 p-4 text-sm text-destructive">{ui("You do not have permission to view this page.")}</div>;
  }
  return <>{children}</>;
}

function permitted(capability: string | string[], page: JSX.Element): JSX.Element {
  return <CapabilityGuard anyOf={Array.isArray(capability) ? capability : [capability]}>{page}</CapabilityGuard>;
}

function AdminHome(): JSX.Element {
  const permissions = useAdminPermissions();
  if (permissions.isPending) return <div className="p-6 text-sm text-muted-foreground">{ui("Loading…")}</div>;
  if (permissions.can("dashboard.view")) return <DashboardPage />;
  const firstAllowed = ([
    ["member.view", "/members"], ["project.view", "/projects"],
    ["wallet.adjust", "/credits/wallets"], ["wallet.view", "/credits/ledger"],
    ["bank.view", "/credits/banks"], ["exchange.view", "/credits/exchange"],
    ["point_type.view", "/point-types"], ["campaign.view", "/campaigns"],
    ["approval.inbox", "/approvals"], ["approval.view", "/approvals"],
    ["reward.view", "/rewards"], ["segment.view", "/segments"],
    ["tier.view", "/tiers"], ["badge.view", "/badges"],
    ["coupon.view", "/coupons"], ["event.view", "/event-definitions"],
    ["workflow.view", "/workflows"], ["notification.view", "/notification-templates"],
    ["settings.view", "/settings"], ["audit.view", "/logs"],
    ["documentation.view", "/document"], ["permission.manage", "/permissions"],
  ] as const).find(([capability]) => permissions.can(capability));
  return firstAllowed
    ? <Navigate to={firstAllowed[1]} replace />
    : <div role="alert" className="m-6 rounded-md border p-4 text-sm">{ui("You do not have permission to view this page.")}</div>;
}

export function App(): JSX.Element {
  return (
    <HelpTooltipProvider>
      <AutoFieldHelp />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <AdminGuard>
              <AppLayout />
            </AdminGuard>
          }
        >
          <Route index element={<AdminHome />} />
          <Route path="/document" element={permitted("documentation.view", <AdminDocumentPage />)} />
          <Route path="/members" element={permitted("member.view", <MembersListPage />)} />
          <Route path="/projects" element={permitted("project.view", <ProjectsPage />)} />
          <Route path="/exports" element={permitted(["member.view", "wallet.view", "bank.view", "exchange.view", "point_type.view", "issuance.view", "campaign.view", "event.view", "coupon.view", "reward.view", "segment.view", "tier.view", "badge.view", "approval.view", "workflow.view", "audit.view", "notification.view", "giftcard.view", "coalition.view", "project.view", "recognition.view"], <DataExportPage />)} />
          <Route path="/members/:id" element={permitted("member.view", <MemberDetailPage />)} />
          <Route path="/member-fields" element={permitted("member.manage", <MemberFieldsPage />)} />
          <Route path="/credits" element={<Navigate to="/credits/wallets" replace />} />
          <Route path="/credits/wallets" element={permitted("wallet.adjust", <CreditsManagementPage section="wallets" />)} />
          <Route path="/credits/banks" element={permitted("bank.view", <CreditsManagementPage section="banks" />)} />
          <Route path="/credits/ledger" element={permitted("wallet.view", <CreditsManagementPage section="ledger" />)} />
          <Route path="/credits/exchange" element={permitted("exchange.view", <CreditsManagementPage section="exchange" />)} />
          <Route
            path="/credits/categories"
            element={permitted("recognition.view", <CreditsManagementPage section="categories" />)}
          />
          <Route path="/credits/import" element={permitted("member.manage", <CreditsManagementPage section="import" />)} />
          <Route path="/point-types" element={permitted("point_type.view", <PointTypesPage view="registry" />)} />
          <Route path="/point-types/new" element={permitted("point_type.manage", <PointTypesPage view="editor" />)} />
          <Route path="/point-types/:id/edit" element={permitted("point_type.manage", <PointTypesPage view="editor" />)} />
          <Route path="/issuance-rules" element={permitted("issuance.view", <IssuanceRulesPage />)} />
          <Route path="/permissions" element={permitted("permission.manage", <PermissionsPage />)} />
          <Route path="/logs" element={permitted("audit.view", <LogsPage />)} />
          <Route path="/settings" element={permitted("settings.view", <SettingsPage />)} />
          <Route path="/workflows" element={permitted("workflow.view", <WorkflowsPage />)} />
          <Route path="/approvals" element={permitted(["approval.inbox", "approval.view"], <ApprovalsPage />)} />
          <Route path="/campaigns" element={permitted("campaign.view", <CampaignsListPage />)} />
          <Route path="/campaigns/new" element={permitted("campaign.manage", <CampaignBuilderPage />)} />
          <Route path="/campaigns/:id/edit" element={permitted("campaign.manage", <CampaignBuilderPage />)} />
          <Route path="/event-definitions" element={permitted("event.view", <EventDefinitionsPage />)} />
          <Route path="/notification-templates" element={permitted("notification.view", <NotificationTemplatesPage />)} />
          <Route path="/coupons" element={permitted("coupon.view", <CouponsListPage />)} />
          <Route path="/coupons/generate" element={permitted("coupon.manage", <CouponBulkGeneratePage />)} />
          <Route path="/segments" element={permitted("segment.view", <SegmentsListPage />)} />
          <Route path="/segments/new" element={permitted("segment.manage", <SegmentBuilderPage />)} />
          <Route path="/segments/:id/edit" element={permitted("segment.manage", <SegmentBuilderPage />)} />
          <Route path="/badges" element={permitted("badge.view", <BadgesListPage />)} />
          <Route path="/badges/new" element={permitted("badge.manage", <BadgeEditorPage />)} />
          <Route path="/badges/:id/edit" element={permitted("badge.manage", <BadgeEditorPage />)} />
          <Route path="/tiers" element={permitted("tier.view", <TiersListPage />)} />
          <Route path="/rewards" element={permitted("reward.view", <RewardsListPage />)} />
          <Route path="/rewards/new" element={permitted("reward.manage", <RewardsEditorPage />)} />
          <Route path="/rewards/:id/edit" element={permitted("reward.manage", <RewardsEditorPage />)} />
          <Route path="/rewards/:id/redemptions" element={permitted("reward.view", <RewardsRedemptionsPage />)} />
          <Route path="/coalition" element={permitted("coalition.view", <CoalitionConfigPage />)} />
          <Route path="/coalition/transactions" element={permitted("coalition.view", <CoalitionTransactionsPage />)} />
          <Route path="/coalition/members" element={permitted("coalition.view", <CoalitionLinkedMembersPage />)} />
          <Route path="/giftcards" element={permitted("giftcard.view", <BatchesListPage />)} />
          <Route path="/giftcards/batches/new" element={permitted("giftcard.manage", <BatchWizardPage />)} />
          <Route path="/giftcards/batches/:id" element={permitted("giftcard.view", <BatchDetailPage />)} />
          <Route path="/giftcards/cards/:code" element={permitted("giftcard.view", <CardDetailPage />)} />
          <Route path="/giftcards/terms" element={permitted("giftcard.view", <TermsListPage />)} />
          <Route path="/giftcards/terms/new" element={permitted("giftcard.manage", <TermsEditorPage />)} />
          <Route path="/giftcards/terms/:id" element={permitted("giftcard.manage", <TermsEditorPage />)} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </HelpTooltipProvider>
  );
}

function NotFound(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="mt-2 text-muted-foreground">{t("navigation.pageNotFound")}</p>
        <Link to="/" className="mt-4 inline-block text-primary underline">
          {t("navigation.backToDashboard")}
        </Link>
      </div>
    </div>
  );
}
