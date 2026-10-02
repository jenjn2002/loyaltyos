import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { useAdminNotifications } from "@/components/layout/admin-notification-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import i18n from "@/i18n";
import { fetchApi } from "@/lib/api-client";
import { ui } from "@/lib/ui-text";

const tr = (en: string, vi: string): string => i18n.language.startsWith("vi") ? vi : en;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";
const number = (value: unknown): string => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(i18n.language) : "—";
const date = (value: unknown): string => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(i18n.language) : "—";
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : [];
const unavailable = (): string => tr("No longer available", "Không còn thông tin");

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: tr("Pending approval", "Chờ phê duyệt"), APPROVED: tr("Approved", "Đã phê duyệt"),
    REJECTED: tr("Rejected", "Đã từ chối"), CANCELLED: tr("Cancelled", "Đã hủy"),
    WAITING: tr("Waiting for previous step", "Chờ bước trước"), SKIPPED: tr("Skipped", "Đã bỏ qua"),
    APPROVE: tr("Approved", "Đã phê duyệt"), REJECT: tr("Rejected", "Đã từ chối"),
  };
  return labels[status] ?? tr("Other status", "Trạng thái khác");
}
function actionLabel(request: ApprovalRequest): string {
  const labels: Record<string, string> = {
    CAMPAIGN_ISSUANCE_PROPOSAL: tr("Campaign approval", "Phê duyệt chiến dịch"),
    POINT_ISSUANCE_PROPOSAL: tr("Point grant approval", "Phê duyệt cấp điểm"),
    PROJECT_PLAN_APPROVAL: tr("Project plan approval", "Phê duyệt kế hoạch dự án"),
    PROJECT_POINT_ISSUANCE: tr("Project point distribution", "Phân bổ điểm dự án"),
    POINT_EXCHANGE: tr("Point exchange approval", "Phê duyệt đổi điểm"),
    REWARD_REDEMPTION: tr("Reward redemption approval", "Phê duyệt đổi phần thưởng"),
  };
  return labels[request.actionKey] ?? request.workflow.name;
}
function title(request: ApprovalRequest): string {
  const payload = request.payload ?? {};
  return text(payload.projectName) || text(payload.name) || text(payload.documentNumber)
    || request.display?.member?.name || actionLabel(request);
}
interface Identity { name: string; email: string | null }
interface Decision {
  id: string; decision: "APPROVE" | "REJECT"; comment: string | null; createdAt: string;
  approver: { id: string; name: string; email: string; role: string };
}
interface RequestStep {
  id: string; stepOrder: number; name: string; approvalMode: "ANY" | "ALL" | "COUNT";
  requiredApprovalCount: number; status: "WAITING" | "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED";
  assigneesSnapshot: { adminId: string; name: string; email: string; role: string }[];
  decisions: Decision[];
}
interface ApprovalRequest {
  payload?: Record<string, unknown>; id: string; actionKey: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; subjectType: string; subjectId: string;
  requestedByType: string; requestedById: string; requestedAt: string; currentStepOrder: number | null;
  workflow: { actionKey: string; name: string }; steps: RequestStep[];
  display?: { requester: Identity | null; member: Identity | null; pointType: { name: string; code: string } | null; segmentName: string | null; eventName: string | null };
}
interface AdminMe { id: string; capabilities?: Record<string, boolean> }

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{children}</dd></div>;
}

