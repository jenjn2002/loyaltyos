import {
  Activity,
  ArrowDownToLine,
  BriefcaseBusiness,
  BarChart3,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  Gift,
  LayoutDashboard,
  ShieldCheck,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AdminGuideTopic } from "@/content/document-guide";

const visuals: Record<AdminGuideTopic["image"], { icon: LucideIcon; accent: string; label: string }> = {
  dashboard: { icon: LayoutDashboard, accent: "#4f46e5", label: "Bảng điều khiển" },
  members: { icon: Users, accent: "#0284c7", label: "Hồ sơ thành viên" },
  table: { icon: Database, accent: "#475569", label: "Danh sách và bộ lọc" },
  wallet: { icon: WalletCards, accent: "#2563eb", label: "Ví điểm" },
  bank: { icon: CircleDollarSign, accent: "#0f766e", label: "Bank cycle" },
  roles: { icon: ShieldCheck, accent: "#7c3aed", label: "Quyền theo nhóm chức năng" },
  automation: { icon: Activity, accent: "#c026d3", label: "Luồng tự động / phê duyệt" },
  campaign: { icon: BarChart3, accent: "#ea580c", label: "Cấu hình campaign" },
  project: { icon: BriefcaseBusiness, accent: "#9333ea", label: "Vòng đời dự án" },
  reward: { icon: Gift, accent: "#b45309", label: "Catalog và yêu cầu" },
  export: { icon: ArrowDownToLine, accent: "#047857", label: "Chọn dữ liệu để xuất" },
  settings: { icon: ClipboardCheck, accent: "#0369a1", label: "Cấu hình hệ thống" },
};

const englishLabels: Record<AdminGuideTopic["image"], string> = {
  dashboard: "Dashboard overview",
  members: "Member profile",
  table: "Records and filters",
  wallet: "Point wallet",
  bank: "Bank cycle",
  roles: "Permissions by feature",
  automation: "Automation / approval flow",
  campaign: "Campaign configuration",
  project: "Project lifecycle",
  reward: "Catalog and requests",
  export: "Select data to export",
  settings: "System settings",
};

export function GuideIllustration({ topic }: { topic: AdminGuideTopic }): JSX.Element {
  const { i18n } = useTranslation();
  const isEnglish = i18n.resolvedLanguage?.startsWith("en") ?? i18n.language.startsWith("en");
  const { icon: Icon, accent, label } = visuals[topic.image];
  const displayLabel = isEnglish ? englishLabels[topic.image] : label;
  return (
    <figure className="overflow-hidden rounded-xl border bg-background" aria-label={`${isEnglish ? "Illustration" : "Hình minh họa"}: ${displayLabel}`}>
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-md text-white" style={{ backgroundColor: accent }}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{topic.title}</p>
          <p className="truncate text-[10px] text-muted-foreground">{displayLabel} · {topic.route}</p>
        </div>
        <span className="rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-muted-foreground">SAMPLE</span>
      </div>
      <div className="grid gap-2.5 bg-muted/40 p-3 sm:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-2 rounded-lg border bg-background p-3">
          <div className="flex items-center justify-between"><div className="h-2 w-24 rounded bg-muted" /><div className="h-4 w-12 rounded" style={{ backgroundColor: `${accent}1a` }} /></div>
          <div className="rounded-md border p-2">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-md" style={{ color: accent, backgroundColor: `${accent}17` }}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[9px] font-semibold">{topic.title}</p>
                <p className="mt-1 truncate text-[8px] text-muted-foreground">{topic.steps[0]}</p>
              </div>
              <span className="rounded border px-1 py-0.5 text-[8px]">{isEnglish ? "OPEN" : "MỞ"}</span>
            </div>
          </div>
          <p className="truncate px-1 text-[8px] text-muted-foreground">{topic.steps[1] ?? topic.purpose}</p>
          <p className="truncate px-1 text-[8px] text-muted-foreground">{topic.steps[2] ?? topic.result}</p>
        </div>
        <div className="flex min-h-24 flex-col justify-between rounded-lg border bg-background p-3">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold tracking-wide text-muted-foreground"><ClipboardCheck className="h-3 w-3" style={{ color: accent }} aria-hidden="true" /> {isEnglish ? "WORKFLOW" : "QUY TRÌNH"}</div>
          <div className="space-y-2">
            {topic.steps.slice(0, 3).map((label, index) => (
              <div className="flex items-center gap-2" key={label}>
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: index === 0 ? accent : `${accent}66` }}>{index + 1}</span>
                <span className="text-[9px] text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="px-3 pb-2.5 text-[10px] text-muted-foreground">{isEnglish ? "Mock illustration; no real account data is shown." : "Minh họa mô phỏng, không lấy ảnh hay dữ liệu từ tài khoản thật."}</figcaption>
    </figure>
  );
}
