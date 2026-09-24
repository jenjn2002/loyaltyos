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
        inactiveMembers,
        newMembers,
        issuedRows,
        redeemedRows,
        exchangedRows,
        recentTransactions,
        recognitionRowsAllTime,
        recognitionRows,
        bankRows,
        bankTransactions,
        topRewardRows,
        pointTypes,
        walletBalanceRows,
      ] = await Promise.all([
        prisma.member.count({
          where: { programId, deletedAt: null, status: "ACTIVE" },
        }),
        prisma.member.count({
          where: { programId, deletedAt: null, status: "INACTIVE" },
        }),
        prisma.member.count({
          where: { programId, deletedAt: null, createdAt: { gte: lastThirtyDays } },
        }),
        prisma.customPointTransaction.groupBy({
          where: {
            programId,
            amount: { gt: 0 },
            action: { in: ["EARN", "GRANT", "ADJUSTMENT"] },
          },
          by: ["pointTypeId"],
          _sum: { amount: true },
        }),
        prisma.customPointTransaction.groupBy({
          where: { programId, action: "REDEEM", amount: { lt: 0 } },
          by: ["pointTypeId"],
          _sum: { amount: true },
        }),
        prisma.customPointTransaction.groupBy({
          where: { programId, action: "EXCHANGE", amount: { lt: 0 } },
          by: ["pointTypeId"],
          _sum: { amount: true },
        }),
        prisma.customPointTransaction.count({
          where: { programId, createdAt: { gte: lastSevenDays } },
        }),
        prisma.customPointTransaction.findMany({
          where: { programId, action: "GIVE_IN" },
          select: { amount: true, pointTypeId: true },
        }),
        prisma.customPointTransaction.findMany({
          where: { programId, action: "GIVE_IN", createdAt: { gte: lastThirtyDays } },
          select: { createdAt: true },
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
        prisma.pointTypeDefinition.findMany({
          where: { programId, isActive: true, archivedAt: null },
          select: { id: true, code: true, name: true, unitLabel: true, color: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        }),
        prisma.customPointWallet.groupBy({
          where: { programId, member: { deletedAt: null } },
          by: ["pointTypeId"],
          _sum: { balance: true },
        }),
      ]);

      const sumAmounts = (rows: { _sum: { amount: number | null } }[]): number =>
        rows.reduce((sum, row) => sum + (row._sum.amount ?? 0), 0);
      const totalIssued = sumAmounts(issuedRows);
      const totalRedeemed = Math.abs(sumAmounts(redeemedRows));
      const totalExchanged = Math.abs(sumAmounts(exchangedRows));
      const issuedByType = new Map(issuedRows.map((row) => [row.pointTypeId, row._sum.amount ?? 0]));
      const redeemedByType = new Map(redeemedRows.map((row) => [row.pointTypeId, Math.abs(row._sum.amount ?? 0)]));
      const exchangedByType = new Map(exchangedRows.map((row) => [row.pointTypeId, Math.abs(row._sum.amount ?? 0)]));
      const recognitionByType = new Map<string, { count: number; volume: number }>();
      for (const row of recognitionRowsAllTime) {
        const current = recognitionByType.get(row.pointTypeId) ?? { count: 0, volume: 0 };
        current.count += 1;
        current.volume += row.amount;
        recognitionByType.set(row.pointTypeId, current);
      }
      const balanceByType = new Map(walletBalanceRows.map((row) => [row.pointTypeId, row._sum.balance ?? 0]));
      const pointTypeMetrics = pointTypes.map((pointType) => ({
        pointType,
        balance: balanceByType.get(pointType.id) ?? 0,
        issued: issuedByType.get(pointType.id) ?? 0,
        redeemed: redeemedByType.get(pointType.id) ?? 0,
        exchanged: exchangedByType.get(pointType.id) ?? 0,
        recognition: recognitionByType.get(pointType.id) ?? { count: 0, volume: 0 },
      }));
      const recognitionVolume = recognitionRowsAllTime.reduce((sum, row) => sum + row.amount, 0);
      const bankMetrics = bankRows.map((bank) => {
        const rows = bankTransactions.filter(
          (transaction) => transaction.pointTypeId === bank.pointTypeId,
        );
        const issuedAmount = rows
          .filter((transaction) => transaction.type === "ISSUANCE")
          .reduce((sum, transaction) => sum + transaction.amount, 0);
        const debited = rows
          .filter((transaction) => transaction.amount < 0)
          .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
        const returned = rows
          .filter((transaction) => transaction.type === "RETURN")
          .reduce((sum, transaction) => sum + transaction.amount, 0);
        return {
          pointType: bank.pointType,
          used: Math.max(debited - returned, 0),
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
          inactiveMembers,
          newMembersLast30Days: newMembers,
          pointIssued: totalIssued,
          pointRedeemed: totalRedeemed,
          pointExchanged: totalExchanged,
          recognitionCount: recognitionRowsAllTime.length,
          recognitionVolume,
          currentPointBalance: pointTypeMetrics.reduce((sum, row) => sum + row.balance, 0),
          pointTypeMetrics,
          pointBanks: bankMetrics,
          topRewards,
          recognitionOverTime,
        },
      });
    },
  );

  done();
}
