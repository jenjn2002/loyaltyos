import { createQueue } from "./queue.js";
import { prisma } from "../db.js";

const expiryQueue = createQueue("credits.expire");

export async function ensureCreditNotificationTemplates(): Promise<void> {
  const programs = await prisma.program.findMany({ select: { id: true } });
  const templates = [
    { name: "credit-received", triggerEvent: "credit.received", subject: "You received recognition credits", bodyText: "{{message}} You received {{amount}} R-credit.", locale: "es-MX" },
    { name: "credit-expiring", triggerEvent: "credit.expiring", subject: "Your P-credit is expiring soon", bodyText: "{{amount}} P-credit expires in {{days}} days.", locale: "es-MX" },
    { name: "credit-exchange", triggerEvent: "credit.exchange", subject: "Your credit exchange was submitted", bodyText: "Your exchange request for {{amount}} credit is {{status}}.", locale: "es-MX" },
    { name: "credit-redeemed", triggerEvent: "credit.redeemed", subject: "Your reward redemption was recorded", bodyText: "Your reward redemption has been recorded.", locale: "es-MX" },
  ];
  for (const program of programs) {
    for (const template of templates) {
      await prisma.notificationTemplate.upsert({
        where: { programId_name_locale: { programId: program.id, name: template.name, locale: template.locale } },
        create: { ...template, programId: program.id, channel: "EMAIL", transactional: true, fallbackChannel: "IN_APP" },
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
