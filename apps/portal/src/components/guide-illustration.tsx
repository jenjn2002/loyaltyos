import {
  Award,
  Bell,
  BriefcaseBusiness,
  CalendarCheck,
  CircleHelp,
  ClipboardList,
  Gift,
  History,
  LayoutDashboard,
  UserRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CustomerGuideTopic } from "../content/document-guide";

const illustrations: Record<CustomerGuideTopic["image"], { icon: LucideIcon; label: string; accent: string }> = {
  home: { icon: LayoutDashboard, label: "Tổng quan thành viên", accent: "#7c3aed" },
  claim: { icon: Gift, label: "Phần thưởng chờ nhận", accent: "#0f766e" },
  checkin: { icon: CalendarCheck, label: "Lịch điểm danh", accent: "#15803d" },
  wallet: { icon: WalletCards, label: "Ví và thao tác điểm", accent: "#2563eb" },
  transactions: { icon: History, label: "Lịch sử giao dịch", accent: "#475569" },
  notifications: { icon: Bell, label: "Trung tâm thông báo", accent: "#dc2626" },
  projects: { icon: BriefcaseBusiness, label: "Dự án và nhiệm vụ", accent: "#9333ea" },
  rewards: { icon: Gift, label: "Danh mục phần thưởng", accent: "#c2410c" },
  badges: { icon: Award, label: "Thành tích", accent: "#a16207" },
  profile: { icon: UserRound, label: "Hồ sơ cá nhân", accent: "#0369a1" },
};

const samples: Record<CustomerGuideTopic["image"], { title: string; detail: string; value: string; footnote: string }> = {
  home: { title: "Số dư point wallet", detail: "P-credit · R-credit", value: "2,400 P", footnote: "Silver · tiến độ 10 / 20" },
  claim: { title: "Chào mừng thành viên mới", detail: "Claim pending · campaign", value: "1,000 P", footnote: "Nút Nhận điểm" },
  checkin: { title: "Check-in", detail: "Lịch hoạt động minh họa", value: "8 ngày", footnote: "365 ngày gần nhất" },
  wallet: { title: "Give Recognition", detail: "Đồng nghiệp · category", value: "−250 P", footnote: "Kiểm tra tỷ lệ trước khi gửi" },
  transactions: { title: "Campaign · Welcome", detail: "GRANT · P-CREDIT", value: "+1,000 P", footnote: "Balance after · 2,400" },
  notifications: { title: "Cập nhật campaign", detail: "Có phần thưởng cần nhận", value: "2", footnote: "Thông báo chưa đọc" },
  projects: { title: "Dự án nhóm", detail: "Nhiệm vụ được giao", value: "2 task", footnote: "1 đang làm · 1 TODO" },
  rewards: { title: "Voucher cà phê", detail: "Reward available", value: "2,000 P", footnote: "Kiểm tra số dư và tồn kho" },
  badges: { title: "Milestone unlocked", detail: "Thành tích thành viên", value: "✓", footnote: "Badge · Silver Star" },
  profile: { title: "Thông tin hồ sơ", detail: "Email · Phòng ban", value: "An", footnote: "Edit · Save" },
};

const englishLabels: Record<CustomerGuideTopic["image"], string> = {
  home: "Member overview",
  claim: "Reward waiting to be claimed",
  checkin: "Check-in calendar",
  wallet: "Wallet and point actions",
  transactions: "Transaction history",
  notifications: "Notifications center",
  projects: "Projects and tasks",
  rewards: "Rewards catalog",
  badges: "Achievements",
  profile: "Member profile",
};