function ProposalSummary({ request }: { request: ApprovalRequest }): JSX.Element {
  const p = request.payload ?? {};
  const d = request.display;
  const campaign = request.actionKey === "CAMPAIGN_ISSUANCE_PROPOSAL";
  const budgets = list(p.requestedBudgets);
  const allocations = list(p.allocations);
  const fields = Object.entries(record(p.fieldValues));
  return <section className="space-y-4 rounded-lg border p-4" aria-label={tr("Request summary", "Tóm tắt yêu cầu")}>
    <div><h3 className="font-semibold">{tr("Request summary", "Tóm tắt yêu cầu")}</h3><p className="mt-1 text-xs text-muted-foreground">{tr("Amounts and conditions below are from the submitted request.", "Số điểm và điều kiện dưới đây được lưu tại thời điểm gửi yêu cầu.")}</p></div>
    <dl className="grid gap-4 sm:grid-cols-2">
      {d?.member && <Field label={tr("Recipient", "Người nhận")}>{d.member.name}<span className="block text-xs font-normal text-muted-foreground">{d.member.email}</span></Field>}
      {Boolean(p.pointTypeId) && <Field label={tr("Point type", "Loại điểm")}>{d?.pointType ? d.pointType.name + " (" + d.pointType.code + ")" : unavailable()}</Field>}
      {typeof p.amount === "number" && <Field label={campaign ? tr("Points per award", "Điểm mỗi lượt nhận") : tr("Points", "Số điểm")}>{number(p.amount)}</Field>}
      {campaign && <>
        <Field label={tr("Trigger event", "Sự kiện kích hoạt")}>{d?.eventName || text(p.eventType) || "—"}</Field>
        <Field label={tr("Audience", "Đối tượng nhận điểm")}>{p.segmentId ? d?.segmentName || unavailable() : tr("All eligible members", "Tất cả thành viên đủ điều kiện")}</Field>
        <Field label={tr("Delivery", "Cách nhận điểm")}>{p.issuanceMode === "CLAIM" ? tr("Members claim their points", "Thành viên tự nhận điểm") : p.issuanceMode === "AUTO" ? tr("Automatic allocation", "Tự động phân bổ") : tr("See technical details", "Xem chi tiết kỹ thuật")}</Field>
        <Field label={tr("Budget limit", "Giới hạn ngân sách")}>{p.maxBudget == null ? tr("Unlimited", "Không giới hạn") : number(p.maxBudget)}</Field>
        <Field label={tr("Maximum awards per member", "Số lượt nhận tối đa mỗi thành viên")}>{p.maxUsesPerMember == null ? tr("Unlimited", "Không giới hạn") : number(p.maxUsesPerMember)}</Field>
        <Field label={tr("Schedule", "Thời gian áp dụng")}>{p.startsAt || p.endsAt ? (p.startsAt ? date(p.startsAt) : tr("No start date", "Không giới hạn ngày bắt đầu")) + " – " + (p.endsAt ? date(p.endsAt) : tr("No end date", "Không giới hạn ngày kết thúc")) : tr("No date restriction", "Không giới hạn ngày")}</Field>
      </>}
      {typeof p.valueMinor === "number" && <Field label={tr("Exchange value", "Giá trị quy đổi")}>{(p.valueMinor / 100).toLocaleString(i18n.language)} {text(p.currency)}</Field>}
      {Boolean(p.expiresAt) && <Field label={tr("Expires at", "Hết hạn lúc")}>{date(p.expiresAt)}</Field>}
    </dl>
    {text(p.description) && <div><h4 className="text-sm font-medium">{tr("Description", "Mô tả")}</h4><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{text(p.description)}</p></div>}
    {text(p.reason) && <div className="rounded-md bg-muted/50 p-3"><h4 className="text-sm font-medium">{tr("Justification", "Lý do đề xuất")}</h4><p className="mt-1 whitespace-pre-wrap text-sm">{text(p.reason)}</p></div>}
    {budgets.length > 0 && <div><h4 className="mb-2 text-sm font-medium">{tr("Requested project budget", "Ngân sách dự án đề nghị")}</h4><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">{tr("Point type", "Loại điểm")}</th><th className="py-2 text-right">{tr("Requested points", "Số điểm đề nghị")}</th></tr></thead><tbody>{budgets.map((budget, index) => <tr className="border-b" key={index}><td className="py-2">{text(budget.pointType) || text(budget.code) || unavailable()}</td><td className="py-2 text-right tabular-nums">{number(budget.amount)}</td></tr>)}</tbody></table></div></div>}
    {allocations.length > 0 && <div><h4 className="mb-2 text-sm font-medium">{tr("Proposed member allocations", "Phân bổ đề nghị cho thành viên")}</h4><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">{tr("Member", "Thành viên")}</th><th className="px-3 py-2">{tr("Point type", "Loại điểm")}</th><th className="py-2 text-right">{tr("Points", "Số điểm")}</th></tr></thead><tbody>{allocations.map((line, index) => <tr className="border-b" key={index}><td className="py-2">{text(line.member) || text(line.email) || unavailable()}<span className="block text-xs text-muted-foreground">{text(line.email)}</span></td><td className="px-3 py-2">{text(line.pointType) || text(line.pointTypeCode) || unavailable()}</td><td className="py-2 text-right tabular-nums">{number(line.amount)}</td></tr>)}</tbody></table></div><p className="mt-2 text-xs text-muted-foreground">{tr("Different point types remain separate; amounts are not combined.", "Các loại điểm được tính riêng, không cộng gộp số điểm khác loại.")}</p></div>}
    {fields.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-medium">{tr("Additional project information", "Thông tin bổ sung của dự án")}</summary><dl className="mt-3 grid gap-3 sm:grid-cols-2">{fields.map(([key, value]) => <Field key={key} label={key.replace(/[_-]/g, " ")}>{Array.isArray(value) ? value.filter((item) => typeof item === "string" || typeof item === "number").join(", ") : typeof value === "boolean" ? value ? tr("Yes", "Có") : tr("No", "Không") : typeof value === "string" || typeof value === "number" ? String(value) : "—"}</Field>)}</dl></details>}
    {!campaign && !budgets.length && !allocations.length && !p.amount && !p.description && !p.reason && <p className="text-sm text-muted-foreground">{tr("This request has no additional summary. Its original data is available in Technical details below.", "Yêu cầu này chưa có tóm tắt bổ sung. Có thể xem dữ liệu gốc trong Chi tiết kỹ thuật bên dưới.")}</p>}
  </section>;
}

export function ApprovalsPage(): JSX.Element {
  useTranslation();
  const queryClient = useQueryClient();
  const { markRead } = useAdminNotifications();
  const [tab, setTab] = useState<"inbox" | "history">("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const handledLink = useRef<string | null>(null);
  const currentAdmin = useQuery({ queryKey: ["admin", "me"], queryFn: () => fetchApi<AdminMe>("/admin/me") });
  const inbox = useQuery({ queryKey: ["admin", "approvals", "inbox"], queryFn: () => fetchApi<ApprovalRequest[]>("/admin/approvals/inbox") });
  const history = useQuery({ queryKey: ["admin", "approvals", "history"], queryFn: () => fetchApi<ApprovalRequest[]>("/admin/approvals/history"), enabled: tab === "history" });
  useEffect(() => {
    const requestId = searchParams.get("request");
    if (!requestId) { handledLink.current = null; return; }
    if (handledLink.current === requestId || !inbox.data) return;
    handledLink.current = requestId;
    setTab(inbox.data.some((request) => request.id === requestId) ? "inbox" : "history");
    setSelectedId(requestId);
    setComment("");
  }, [inbox.data, searchParams]);
  const detail = useQuery({ queryKey: ["admin", "approval", selectedId], queryFn: () => fetchApi<ApprovalRequest>("/admin/approvals/" + selectedId), enabled: Boolean(selectedId) });
  const decide = useMutation({
    mutationFn: ({ id, decision, comment: decisionComment }: { id: string; decision: "approve" | "reject"; comment: string }) =>
      fetchApi<ApprovalRequest>("/admin/approvals/" + id + "/" + decision, { method: "POST", body: JSON.stringify({ comment: decisionComment.trim() || undefined }) }),
    onSuccess: async (request) => {
      setComment("");
      setNotice(request.status === "PENDING" ? tr("Your decision was recorded. The request is waiting for the remaining approvals.", "Đã ghi nhận quyết định. Yêu cầu đang chờ các phê duyệt còn lại.") : statusLabel(request.status));
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin", "approvals"] }), queryClient.invalidateQueries({ queryKey: ["admin", "approval", request.id] })]);
    },
    onError: (error: Error) => { setNotice(error.message); },
  });
  const source = tab === "inbox" ? inbox : history;
  const rows = source.data ?? [];
  const selected = detail.data;
  const activeStep = selected?.steps.find((step) => step.status === "PENDING");
  const canDecide = Boolean(activeStep && currentAdmin.data?.id && currentAdmin.data.capabilities?.["approval.decide"] && activeStep.assigneesSnapshot.some((assignee) => assignee.adminId === currentAdmin.data?.id) && !activeStep.decisions.some((decision) => decision.approver.id === currentAdmin.data?.id));
  const changeTab = (next: "inbox" | "history"): void => {
    setTab(next); setSelectedId(null); setComment(""); setNotice(null);
    if (searchParams.has("request")) { const params = new URLSearchParams(searchParams); params.delete("request"); setSearchParams(params, { replace: true }); }
  };
  return <div className="space-y-6">
    <header><h1 className="flex items-center gap-2 text-3xl font-bold"><Clock3 />{ui("Approval inbox")}</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{tr("Review who requested the change, what it affects, and why before making a decision.", "Xem người đề nghị, nội dung thay đổi và lý do trước khi quyết định.")}</p></header>
    {notice && <div role="status" className="rounded-md border bg-muted p-3 text-sm">{notice}</div>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2"><div className="flex gap-2"><Button disabled={decide.isPending} variant={tab === "inbox" ? "default" : "ghost"} onClick={() => changeTab("inbox")}>{ui("My inbox")}</Button><Button disabled={decide.isPending} variant={tab === "history" ? "default" : "ghost"} onClick={() => changeTab("history")}>{ui("History")}</Button></div><Button variant="outline" disabled={source.isFetching || decide.isPending} onClick={() => { void source.refetch(); if (selectedId) void detail.refetch(); }}><RefreshCw className="mr-2 h-4 w-4" />{ui("Refresh")}</Button></div>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(18rem,1fr)_minmax(0,2fr)]">
      <Card><CardHeader><CardTitle>{tab === "inbox" ? ui("Pending for me") : tr("Resolved requests", "Yêu cầu đã xử lý")}</CardTitle><CardDescription>{rows.length} {ui("request(s)")}</CardDescription></CardHeader><CardContent className="space-y-2">
        {source.isLoading && <p role="status" className="text-sm text-muted-foreground">{ui("Loading approvals…")}</p>}
        {source.isError && <div role="alert" className="space-y-2 text-sm"><p>{tr("Could not load requests. Please try again.", "Không tải được yêu cầu. Vui lòng thử lại.")}</p><Button variant="outline" onClick={() => { void source.refetch(); }}>{tr("Retry", "Thử lại")}</Button></div>}
        {!source.isError && rows.map((request) => <button disabled={decide.isPending} type="button" key={request.id} aria-pressed={selectedId === request.id} className={"w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent disabled:opacity-60 " + (selectedId === request.id ? "border-primary bg-accent" : "")} onClick={() => { if (tab === "inbox") markRead(request.id); setSelectedId(request.id); setComment(""); setNotice(null); }}>
          <p className="break-words font-semibold">{title(request)}</p><p className="mt-1 text-xs text-muted-foreground">{actionLabel(request)}</p>
          <p className="mt-2 truncate text-sm">{request.display?.requester?.name || tr("Requester unavailable", "Không còn thông tin người đề nghị")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{statusLabel(request.status)} · {date(request.requestedAt)}</p>
        </button>)}
        {!source.isLoading && !source.isError && !rows.length && <p className="text-sm text-muted-foreground">{tab === "inbox" ? tr("You're all caught up. No requests need your decision.", "Bạn đã xử lý hết. Hiện không có yêu cầu cần bạn phê duyệt.") : ui("No approval requests.")}</p>}
      </CardContent></Card>
      <Card className="min-w-0"><CardHeader><CardTitle>{selected ? title(selected) : ui("Select an approval request")}</CardTitle><CardDescription>{selected ? actionLabel(selected) + " · " + statusLabel(selected.status) : tr("Choose a request to see its summary and approval history.", "Chọn một yêu cầu để xem tóm tắt và lịch sử phê duyệt.")}</CardDescription></CardHeader><CardContent className="space-y-5">
        {detail.isFetching && selectedId && <p role="status" className="text-sm text-muted-foreground">{tr("Loading request details…", "Đang tải chi tiết yêu cầu…")}</p>}
        {detail.isError && <div role="alert" className="space-y-2 text-sm"><p>{tr("Could not load this request. It may be unavailable or you may not have permission.", "Không tải được yêu cầu. Yêu cầu có thể không còn tồn tại hoặc bạn chưa có quyền xem.")}</p><Button variant="outline" onClick={() => { void detail.refetch(); }}>{tr("Retry", "Thử lại")}</Button></div>}
        {selected && !detail.isError && <>
          <dl className="grid gap-4 rounded-lg bg-muted/40 p-4 sm:grid-cols-2"><Field label={tr("Requested by", "Người đề nghị")}>{selected.display?.requester?.name || tr("Requester unavailable", "Không còn thông tin người đề nghị")}<span className="block text-xs font-normal text-muted-foreground">{selected.display?.requester?.email}</span></Field><Field label={tr("Requested at", "Thời điểm đề nghị")}>{date(selected.requestedAt)}</Field><Field label={tr("Approval workflow", "Quy trình phê duyệt")}>{selected.workflow.name}</Field><Field label={tr("Status", "Trạng thái")}>{statusLabel(selected.status)}</Field></dl>
          <ProposalSummary request={selected} />
          <section className="space-y-3"><h3 className="font-semibold">{ui("Progress and decisions")}</h3>{selected.steps.map((step) => <div key={step.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{tr("Step", "Bước")} {step.stepOrder}: {step.name}</p><span className="text-xs">{statusLabel(step.status)}</span></div><p className="mt-2 text-xs text-muted-foreground">{tr("Approvers", "Người phê duyệt")}: {step.assigneesSnapshot.map((assignee) => assignee.name || assignee.email).join(", ")} · {step.approvalMode === "ALL" ? tr("Everyone must approve", "Tất cả cần phê duyệt") : step.approvalMode === "ANY" ? tr("One approval required", "Cần một người phê duyệt") : tr("Approvals required", "Số phê duyệt cần có") + ": " + step.requiredApprovalCount}</p>{step.decisions.map((decision) => <div className="mt-3 border-l-2 pl-3 text-sm" key={decision.id}><p>{decision.approver.name} · {statusLabel(decision.decision)}</p><p className="text-xs text-muted-foreground">{date(decision.createdAt)}</p>{decision.comment && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{decision.comment}</p>}</div>)}</div>)}</section>
          {selected.status === "PENDING" && activeStep && canDecide && <div className="space-y-3 rounded-lg border p-4"><Label htmlFor="approval-comment">{ui("Decision comment")}</Label><p className="text-xs text-muted-foreground">{tr("A reason is required when rejecting so the requester knows what to change.", "Khi từ chối, cần ghi lý do để người đề nghị biết nội dung cần sửa.")}</p><textarea disabled={decide.isPending} id="approval-comment" maxLength={2000} className="min-h-24 w-full rounded-md border bg-background p-2 text-sm" value={comment} onChange={(event) => setComment(event.target.value)} /><div className="flex flex-wrap gap-2"><Button disabled={decide.isPending || detail.isFetching} onClick={() => decide.mutate({ id: selected.id, decision: "approve", comment })}><Check className="mr-2 h-4 w-4" />{ui("Approve")}</Button><Button variant="destructive" disabled={decide.isPending || detail.isFetching || !comment.trim()} onClick={() => decide.mutate({ id: selected.id, decision: "reject", comment })}><X className="mr-2 h-4 w-4" />{ui("Reject")}</Button></div></div>}
          {selected.status === "PENDING" && !canDecide && <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">{tr("This request is waiting for other approvers, or you do not have permission to decide at this step.", "Yêu cầu đang chờ người phê duyệt khác, hoặc bạn chưa có quyền quyết định tại bước này.")}</p>}
          <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">{tr("Technical details", "Chi tiết kỹ thuật")}</summary><p className="mt-2 text-xs text-muted-foreground">{tr("Original identifiers and submitted data for audit and support.", "Mã định danh và dữ liệu gửi ban đầu, dùng cho kiểm toán và hỗ trợ.")}</p><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">{JSON.stringify({ requestId: selected.id, actionKey: selected.actionKey, subjectType: selected.subjectType, subjectId: selected.subjectId, requesterType: selected.requestedByType, requesterId: selected.requestedById, payload: selected.payload }, null, 2)}</pre></details>
        </>}
      </CardContent></Card>
    </div>
  </div>;
}
