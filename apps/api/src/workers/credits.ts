import { creditService } from "../lib/credits.js";
import { expirePointLots } from "../lib/point-types.js";
import { notificationsService } from "../lib/notifications-setup.js";
import { createWorker } from "../lib/queue.js";
import { prisma } from "../db.js";

export function startCreditExpiryWorker(): void {
  createWorker("credits.expire", async () => {
    const programs = await prisma.program.findMany({ select: { id: true } });
    for (const program of programs) {
      await creditService.expire(program.id);
      await expirePointLots(program.id);
      const notices = await creditService.expiringNotices(program.id);
      for (const notice of notices) {
        await notificationsService.sendTrigger(program.id, "credit.expiring", notice.memberId, {
          amount: notice.amount,
          expiresAt: notice.expiresAt.toISOString(),
          days: notice.days,
          _locale: notice.member.locale ?? "es-MX",
          member: notice.member,
        });
      }
    }
  });
}
