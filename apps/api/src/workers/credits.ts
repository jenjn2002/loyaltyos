import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
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
      const now = new Date();
      const dueBefore = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const scheduledMembers = await prisma.member.findMany({
        where: {
          programId: program.id,
          status: "ACTIVE",
          deletedAt: null,
          lastWorkingDay: { lt: dueBefore },
        },
        select: { id: true },
      });
      for (const candidate of scheduledMembers) {
        await prisma.$transaction(async (tx) => {
          const member = await tx.member.findFirst({
            where: {
              id: candidate.id,
              programId: program.id,
              status: "ACTIVE",
              deletedAt: null,
              lastWorkingDay: { lt: dueBefore },
            },
          });
          if (!member?.lastWorkingDay) return;
          const lastWorkingDay = member.lastWorkingDay.toISOString().slice(0, 10);
          const reason = member.offboardingReason?.trim() || `Scheduled offboarding (${lastWorkingDay})`;
          const actor = { type: "SYSTEM" as const, id: "scheduled-member-offboarding" };
          const cleared = await walletService.clearMemberWithTransaction(
            tx, program.id, member.id, actor, reason,
            `member-offboarding:${member.id}:${lastWorkingDay}`,
          );
          await audit(
            program.id, actor, "CREDIT_CLEARANCE", "member", member.id,
            { status: "INACTIVE", scheduledOffboarding: true, lastWorkingDay, clearedTransactions: cleared.map((item) => item.id) },
            reason, tx,
          );
        });
      }
    }
  });
}
