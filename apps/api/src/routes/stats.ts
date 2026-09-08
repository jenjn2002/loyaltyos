import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";

export function statsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/stats/dashboard", async (request, reply) => {
    const programId = request.programId;

    const [activeMembers, pointsAgg, recentTransactions, creditIssued, creditRedeemed, creditExchanged, recognitionVolume, bankBalances, bankTransactions, topRewardRows, recognitionRows] = await Promise.all([
      prisma.member.count({
        where: { programId, deletedAt: null, status: "ACTIVE" },
      }),
      prisma.pointAccount.aggregate({
        where: { programId },
        _sum: { totalEarned: true, totalRedeemed: true },
      }),
      prisma.pointTransaction.count({
        where: {
          account: { programId },
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.creditTransaction.aggregate({
        where: { programId, amount: { gt: 0 }, type: { in: ["GRANT", "GIVE_IN", "ADJUSTMENT"] } },
        _sum: { amount: true },
      }),
      prisma.creditTransaction.aggregate({
        where: { programId, amount: { lt: 0 }, type: { in: ["REDEEM", "EXCHANGE"] } },
        _sum: { amount: true },
      }),
      prisma.creditTransaction.count({ where: { programId, type: "EXCHANGE" } }),
      prisma.creditTransaction.count({ where: { programId, type: { in: ["GIVE_IN", "GIVE_OUT"] } } }),
      prisma.creditBank.findMany({ where: { programId }, select: { creditType: true, balance: true } }),
      prisma.creditBankTransaction.findMany({ where: { programId }, select: { creditType: true, amount: true, type: true } }),
      prisma.rewardRedemption.findMany({ where: { reward: { programId } }, orderBy: { redeemedAt: "desc" }, take: 500, select: { reward: { select: { name: true } } } }),
      prisma.creditTransaction.findMany({ where: { programId, type: "GIVE_IN", createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }, select: { createdAt: true } }),
    ]);

    const totalPointsIssued = pointsAgg._sum.totalEarned ?? 0;
    const totalPointsRedeemed = pointsAgg._sum.totalRedeemed ?? 0;

    const bankMetrics = (['P', 'R'] as const).reduce<Record<'P' | 'R', { used: number; unused: number; issued: number }>>((result, creditType) => {
      const balance = bankBalances.find((bank) => bank.creditType === creditType)?.balance ?? 0;
      const issued = bankTransactions.filter((transaction) => transaction.creditType === creditType && transaction.type === "ISSUANCE").reduce((sum, transaction) => sum + transaction.amount, 0);
      const allocated = bankTransactions.filter((transaction) => transaction.creditType === creditType && transaction.type === "ALLOCATION").reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
      const returned = bankTransactions.filter((transaction) => transaction.creditType === creditType && transaction.type === "RETURN").reduce((sum, transaction) => sum + transaction.amount, 0);
      result[creditType] = { used: Math.max(allocated - returned, 0), unused: balance, issued };
      return result;
    }, { P: { used: 0, unused: 0, issued: 0 }, R: { used: 0, unused: 0, issued: 0 } });
    const topRewards = [...topRewardRows.reduce((counts, row) => counts.set(row.reward.name, (counts.get(row.reward.name) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, redemptions]) => ({ name, redemptions }));
    const recognitionOverTime = [...recognitionRows.reduce((counts, row) => { const day = row.createdAt.toISOString().slice(0, 10); counts.set(day, (counts.get(day) ?? 0) + 1); return counts; }, new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));

    return reply.send({
      data: {
        activeMembers,
        totalPointsIssued,
        totalPointsRedeemed,
        redemptionRatio: totalPointsIssued > 0 ? totalPointsRedeemed / totalPointsIssued : 0,
        recentTransactions,
        creditIssued: creditIssued._sum.amount ?? 0,
        creditRedeemed: Math.abs(creditRedeemed._sum.amount ?? 0),
        creditExchanged: creditExchanged,
        recognitionVolume,
        creditBank: {
          P: bankBalances.find((bank) => bank.creditType === "P")?.balance ?? 0,
          R: bankBalances.find((bank) => bank.creditType === "R")?.balance ?? 0,
        },
        creditBankMetrics: bankMetrics,
        topRewards,
        recognitionOverTime,
      },
    });
  });

  done();
}
