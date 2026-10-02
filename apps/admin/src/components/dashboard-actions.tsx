import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { fetchApi } from "@/lib/api-client";
import type { DashboardStats } from "@/types";

export function DashboardActions({ banks }: { banks?: DashboardStats["pointBanks"] }): JSX.Element | null {
  const { i18n } = useTranslation();
  const text = (en: string, vi: string) => i18n.language.startsWith("vi") ? vi : en;
  const admin = useQuery({ queryKey: ["admin-me"], queryFn: () => fetchApi<{ capabilities: Record<string, boolean> }>("/admin/me"), staleTime: 30_000 });
  const can = (key: string) => admin.data?.capabilities?.[key] === true;
  const approvals = useQuery({
    queryKey: ["admin", "approvals", "inbox"],
    queryFn: () => fetchApi<{ id: string }[]>("/admin/approvals/inbox"),
    enabled: can("approval.inbox"), refetchInterval: 30_000, retry: false,
  });
  const projects = useQuery({
    queryKey: ["dashboard", "action-projects"],
    queryFn: () => fetchApi<{ id: string; name: string; status: string; canManage: boolean }[]>("/admin/projects"),
    enabled: can("project.view"), refetchInterval: 30_000, retry: false,
  });
  const actionProjects = projects.data?.filter((project) => project.canManage && ["DRAFT", "PLAN_REJECTED", "APPROVED", "COMPLETED", "ISSUE_REJECTED", "ISSUED"].includes(project.status));
  const emptyBanks = banks?.filter((bank) => bank.unused <= 0);
  const cards = [
    { show: can("approval.inbox"), to: "/approvals", title: text("Waiting for your approval", "Chờ bạn phê duyệt"),
      count: approvals.data?.length, error: approvals.isError, retry: () => void approvals.refetch(),
      description: text("Pending decisions, including requests already read.", "Các yêu cầu chưa có quyết định, kể cả yêu cầu đã đọc.") },
    { show: can("project.view"), to: "/projects", title: text("Your projects needing action", "Dự án của bạn cần xử lý"),
      count: actionProjects?.length, error: projects.isError, retry: () => void projects.refetch(),
      description: text("Continue drafts, revise rejected plans, activate or distribute points.", "Tiếp tục bản nháp, sửa đề xuất bị từ chối, kích hoạt hoặc phân bổ điểm.") },
    { show: can("bank.view") && banks !== undefined, to: "/credits/banks", title: text("Point banks with no balance", "Ngân hàng điểm đã hết số dư"),
      count: emptyBanks?.length, error: false, retry: () => undefined,
      description: emptyBanks?.length ? emptyBanks.map((bank) => bank.pointType.name).join(", ") : text("Review available funding before the next allocation.", "Xem nguồn điểm còn lại trước lần phân bổ tiếp theo.") },
  ].filter((card) => card.show);
  if (!cards.length) return null;
  return (
    <section aria-labelledby="dashboard-actions-title" className="space-y-3">
      <div>
        <h2 id="dashboard-actions-title" className="text-lg font-semibold">{text("Your next actions", "Việc cần làm")}</h2>
        <p className="text-sm text-muted-foreground">{text("Only tasks and links available to your role are shown.", "Chỉ hiển thị công việc và liên kết bạn có quyền truy cập.")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map((card) => (
          <div key={card.to} className="rounded-xl border bg-card p-4">
            <h3 className="text-sm font-medium">{card.title}</h3>
            {card.error ? (
              <div role="alert" className="mt-3 text-sm">
                <p>{text("Unable to load this count.", "Chưa tải được số lượng.")}</p>
                <button type="button" onClick={card.retry} className="mt-1 underline">{text("Try again", "Thử lại")}</button>
              </div>
            ) : <p className="my-2 text-2xl font-bold tabular-nums">{card.count === undefined ? "…" : card.count.toLocaleString()}</p>}
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{card.description}</p>
            <Link to={card.to} className="mt-3 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary">
              {text("View details", "Xem chi tiết")}<ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
