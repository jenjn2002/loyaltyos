import { prisma } from "../db.js";
import { createQueue } from "./queue.js";

const expiryQueue = createQueue("credits.expire");

export async function ensureCreditNotificationTemplates(): Promise<void> {
  const programs = await prisma.program.findMany({ select: { id: true } });
  const templates: Array<{
    name: string;
    triggerEvent: string;
    subject: string;
    bodyText: string;
    locale: string;
    channel?: "EMAIL" | "IN_APP";
    transactional?: boolean;
    fallbackChannel?: "EMAIL" | "IN_APP" | null;
  }> = [
    {
      name: "credit-received",
      triggerEvent: "credit.received",
      subject: "Bạn đã nhận được lời ghi nhận",
      bodyText: "{{message}} Bạn đã nhận được {{amount}} {{pointType.name}}.",
      locale: "vi-VN",
    },
    {
      name: "credit-received",
      triggerEvent: "credit.received",
      subject: "You received recognition",
      bodyText: "{{message}} You received {{amount}} {{pointType.name}}.",
      locale: "en-US",
    },
    { name: "credit-received-in-app", triggerEvent: "credit.received", subject: "Bạn vừa nhận được điểm", bodyText: "{{message}} Bạn nhận được {{amount}} {{pointType.name}}.", locale: "vi-VN", channel: "IN_APP" },
    { name: "credit-received-in-app", triggerEvent: "credit.received", subject: "You received points", bodyText: "{{message}} You received {{amount}} {{pointType.name}}.", locale: "en-US", channel: "IN_APP" },
    { name: "admin-point-issuance", triggerEvent: "credit.admin_issued", subject: "Bạn vừa được cấp {{pointType.name}}", bodyText: "Quản trị viên đã cấp cho bạn {{amount}} {{pointType.name}}. Lý do: {{reason}}", locale: "vi-VN" },
    { name: "admin-point-issuance", triggerEvent: "credit.admin_issued", subject: "Points were added to your balance", bodyText: "An administrator issued you {{amount}} {{pointType.name}}. Reason: {{reason}}", locale: "en-US" },
    { name: "admin-point-issuance-in-app", triggerEvent: "credit.admin_issued", subject: "Bạn vừa được cấp điểm", bodyText: "Bạn nhận được {{amount}} {{pointType.name}} từ quản trị viên. Lý do: {{reason}}", locale: "vi-VN", channel: "IN_APP" },
    { name: "admin-point-issuance-in-app", triggerEvent: "credit.admin_issued", subject: "Points issued by an administrator", bodyText: "You received {{amount}} {{pointType.name}} from an administrator. Reason: {{reason}}", locale: "en-US", channel: "IN_APP" },
    { name: "credit-adjusted", triggerEvent: "credit.adjusted", subject: "Điểm của bạn đã được điều chỉnh", bodyText: "Số dư {{pointType.name}} của bạn thay đổi {{amount}} điểm. Lý do: {{reason}}", locale: "vi-VN" },
    { name: "credit-adjusted", triggerEvent: "credit.adjusted", subject: "Your points balance was adjusted", bodyText: "Your {{pointType.name}} balance changed by {{amount}} points. Reason: {{reason}}", locale: "en-US" },
    { name: "credit-adjusted-in-app", triggerEvent: "credit.adjusted", subject: "Điểm của bạn đã được điều chỉnh", bodyText: "Số dư {{pointType.name}} của bạn thay đổi {{amount}} điểm. Lý do: {{reason}}", locale: "vi-VN", channel: "IN_APP" },
    { name: "credit-adjusted-in-app", triggerEvent: "credit.adjusted", subject: "Your points balance was adjusted", bodyText: "Your {{pointType.name}} balance changed by {{amount}} points. Reason: {{reason}}", locale: "en-US", channel: "IN_APP" },
    {
      name: "credit-expiring",
      triggerEvent: "credit.expiring",
      subject: "Điểm của bạn sắp hết hạn",
      bodyText: "{{amount}} {{pointType.name}} sẽ hết hạn sau {{days}} ngày.",
      locale: "vi-VN",
    },
    {
      name: "credit-expiring",
      triggerEvent: "credit.expiring",
      subject: "Your points are expiring soon",
      bodyText: "{{amount}} {{pointType.name}} will expire in {{days}} days.",
      locale: "en-US",
    },
    { name: "credit-expiring-in-app", triggerEvent: "credit.expiring", subject: "Điểm của bạn sắp hết hạn", bodyText: "{{amount}} {{pointType.name}} sẽ hết hạn sau {{days}} ngày.", locale: "vi-VN", channel: "IN_APP" },
    { name: "credit-expiring-in-app", triggerEvent: "credit.expiring", subject: "Your points are expiring soon", bodyText: "{{amount}} {{pointType.name}} will expire in {{days}} days.", locale: "en-US", channel: "IN_APP" },
    {
      name: "credit-exchange",
      triggerEvent: "credit.exchange",
      subject: "Yêu cầu đổi credit của bạn đã được gửi",
      bodyText: "Yêu cầu đổi {{amount}} credit của bạn đang ở trạng thái {{status}}.",
      locale: "vi-VN",
    },
    {
      name: "credit-exchange",
      triggerEvent: "credit.exchange",
      subject: "Your credit exchange request was submitted",
      bodyText: "Your request to exchange {{amount}} credits is {{status}}.",
      locale: "en-US",
    },
    { name: "credit-exchange-in-app", triggerEvent: "credit.exchange", subject: "Yêu cầu đổi điểm đã được gửi", bodyText: "Yêu cầu đổi {{amount}} điểm của bạn đã được gửi và đang ở trạng thái {{status}}.", locale: "vi-VN", channel: "IN_APP" },
    { name: "credit-exchange-in-app", triggerEvent: "credit.exchange", subject: "Your point exchange request was submitted", bodyText: "Your request to exchange {{amount}} points was submitted with status {{status}}.", locale: "en-US", channel: "IN_APP" },
    {
      name: "credit-exchange-approved",
      triggerEvent: "credit.exchange.approved",
      subject: "Yêu cầu đổi credit đã được phê duyệt",
      bodyText: "Yêu cầu đổi {{amount}} credit của bạn đã được phê duyệt.",
      locale: "vi-VN",
      channel: "IN_APP" as const,
    },
    {
      name: "credit-exchange-approved",
      triggerEvent: "credit.exchange.approved",
      subject: "Your credit exchange request was approved",
      bodyText: "Your request to exchange {{amount}} credits was approved.",
      locale: "en-US",
      channel: "IN_APP" as const,
    },
    {
      name: "credit-exchange-rejected",
      triggerEvent: "credit.exchange.rejected",
      subject: "Yêu cầu đổi credit bị từ chối",
      bodyText: "Yêu cầu đổi {{amount}} credit của bạn đã bị từ chối.",
      locale: "vi-VN",
      channel: "IN_APP" as const,
    },
    {
      name: "credit-exchange-rejected",
      triggerEvent: "credit.exchange.rejected",
      subject: "Your credit exchange request was rejected",
      bodyText: "Your request to exchange {{amount}} credits was rejected.",
      locale: "en-US",
      channel: "IN_APP" as const,
    },
    {
      name: "campaign-claim-available",
      triggerEvent: "campaign.claim.available",
      subject: "Bạn có điểm campaign đang chờ nhận",
      bodyText: "Campaign {{campaign.name}} đã cấp cho bạn {{amount}} {{pointType.name}}. Đăng nhập để nhận điểm.",
      locale: "vi-VN",
      channel: "IN_APP" as const,
    },
    {
      name: "campaign-claim-available",
      triggerEvent: "campaign.claim.available",
      subject: "Campaign points are waiting for you",
      bodyText: "Campaign {{campaign.name}} has granted you {{amount}} {{pointType.name}}. Sign in to claim your points.",
      locale: "en-US",
      channel: "IN_APP" as const,
    },
    {
      name: "credit-redeemed",
      triggerEvent: "credit.redeemed",
      subject: "Yêu cầu đổi thưởng của bạn đã được ghi nhận",
      bodyText: "Yêu cầu đổi thưởng của bạn đã được ghi nhận.",
      locale: "vi-VN",
    },
    {
      name: "credit-redeemed",
      triggerEvent: "credit.redeemed",
      subject: "Your reward redemption was recorded",
      bodyText: "Your reward redemption request was recorded.",
      locale: "en-US",
    },
    { name: "credit-redeemed-in-app", triggerEvent: "credit.redeemed", subject: "Đã ghi nhận yêu cầu đổi thưởng", bodyText: "Bạn đã đổi {{reward.name}} với {{amount}} {{pointType.name}}.", locale: "vi-VN", channel: "IN_APP" },
    { name: "credit-redeemed-in-app", triggerEvent: "credit.redeemed", subject: "Reward redemption recorded", bodyText: "You redeemed {{reward.name}} for {{amount}} {{pointType.name}}.", locale: "en-US", channel: "IN_APP" },
    { name: "reward-fulfillment-changed", triggerEvent: "reward.fulfillment_changed", subject: "Cập nhật đổi thưởng: {{reward.name}}", bodyText: "Yêu cầu đổi {{reward.name}} của bạn đã được {{statusLabel}}. {{reason}}", locale: "vi-VN" },
    { name: "reward-fulfillment-changed", triggerEvent: "reward.fulfillment_changed", subject: "Reward update: {{reward.name}}", bodyText: "Your redemption for {{reward.name}} was {{statusLabel}}. {{reason}}", locale: "en-US" },
    { name: "reward-fulfillment-changed-in-app", triggerEvent: "reward.fulfillment_changed", subject: "Cập nhật đổi thưởng: {{reward.name}}", bodyText: "Yêu cầu đổi {{reward.name}} của bạn đã được {{statusLabel}}. {{reason}}", locale: "vi-VN", channel: "IN_APP" },
    { name: "reward-fulfillment-changed-in-app", triggerEvent: "reward.fulfillment_changed", subject: "Reward update: {{reward.name}}", bodyText: "Your redemption for {{reward.name}} was {{statusLabel}}. {{reason}}", locale: "en-US", channel: "IN_APP" },
    { name: "reward-redemption-rejected", triggerEvent: "reward.redemption.rejected", subject: "Yêu cầu đổi thưởng bị từ chối", bodyText: "Yêu cầu đổi {{reward.name}} của bạn đã bị từ chối. {{pointsSpent}} điểm đã được hoàn lại. Lý do: {{reason}}", locale: "vi-VN" },
    { name: "reward-redemption-rejected", triggerEvent: "reward.redemption.rejected", subject: "Reward redemption was rejected", bodyText: "Your redemption for {{reward.name}} was rejected. {{pointsSpent}} points were refunded. Reason: {{reason}}", locale: "en-US" },
    { name: "reward-redemption-rejected-in-app", triggerEvent: "reward.redemption.rejected", subject: "Yêu cầu đổi thưởng bị từ chối", bodyText: "Yêu cầu đổi {{reward.name}} bị từ chối; {{pointsSpent}} điểm đã được hoàn lại. Lý do: {{reason}}", locale: "vi-VN", channel: "IN_APP" },
    { name: "reward-redemption-rejected-in-app", triggerEvent: "reward.redemption.rejected", subject: "Reward redemption was rejected", bodyText: "Your redemption for {{reward.name}} was rejected; {{pointsSpent}} points were refunded. Reason: {{reason}}", locale: "en-US", channel: "IN_APP" },
    { name: "Tier Changed", triggerEvent: "tier.changed", subject: "Chúc mừng bạn đã lên hạng {{tier.name}}", bodyText: "Bạn đã đạt hạng {{tier.name}}.", locale: "vi-VN" },
    { name: "Tier Changed", triggerEvent: "tier.changed", subject: "Congratulations on reaching {{tier.name}}", bodyText: "You reached the {{tier.name}} tier.", locale: "en-US" },
    { name: "tier-changed-in-app", triggerEvent: "tier.changed", subject: "Chúc mừng bạn đã lên hạng {{currentTier}}", bodyText: "Bạn đã được nâng từ {{previousTier}} lên hạng {{currentTier}}.", locale: "vi-VN", channel: "IN_APP" },
    { name: "tier-changed-in-app", triggerEvent: "tier.changed", subject: "Congratulations on reaching {{currentTier}}", bodyText: "You have been upgraded from {{previousTier}} to {{currentTier}}.", locale: "en-US", channel: "IN_APP" },
    { name: "badge-unlocked", triggerEvent: "badge.unlocked", subject: "Bạn đã mở khóa huy hiệu {{badgeName}}", bodyText: "Chúc mừng! Bạn vừa mở khóa huy hiệu {{badgeName}}.", locale: "vi-VN" },
    { name: "badge-unlocked", triggerEvent: "badge.unlocked", subject: "You unlocked the {{badgeName}} badge", bodyText: "Congratulations! You unlocked the {{badgeName}} badge.", locale: "en-US" },
    { name: "badge-unlocked-in-app", triggerEvent: "badge.unlocked", subject: "Bạn đã mở khóa huy hiệu {{badgeName}}", bodyText: "Chúc mừng! Bạn vừa mở khóa huy hiệu {{badgeName}}.", locale: "vi-VN", channel: "IN_APP" },
    { name: "badge-unlocked-in-app", triggerEvent: "badge.unlocked", subject: "You unlocked the {{badgeName}} badge", bodyText: "Congratulations! You unlocked the {{badgeName}} badge.", locale: "en-US", channel: "IN_APP" },
    { name: "check-in", triggerEvent: "check_in", subject: "Điểm danh thành công", bodyText: "Bạn đã điểm danh ngày {{checkInDate}} và nhận {{points}} điểm.", locale: "vi-VN" },
    { name: "check-in", triggerEvent: "check_in", subject: "Check-in successful", bodyText: "You checked in on {{checkInDate}} and received {{points}} points.", locale: "en-US" },
    { name: "check-in-in-app", triggerEvent: "check_in", subject: "Điểm danh thành công", bodyText: "Bạn đã điểm danh ngày {{checkInDate}} và nhận {{points}} điểm.", locale: "vi-VN", channel: "IN_APP" },
    { name: "check-in-in-app", triggerEvent: "check_in", subject: "Check-in successful", bodyText: "You checked in on {{checkInDate}} and received {{points}} points.", locale: "en-US", channel: "IN_APP" },
    { name: "registration", triggerEvent: "registration", subject: "Chào mừng bạn đến với chương trình", bodyText: "{{member.firstName}}, tài khoản của bạn đã sẵn sàng. Bạn nhận được {{points}} điểm thưởng chào mừng.", locale: "vi-VN" },
    { name: "registration", triggerEvent: "registration", subject: "Welcome to the program", bodyText: "{{member.firstName}}, your account is ready. You received {{points}} welcome points.", locale: "en-US" },
    { name: "registration-in-app", triggerEvent: "registration", subject: "Chào mừng bạn đến với chương trình", bodyText: "{{member.firstName}}, tài khoản của bạn đã sẵn sàng. Bạn nhận được {{points}} điểm thưởng chào mừng.", locale: "vi-VN", channel: "IN_APP" },
    { name: "registration-in-app", triggerEvent: "registration", subject: "Welcome to the program", bodyText: "{{member.firstName}}, your account is ready. You received {{points}} welcome points.", locale: "en-US", channel: "IN_APP" },
    { name: "campaign-points-issued", triggerEvent: "campaign.points.issued", subject: "Bạn đã nhận điểm từ {{campaign.name}}", bodyText: "Campaign {{campaign.name}} đã cấp cho bạn {{amount}} {{pointType.name}}.", locale: "vi-VN" },
    { name: "campaign-points-issued", triggerEvent: "campaign.points.issued", subject: "You received points from {{campaign.name}}", bodyText: "Campaign {{campaign.name}} issued you {{amount}} {{pointType.name}}.", locale: "en-US" },
    { name: "campaign-points-issued-in-app", triggerEvent: "campaign.points.issued", subject: "Bạn đã nhận điểm từ {{campaign.name}}", bodyText: "Campaign {{campaign.name}} đã cấp cho bạn {{amount}} {{pointType.name}}.", locale: "vi-VN", channel: "IN_APP" },
    { name: "campaign-points-issued-in-app", triggerEvent: "campaign.points.issued", subject: "You received points from {{campaign.name}}", bodyText: "Campaign {{campaign.name}} issued you {{amount}} {{pointType.name}}.", locale: "en-US", channel: "IN_APP" },
    { name: "project-points-issued", triggerEvent: "project.points.issued", subject: "Bạn đã nhận điểm từ dự án {{project.name}}", bodyText: "Bạn nhận được {{amount}} {{pointType.name}} từ dự án {{project.name}}.", locale: "vi-VN" },
    { name: "project-points-issued", triggerEvent: "project.points.issued", subject: "You received points from project {{project.name}}", bodyText: "You received {{amount}} {{pointType.name}} from project {{project.name}}.", locale: "en-US" },
    { name: "project-points-issued-in-app", triggerEvent: "project.points.issued", subject: "Bạn đã nhận điểm từ dự án {{project.name}}", bodyText: "Bạn nhận được {{amount}} {{pointType.name}} từ dự án {{project.name}}.", locale: "vi-VN", channel: "IN_APP" },
    { name: "project-points-issued-in-app", triggerEvent: "project.points.issued", subject: "You received points from project {{project.name}}", bodyText: "You received {{amount}} {{pointType.name}} from project {{project.name}}.", locale: "en-US", channel: "IN_APP" },
    { name: "project-task-assigned", triggerEvent: "project.task.assigned", subject: "Bạn được giao nhiệm vụ trong dự án {{project.name}}", bodyText: "Nhiệm vụ {{task.title}} đã được giao cho bạn. Hạn hoàn thành: {{task.dueAt}}.", locale: "vi-VN" },
    { name: "project-task-assigned", triggerEvent: "project.task.assigned", subject: "A task was assigned to you in {{project.name}}", bodyText: "Task {{task.title}} was assigned to you. Due: {{task.dueAt}}.", locale: "en-US" },
    { name: "project-task-assigned-in-app", triggerEvent: "project.task.assigned", subject: "Bạn được giao nhiệm vụ trong dự án {{project.name}}", bodyText: "Nhiệm vụ {{task.title}} đã được giao cho bạn. Hạn hoàn thành: {{task.dueAt}}.", locale: "vi-VN", channel: "IN_APP" },
    { name: "project-task-assigned-in-app", triggerEvent: "project.task.assigned", subject: "A task was assigned to you in {{project.name}}", bodyText: "Task {{task.title}} was assigned to you. Due: {{task.dueAt}}.", locale: "en-US", channel: "IN_APP" },
    { name: "exchange-completed", triggerEvent: "credit.exchange.completed", subject: "Yêu cầu đổi điểm của bạn đã hoàn tất", bodyText: "Yêu cầu {{documentNumber}} đã hoàn tất. Mã tham chiếu: {{completionReference}}. {{completionNote}}", locale: "vi-VN" },
    { name: "exchange-completed", triggerEvent: "credit.exchange.completed", subject: "Your point exchange is complete", bodyText: "Request {{documentNumber}} is complete. Reference: {{completionReference}}. {{completionNote}}", locale: "en-US" },
    { name: "exchange-completed-in-app", triggerEvent: "credit.exchange.completed", subject: "Yêu cầu đổi điểm của bạn đã hoàn tất", bodyText: "Yêu cầu {{documentNumber}} đã hoàn tất. Mã tham chiếu: {{completionReference}}. {{completionNote}}", locale: "vi-VN", channel: "IN_APP" },
    { name: "exchange-completed-in-app", triggerEvent: "credit.exchange.completed", subject: "Your point exchange is complete", bodyText: "Request {{documentNumber}} is complete. Reference: {{completionReference}}. {{completionNote}}", locale: "en-US", channel: "IN_APP" },
    { name: "exchange-cancelled", triggerEvent: "credit.exchange.cancelled", subject: "Yêu cầu đổi điểm của bạn đã bị hủy", bodyText: "Yêu cầu {{documentNumber}} đã bị hủy và điểm đã được hoàn lại. Lý do: {{cancellationReason}}", locale: "vi-VN" },
    { name: "exchange-cancelled", triggerEvent: "credit.exchange.cancelled", subject: "Your point exchange was cancelled", bodyText: "Request {{documentNumber}} was cancelled and points were returned. Reason: {{cancellationReason}}", locale: "en-US" },
    { name: "exchange-cancelled-in-app", triggerEvent: "credit.exchange.cancelled", subject: "Yêu cầu đổi điểm của bạn đã bị hủy", bodyText: "Yêu cầu {{documentNumber}} đã bị hủy và điểm đã được hoàn lại. Lý do: {{cancellationReason}}", locale: "vi-VN", channel: "IN_APP" },
    { name: "exchange-cancelled-in-app", triggerEvent: "credit.exchange.cancelled", subject: "Your point exchange was cancelled", bodyText: "Request {{documentNumber}} was cancelled and points were returned. Reason: {{cancellationReason}}", locale: "en-US", channel: "IN_APP" },
    { name: "project-invitation", triggerEvent: "project.invitation", subject: "Lời mời tham gia dự án {{project.name}}", bodyText: "Bạn được mời tham gia dự án {{project.name}}. Mở mục Dự án để chấp nhận hoặc từ chối lời mời.", locale: "vi-VN" },
    { name: "project-invitation", triggerEvent: "project.invitation", subject: "Invitation to join {{project.name}}", bodyText: "You have been invited to join {{project.name}}. Open Projects to accept or decline the invitation.", locale: "en-US" },
    { name: "project-invitation-in-app", triggerEvent: "project.invitation", subject: "Lời mời tham gia dự án {{project.name}}", bodyText: "Bạn được mời tham gia dự án {{project.name}}. Mở mục Dự án để chấp nhận hoặc từ chối lời mời.", locale: "vi-VN", channel: "IN_APP" },
    { name: "project-invitation-in-app", triggerEvent: "project.invitation", subject: "Invitation to join {{project.name}}", bodyText: "You have been invited to join {{project.name}}. Open Projects to accept or decline the invitation.", locale: "en-US", channel: "IN_APP" },
    { name: "project-completed", triggerEvent: "project.completed", subject: "Dự án {{project.name}} đã hoàn thành", bodyText: "Dự án {{project.name}} đã được quản lý xác nhận hoàn thành. Cảm ơn bạn đã tham gia.", locale: "vi-VN" },
    { name: "project-completed", triggerEvent: "project.completed", subject: "Project {{project.name}} is complete", bodyText: "The project manager confirmed that {{project.name}} is complete. Thank you for participating.", locale: "en-US" },
    { name: "project-completed-in-app", triggerEvent: "project.completed", subject: "Dự án {{project.name}} đã hoàn thành", bodyText: "Dự án {{project.name}} đã được quản lý xác nhận hoàn thành. Cảm ơn bạn đã tham gia.", locale: "vi-VN", channel: "IN_APP" },
    { name: "project-completed-in-app", triggerEvent: "project.completed", subject: "Project {{project.name}} is complete", bodyText: "The project manager confirmed that {{project.name}} is complete. Thank you for participating.", locale: "en-US", channel: "IN_APP" },
    { name: "admin-project-member-responded-in-app", triggerEvent: "admin.project.member_responded", subject: "Phản hồi lời mời dự án: {{project.name}}", bodyText: "{{member.name}} đã {{responseLabel}} lời mời tham gia dự án {{project.name}}.", locale: "vi-VN", channel: "IN_APP" },
    { name: "admin-project-member-responded-in-app", triggerEvent: "admin.project.member_responded", subject: "Project invitation response: {{project.name}}", bodyText: "{{member.name}} {{responseLabel}} your invitation to join {{project.name}}.", locale: "en-US", channel: "IN_APP" },
    { name: "admin-project-member-responded", triggerEvent: "admin.project.member_responded", subject: "Phản hồi lời mời dự án: {{project.name}}", bodyText: "{{member.name}} đã {{responseLabel}} lời mời tham gia dự án {{project.name}}.", locale: "vi-VN" },
    { name: "admin-project-member-responded", triggerEvent: "admin.project.member_responded", subject: "Project invitation response: {{project.name}}", bodyText: "{{member.name}} {{responseLabel}} your invitation to join {{project.name}}.", locale: "en-US" },
    { name: "admin-project-task-completed-in-app", triggerEvent: "admin.project.task_completed", subject: "Nhiệm vụ dự án đã hoàn thành: {{task.title}}", bodyText: "{{member.name}} đã hoàn thành nhiệm vụ {{task.title}} trong dự án {{project.name}}.", locale: "vi-VN", channel: "IN_APP" },
    { name: "admin-project-task-completed-in-app", triggerEvent: "admin.project.task_completed", subject: "Project task completed: {{task.title}}", bodyText: "{{member.name}} completed {{task.title}} in project {{project.name}}.", locale: "en-US", channel: "IN_APP" },
    { name: "admin-project-task-completed", triggerEvent: "admin.project.task_completed", subject: "Nhiệm vụ dự án đã hoàn thành: {{task.title}}", bodyText: "{{member.name}} đã hoàn thành nhiệm vụ {{task.title}} trong dự án {{project.name}}.", locale: "vi-VN" },
    { name: "admin-project-task-completed", triggerEvent: "admin.project.task_completed", subject: "Project task completed: {{task.title}}", bodyText: "{{member.name}} completed {{task.title}} in project {{project.name}}.", locale: "en-US" },
    { name: "admin-approval-resolved-in-app", triggerEvent: "admin.approval.resolved", subject: "{{approval.subjectName}} · {{approval.statusLabel}}", bodyText: "{{approval.actionLabel}} “{{approval.subjectName}}” đã {{approval.statusLabel}}. {{approval.comment}}", locale: "vi-VN", channel: "IN_APP" },
    { name: "admin-approval-resolved-in-app", triggerEvent: "admin.approval.resolved", subject: "{{approval.subjectName}} · {{approval.statusLabel}}", bodyText: "{{approval.actionLabel}} “{{approval.subjectName}}” was {{approval.statusLabel}}. {{approval.comment}}", locale: "en-US", channel: "IN_APP" },
    { name: "admin-approval-resolved", triggerEvent: "admin.approval.resolved", subject: "{{approval.subjectName}} · {{approval.statusLabel}}", bodyText: "{{approval.actionLabel}} “{{approval.subjectName}}” đã {{approval.statusLabel}}. {{approval.comment}}", locale: "vi-VN" },
    { name: "admin-approval-resolved", triggerEvent: "admin.approval.resolved", subject: "{{approval.subjectName}} · {{approval.statusLabel}}", bodyText: "{{approval.actionLabel}} “{{approval.subjectName}}” was {{approval.statusLabel}}. {{approval.comment}}", locale: "en-US" },
    { name: "admin-approval-pending-in-app", triggerEvent: "admin.approval.pending", subject: "Cần phê duyệt: {{workflow.name}}", bodyText: "{{workflow.name}} đang chờ bạn xem xét và phê duyệt.", locale: "vi-VN", channel: "IN_APP" },
    { name: "admin-approval-pending-in-app", triggerEvent: "admin.approval.pending", subject: "Approval needed: {{workflow.name}}", bodyText: "{{workflow.name}} is waiting for your review and approval.", locale: "en-US", channel: "IN_APP" },
    { name: "admin-approval-pending", triggerEvent: "admin.approval.pending", subject: "Cần phê duyệt: {{workflow.name}}", bodyText: "{{workflow.name}} đang chờ bạn xem xét và phê duyệt.", locale: "vi-VN" },
    { name: "admin-approval-pending", triggerEvent: "admin.approval.pending", subject: "Approval needed: {{workflow.name}}", bodyText: "{{workflow.name}} is waiting for your review and approval.", locale: "en-US" },
    { name: "admin-exchange-pending-in-app", triggerEvent: "admin.exchange.pending", subject: "Chứng từ đổi điểm chờ duyệt", bodyText: "Chứng từ {{voucher.documentNumber}} đang chờ bạn duyệt trực tiếp.", locale: "vi-VN", channel: "IN_APP" },
    { name: "admin-exchange-pending-in-app", triggerEvent: "admin.exchange.pending", subject: "Exchange voucher awaiting approval", bodyText: "Voucher {{voucher.documentNumber}} is awaiting your direct approval.", locale: "en-US", channel: "IN_APP" },
    { name: "admin-exchange-pending", triggerEvent: "admin.exchange.pending", subject: "Chứng từ đổi điểm chờ duyệt", bodyText: "Chứng từ {{voucher.documentNumber}} đang chờ bạn duyệt trực tiếp.", locale: "vi-VN" },
    { name: "admin-exchange-pending", triggerEvent: "admin.exchange.pending", subject: "Exchange voucher awaiting approval", bodyText: "Voucher {{voucher.documentNumber}} is awaiting your direct approval.", locale: "en-US" },
    { name: "Magic Link", triggerEvent: "auth.magic_link", subject: "Đăng nhập vào {{program.name}}", bodyText: "Chọn liên kết sau để đăng nhập. Liên kết có thời hạn và chỉ sử dụng một lần: {{magicLinkUrl}}", locale: "vi-VN", transactional: true, fallbackChannel: null },
    { name: "Magic Link", triggerEvent: "auth.magic_link", subject: "Sign in to {{program.name}}", bodyText: "Use this one-time sign-in link before it expires: {{magicLinkUrl}}", locale: "en-US", transactional: true, fallbackChannel: null },
  ];
  const legacyApprovalResolvedTemplates: Array<{
    name: string;
    triggerEvent: string;
    channel: "IN_APP" | "EMAIL";
    locale: string;
    oldSubject: string;
    oldBody: string;
    newSubject: string;
    newBody: string;
  }> = [
    {
      name: "admin-approval-resolved-in-app", triggerEvent: "admin.approval.resolved", channel: "IN_APP", locale: "vi-VN",
      oldSubject: "Yêu cầu {{approval.actionKey}} đã {{approval.statusLabel}}",
      oldBody: "Yêu cầu phê duyệt {{approval.actionKey}} cho {{approval.subjectType}} {{approval.statusLabel}}. {{approval.comment}}",
      newSubject: "{{approval.subjectName}} · {{approval.statusLabel}}",
      newBody: "{{approval.actionLabel}} “{{approval.subjectName}}” đã {{approval.statusLabel}}. {{approval.comment}}",
    },
    {
      name: "admin-approval-resolved-in-app", triggerEvent: "admin.approval.resolved", channel: "IN_APP", locale: "en-US",
      oldSubject: "{{approval.actionKey}} request {{approval.statusLabel}}",
      oldBody: "Your {{approval.actionKey}} request for {{approval.subjectType}} was {{approval.statusLabel}}. {{approval.comment}}",
      newSubject: "{{approval.subjectName}} · {{approval.statusLabel}}",
      newBody: "{{approval.actionLabel}} “{{approval.subjectName}}” was {{approval.statusLabel}}. {{approval.comment}}",
    },
    {
      name: "admin-approval-resolved", triggerEvent: "admin.approval.resolved", channel: "EMAIL", locale: "vi-VN",
      oldSubject: "Yêu cầu {{approval.actionKey}} đã {{approval.statusLabel}}",
      oldBody: "Yêu cầu phê duyệt {{approval.actionKey}} cho {{approval.subjectType}} {{approval.statusLabel}}. {{approval.comment}}",
      newSubject: "{{approval.subjectName}} · {{approval.statusLabel}}",
      newBody: "{{approval.actionLabel}} “{{approval.subjectName}}” đã {{approval.statusLabel}}. {{approval.comment}}",
    },
    {
      name: "admin-approval-resolved", triggerEvent: "admin.approval.resolved", channel: "EMAIL", locale: "en-US",
      oldSubject: "{{approval.actionKey}} request {{approval.statusLabel}}",
      oldBody: "Your {{approval.actionKey}} request for {{approval.subjectType}} was {{approval.statusLabel}}. {{approval.comment}}",
      newSubject: "{{approval.subjectName}} · {{approval.statusLabel}}",
      newBody: "{{approval.actionLabel}} “{{approval.subjectName}}” was {{approval.statusLabel}}. {{approval.comment}}",
    },
  ];
  for (const program of programs) {
    for (const template of templates.filter(item => !["project.task.assigned", "admin.project.task_completed"].includes(item.triggerEvent))) {
      await prisma.notificationTemplate.upsert({
        where: {
          programId_name_locale: {
            programId: program.id,
            name: template.name,
            locale: template.locale,
          },
        },
        create: {
          ...template,
          programId: program.id,
          channel: template.channel ?? "EMAIL",
          transactional: template.transactional ?? false,
          fallbackChannel: template.fallbackChannel === undefined ? "IN_APP" : template.fallbackChannel,
        },
        update: template.triggerEvent === "auth.magic_link"
          ? { transactional: true, fallbackChannel: null }
          : {},
      });
    }
    for (const legacy of legacyApprovalResolvedTemplates) {
      await prisma.notificationTemplate.updateMany({
        where: {
          programId: program.id,
          name: legacy.name,
          triggerEvent: legacy.triggerEvent,
          channel: legacy.channel,
          locale: legacy.locale,
          subject: legacy.oldSubject,
          bodyText: legacy.oldBody,
          bodyHtml: null,
        },
        data: { subject: legacy.newSubject, bodyText: legacy.newBody },
      });
    }
  }
}

export async function scheduleCreditExpiry(): Promise<void> {
  await expiryQueue.add(
    "daily-expire-and-warn",
    {},
    { repeat: { pattern: "0 2 * * *" }, removeOnComplete: true, removeOnFail: 10 },
  );
}

export { expiryQueue };