const englishSamples: Record<CustomerGuideTopic["image"], { title: string; detail: string; value: string; footnote: string }> = {
  home: { title: "Point wallet balances", detail: "P-credit · R-credit", value: "2,400 P", footnote: "Silver · progress 10 / 20" },
  claim: { title: "New member welcome", detail: "Claim pending · campaign", value: "1,000 P", footnote: "Claim action" },
  checkin: { title: "Check-in", detail: "Sample activity calendar", value: "8 days", footnote: "Last 365 days" },
  wallet: { title: "Give Recognition", detail: "Colleague · category", value: "−250 P", footnote: "Review conversion before sending" },
  transactions: { title: "Welcome campaign", detail: "GRANT · P-CREDIT", value: "+1,000 P", footnote: "Balance after · 2,400" },
  notifications: { title: "Campaign update", detail: "A reward is waiting for you", value: "2", footnote: "Unread notifications" },
  projects: { title: "Group project", detail: "My assigned tasks", value: "2 tasks", footnote: "1 in progress · 1 TODO" },
  rewards: { title: "Coffee voucher", detail: "Reward available", value: "2,000 P", footnote: "Check balance and stock" },
  badges: { title: "Milestone unlocked", detail: "Member achievement", value: "✓", footnote: "Badge · Silver Star" },
  profile: { title: "Profile details", detail: "Email · Department", value: "Alex", footnote: "Edit · Save" },
};

export function GuideIllustration({ topic }: { topic: CustomerGuideTopic }): JSX.Element {
  const { i18n } = useTranslation();
  const isEnglish = i18n.resolvedLanguage?.startsWith("en") ?? i18n.language.startsWith("en");
  const { icon: Icon, label, accent } = illustrations[topic.image];
  const sample = isEnglish ? englishSamples[topic.image] : samples[topic.image];
  const displayLabel = isEnglish ? englishLabels[topic.image] : label;
  return (
    <figure className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]" aria-label={`${isEnglish ? "Illustration" : "Hình minh họa"}: ${displayLabel}`}>
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-xl text-white" style={{ backgroundColor: accent }}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-[var(--color-text)]">{topic.title}</p>
          <p className="truncate text-[10px] text-[var(--color-text-secondary)]">{displayLabel} · {topic.area}</p>
        </div>
        <span className="rounded-full bg-[var(--color-surface-secondary)] px-2 py-1 text-[9px] font-medium text-[var(--color-text-secondary)]">{isEnglish ? "SAMPLE" : "MINH HỌA"}</span>
      </div>
      <div className="grid gap-3 bg-[var(--color-surface-secondary)] p-4 sm:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="h-2 w-24 rounded bg-[var(--color-border)]" />
            <div className="h-5 w-14 rounded-md" style={{ backgroundColor: `${accent}18` }} />
          </div>
          <div className="flex items-center gap-3 rounded-lg p-2" style={{ backgroundColor: `${accent}0d` }}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ color: accent, backgroundColor: `${accent}18` }}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-semibold text-[var(--color-text)]">{topic.title}</p>
              <p className="truncate text-[9px] text-[var(--color-text-secondary)]">{topic.steps[0] ?? sample.detail}</p>
            </div>
            <span className="shrink-0 text-xs font-bold" style={{ color: accent }}>{sample.value}</span>
          </div>
          <p className="truncate pt-1 text-[9px] text-[var(--color-text-secondary)]">{topic.steps[1] ?? sample.footnote}</p>
        </div>
        <div className="flex min-h-24 flex-col justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--color-text-secondary)]">
            <ClipboardList className="h-3.5 w-3.5" style={{ color: accent }} aria-hidden="true" />
            {isEnglish ? "ACTIONS" : "THAO TÁC"}
          </div>
          <div className="space-y-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <span className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: item === 0 ? accent : `${accent}55` }}>{item + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[8px] text-[var(--color-text-secondary)]">{topic.steps[item] ?? sample.footnote}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="flex items-center gap-1.5 px-4 pb-3 text-[10px] text-[var(--color-text-secondary)]">
        <CircleHelp className="h-3 w-3" aria-hidden="true" />
        {isEnglish ? "Mock illustration; no real account data is shown." : "Minh họa mô phỏng, không phải ảnh chụp dữ liệu tài khoản thật."}
      </figcaption>
    </figure>
  );
}
