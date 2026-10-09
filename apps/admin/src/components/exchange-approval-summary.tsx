import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import i18n from "@/i18n";
import type { ExchangeApprovalRequest } from "@/lib/exchange-approval";

const tr = (en: string, vi: string): string => i18n.language.startsWith("vi") ? vi : en;

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: tr("Pending approval", "Chờ phê duyệt"),
    APPROVED: tr("Approved", "Đã phê duyệt"),
    REJECTED: tr("Rejected", "Đã từ chối"),
    CANCELLED: tr("Cancelled", "Đã hủy"),
    WAITING: tr("Waiting for previous step", "Chờ bước trước"),
    SKIPPED: tr("Skipped", "Đã bỏ qua"),
    APPROVE: tr("Approved", "Đã phê duyệt"),
    REJECT: tr("Rejected", "Đã từ chối"),
  };
  return labels[status] ?? tr("Other status", "Trạng thái khác");
}

function identityLabel(person: { name: string; email: string | null }): string {
  const name = person.name?.trim();
  return name && person.email && name !== person.email
    ? `${name} · ${person.email}`
    : name || person.email || tr("Administrator unavailable", "Không còn thông tin quản trị viên");
}

function modeLabel(step: ExchangeApprovalRequest["steps"][number]): string {
  if (step.approvalMode === "ANY") return tr("One approval required", "Cần một người phê duyệt");
  if (step.approvalMode === "ALL") return tr("Everyone must approve", "Tất cả cần phê duyệt");
  return `${tr("Approvals required", "Số phê duyệt cần có")}: ${step.requiredApprovalCount}`;
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleString(i18n.language);
}

export function ExchangeApprovalSummary({
  request,
  canViewApproval,
  canReviewInbox,
  currentAdminId,
}: {
  request: ExchangeApprovalRequest;
  canViewApproval: boolean;
  canReviewInbox: boolean;
  currentAdminId: string | undefined;
}): JSX.Element {
  useTranslation();
  const steps = [...request.steps].sort((left, right) => left.stepOrder - right.stepOrder);
  const currentStep = request.status === "PENDING"
    ? steps.find((step) => step.stepOrder === request.currentStepOrder && step.status === "PENDING")
    : undefined;
  const canOpenApproval = canViewApproval || Boolean(
    canReviewInbox && currentAdminId && currentStep?.assigneesSnapshot.some((assignee) => assignee.adminId === currentAdminId),
  );

  return (
    <section className="mt-3 space-y-3 rounded-md bg-muted/30 p-3" aria-label={tr("Approval workflow", "Quy trình phê duyệt")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 break-words">
          <p className="font-medium">{tr("Approval workflow", "Quy trình phê duyệt")}: {request.workflowName}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {statusLabel(request.status)}
            {currentStep && ` · ${tr("Current step", "Bước hiện tại")}: ${currentStep.stepOrder}. ${currentStep.name}`}
          </p>
        </div>
        {canOpenApproval && (
          <Button asChild size="sm" variant="outline">
            <Link to={`/approvals?request=${encodeURIComponent(request.id)}`}>
              {request.status === "PENDING"
                ? tr("Review in Approval inbox", "Xem trong hộp thư phê duyệt")
                : tr("View approval request", "Xem yêu cầu phê duyệt")}
            </Link>
          </Button>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">{tr("Progress and decisions", "Tiến trình và quyết định")}</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            {tr("Requested at", "Thời điểm đề nghị")}: {dateLabel(request.requestedAt)}
            {request.resolvedAt && ` · ${tr("Resolved at", "Thời điểm xử lý")}: ${dateLabel(request.resolvedAt)}`}
          </p>
          {request.resolutionComment && (
            <p className="whitespace-pre-wrap break-words">
              {tr("Resolution comment", "Ghi chú xử lý")}: {request.resolutionComment}
            </p>
          )}
          {steps.map((step) => (
            <div key={step.id} className="space-y-2 rounded-md border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words font-medium">{tr("Step", "Bước")} {step.stepOrder}: {step.name}</p>
                <span className="text-xs text-muted-foreground">{statusLabel(step.status)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{modeLabel(step)}</p>
              {(step.openedAt || step.completedAt) && (
                <p className="text-xs text-muted-foreground">
                  {step.openedAt && `${tr("Opened at", "Thời điểm mở bước")}: ${dateLabel(step.openedAt)}`}
                  {step.openedAt && step.completedAt && " · "}
                  {step.completedAt && `${tr("Resolved at", "Thời điểm xử lý")}: ${dateLabel(step.completedAt)}`}
                </p>
              )}
              <div className="text-xs text-muted-foreground">
                <p className="font-medium">{tr("Assigned approvers", "Người được phân công phê duyệt")}</p>
                {step.assigneesSnapshot.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {step.assigneesSnapshot.map((assignee) => <li className="break-words" key={assignee.adminId}>{identityLabel(assignee)}</li>)}
                  </ul>
                ) : <p className="mt-1">{tr("No assigned approvers recorded", "Không có thông tin người được phân công")}</p>}
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{tr("Recorded decisions", "Quyết định đã ghi nhận")}</p>
                {step.decisions.length > 0 ? step.decisions.map((decision) => (
                  <div className="mt-2 space-y-1 border-l-2 pl-3" key={decision.id}>
                    <p className="break-words">{identityLabel(decision.approver)} · {statusLabel(decision.decision)}</p>
                    <p className="text-xs text-muted-foreground">{dateLabel(decision.createdAt)}</p>
                    {decision.comment && <p className="whitespace-pre-wrap break-words text-muted-foreground">{decision.comment}</p>}
                  </div>
                )) : <p className="mt-1 text-xs text-muted-foreground">{tr("No decisions yet", "Chưa có quyết định")}</p>}
              </div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
