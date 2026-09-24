import { ui } from "@/lib/ui-text";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { AppLayout } from "@/components/layout/app-layout";
import { AutoFieldHelp } from "@/components/ui/auto-field-help";
import { HelpTooltipProvider } from "@/components/ui/help-tooltip";
import { restoreAdminSession } from "@/lib/api-client";
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
import { IssuanceRulesPage } from "@/pages/issuance-rules";
import { PermissionsPage } from "@/pages/permissions";
import { PointTypesPage } from "@/pages/point-types";
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
          <Route index element={<DashboardPage />} />
          <Route path="/members" element={<MembersListPage />} />
          <Route path="/members/:id" element={<MemberDetailPage />} />
          <Route path="/member-fields" element={<MemberFieldsPage />} />
          <Route path="/credits" element={<Navigate to="/credits/wallets" replace />} />
          <Route path="/credits/wallets" element={<CreditsManagementPage section="wallets" />} />
          <Route path="/credits/banks" element={<CreditsManagementPage section="banks" />} />
          <Route path="/credits/ledger" element={<CreditsManagementPage section="ledger" />} />
          <Route path="/credits/exchange" element={<CreditsManagementPage section="exchange" />} />
          <Route
            path="/credits/categories"
            element={<CreditsManagementPage section="categories" />}
          />
          <Route path="/credits/import" element={<CreditsManagementPage section="import" />} />
          <Route path="/point-types" element={<PointTypesPage view="registry" />} />
          <Route path="/point-types/new" element={<PointTypesPage view="editor" />} />
          <Route path="/point-types/:id/edit" element={<PointTypesPage view="editor" />} />
          <Route path="/issuance-rules" element={<IssuanceRulesPage />} />
          <Route path="/permissions" element={<PermissionsPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/workflows" element={<WorkflowsPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/campaigns" element={<CampaignsListPage />} />
          <Route path="/campaigns/new" element={<CampaignBuilderPage />} />
          <Route path="/campaigns/:id/edit" element={<CampaignBuilderPage />} />
          <Route path="/event-definitions" element={<EventDefinitionsPage />} />
          <Route path="/coupons" element={<CouponsListPage />} />
          <Route path="/coupons/generate" element={<CouponBulkGeneratePage />} />
          <Route path="/segments" element={<SegmentsListPage />} />
          <Route path="/segments/new" element={<SegmentBuilderPage />} />
          <Route path="/segments/:id/edit" element={<SegmentBuilderPage />} />
          <Route path="/badges" element={<BadgesListPage />} />
          <Route path="/badges/new" element={<BadgeEditorPage />} />
          <Route path="/badges/:id/edit" element={<BadgeEditorPage />} />
          <Route path="/tiers" element={<TiersListPage />} />
          <Route path="/rewards" element={<RewardsListPage />} />
          <Route path="/rewards/new" element={<RewardsEditorPage />} />
          <Route path="/rewards/:id/edit" element={<RewardsEditorPage />} />
          <Route path="/rewards/:id/redemptions" element={<RewardsRedemptionsPage />} />
          <Route path="/coalition" element={<CoalitionConfigPage />} />
          <Route path="/coalition/transactions" element={<CoalitionTransactionsPage />} />
          <Route path="/coalition/members" element={<CoalitionLinkedMembersPage />} />
          <Route path="/giftcards" element={<BatchesListPage />} />
          <Route path="/giftcards/batches/new" element={<BatchWizardPage />} />
          <Route path="/giftcards/batches/:id" element={<BatchDetailPage />} />
          <Route path="/giftcards/cards/:code" element={<CardDetailPage />} />
          <Route path="/giftcards/terms" element={<TermsListPage />} />
          <Route path="/giftcards/terms/new" element={<TermsEditorPage />} />
          <Route path="/giftcards/terms/:id" element={<TermsEditorPage />} />
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
