import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";
import { requireCapability } from "../lib/permissions.js";

export function statsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get(
    "/stats/dashboard",
    { preHandler: [requireCapability("dashboard.view")] },
    async (request, reply) => {
      const programId = request.programId;
      const lastSevenDays = new Date(Date.now() - 7 * 86_400_000);
      const lastThirtyDays = new Date(Date.now() - 30 * 86_400_000);
      const [
        activeMembers,
        issued,
        redeemed,
        exchanged,
        recentTransactions,
        giveRows,
        bankRows,
        bankTransactions,
        topRewardRows,
        recognitionRows,
      ] = await Promise.all([
        prisma.member.count({
          where: { programId, deletedAt: null, status: "ACTIVE" },
        }),
        prisma.customPointTransaction.aggregate({
          where: {
            programId,
            amount: { gt: 0 },
            action: { in: ["EARN", "GRANT", "ADJUSTMENT"] },
          },
          _sum: { amount: true },
        }),
        prisma.customPointTransaction.aggregate({
          where: { programId, action: "REDEEM", amount: { lt: 0 } },
          _sum: { amount: true },
        }),
        prisma.customPointTransaction.aggregate({
          where: { programId, action: "EXCHANGE", amount: { lt: 0 } },
          _sum: { amount: true },
        }),
        prisma.customPointTransaction.count({
          where: { programId, createdAt: { gte: lastSevenDays } },
        }),
        prisma.customPointTransaction.findMany({
          where: { programId, action: "GIVE_IN" },
          select: { amount: true },
        }),
        prisma.pointBank.findMany({
          where: { programId },
          include: {
            pointType: {
              select: { id: true, code: true, name: true, unitLabel: true, color: true },
            },
          },
        }),
        prisma.pointBankTransaction.findMany({
          where: { programId },
          select: { pointTypeId: true, amount: true, type: true },
        }),
        prisma.rewardRedemption.findMany({
          where: { reward: { programId } },
          orderBy: { redeemedAt: "desc" },
          take: 500,
          select: { reward: { select: { name: true } } },
        }),
        prisma.customPointTransaction.findMany({
          where: { programId, action: "GIVE_IN", createdAt: { gte: lastThirtyDays } },
          select: { createdAt: true },
        }),
      ]);

      const totalIssued = issued._sum.amount ?? 0;
      const totalRedeemed = Math.abs(redeemed._sum.amount ?? 0);
      const bankMetrics = bankRows.map((bank) => {
        const rows = bankTransactions.filter(
          (transaction) => transaction.pointTypeId === bank.pointTypeId,
        );
        const issuedAmount = rows
          .filter((transaction) => transaction.type === "ISSUANCE")
          .reduce((sum, transaction) => sum + transaction.amount, 0);
        const allocated = rows
          .filter((transaction) => ["ALLOCATION", "GIVE_ALLOCATION"].includes(transaction.type))
          .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
        const returned = rows
          .filter((transaction) => transaction.type === "RETURN")
          .reduce((sum, transaction) => sum + transaction.amount, 0);
        return {
          pointType: bank.pointType,
          used: Math.max(allocated - returned, 0),
          unused: bank.balance,
          issued: issuedAmount,
        };
      });
      const topRewards = [
        ...topRewardRows.reduce(
          (counts, row) => counts.set(row.reward.name, (counts.get(row.reward.name) ?? 0) + 1),
          new Map<string, number>(),
        ),
      ]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, redemptions]) => ({ name, redemptions }));
      const recognitionOverTime = [
        ...recognitionRows.reduce((counts, row) => {
          const day = row.createdAt.toISOString().slice(0, 10);
          counts.set(day, (counts.get(day) ?? 0) + 1);
          return counts;
        }, new Map<string, number>()),
      ]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }));

      return reply.send({
        data: {
          activeMembers,
          totalPointsIssued: totalIssued,
          totalPointsRedeemed: totalRedeemed,
          redemptionRatio: totalIssued > 0 ? totalRedeemed / totalIssued : 0,
          recentTransactions,
          pointIssued: totalIssued,
          pointRedeemed: totalRedeemed,
          pointExchanged: Math.abs(exchanged._sum.amount ?? 0),
          recognitionCount: giveRows.length,
          recognitionVolume: giveRows.reduce((sum, row) => sum + row.amount, 0),
          pointBanks: bankMetrics,
          topRewards,
          recognitionOverTime,
        },
      });
    },
  );

  done();
}
