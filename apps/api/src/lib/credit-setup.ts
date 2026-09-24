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
  ];
  for (const program of programs) {
    for (const template of templates) {
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
          transactional: true,
          fallbackChannel: "IN_APP",
        },
        update: {},
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
