import { prisma } from "../db.js";
import { notificationsService } from "../lib/notifications-setup.js";
import { createWorker } from "../lib/queue.js";
import { walletService } from "../lib/wallets.js";

export function startCreditExpiryWorker(): void {
  createWorker("credits.expire", async () => {
    const programs = await prisma.program.findMany({ select: { id: true } });
    for (const program of programs) {
      await walletService.expire(program.id);
      const notices = await walletService.expiringNotices(program.id);
      for (const notice of notices) {
        await notificationsService.sendTrigger(program.id, "credit.expiring", notice.memberId, {
          amount: notice.amount,
          pointType: notice.pointType,
          expiresAt: notice.expiresAt.toISOString(),
          days: notice.days,
          _locale: notice.member.locale ?? "en-US",
          member: notice.member,
        });
        await walletService.markExpiryNoticeSent(notice.lotId, notice.days);
      }
    }
  });
}
