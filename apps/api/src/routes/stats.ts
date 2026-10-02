import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";
import { requireCapability } from "../lib/permissions.js";
import { BANK_CYCLE_RETURN_TYPES } from "../lib/wallets.js";

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
        prisma.customPointTransaction.groupBy({
          where: { programId, action: "GIVE_IN" },
          by: ["pointTypeId"],
          _count: { _all: true },
          _sum: { amount: true },
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
        prisma.pointBankTransaction.groupBy({
          where: { programId },
          by: ["pointTypeId", "type"],
          _sum: { amount: true },
        }),
        prisma.rewardRedemption.groupBy({
          by: ["rewardId"],
          where: { reward: { programId }, cancelledAt: null },
          _count: { _all: true },
        }),
        prisma.pointTypeDefinition.findMany({
          where: { programId, isActive: true, archivedAt: null },
          select: { id: true, code: true, name: true, unitLabel: true, color: true, isPrimary: true },
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
        recognitionByType.set(row.pointTypeId, {
          count: row._count._all,
          volume: row._sum.amount ?? 0,
        });
      }
      const balanceByType = new Map(walletBalanceRows.map((row) => [row.pointTypeId, row._sum.balance ?? 0]));
      const primaryPointType = pointTypes.find((pointType) => pointType.isPrimary) ?? pointTypes[0] ?? null;
      const pointTypeMetrics = pointTypes.map((pointType) => ({
        pointType,
        balance: balanceByType.get(pointType.id) ?? 0,
        issued: issuedByType.get(pointType.id) ?? 0,
        redeemed: redeemedByType.get(pointType.id) ?? 0,
        exchanged: exchangedByType.get(pointType.id) ?? 0,
        recognition: recognitionByType.get(pointType.id) ?? { count: 0, volume: 0 },
      }));
      const recognitionVolume = recognitionRowsAllTime.reduce((sum, row) => sum + (row._sum.amount ?? 0), 0);
      const bankMetrics = bankRows.map((bank) => {
        const rows = bankTransactions.filter(
          (transaction) => transaction.pointTypeId === bank.pointTypeId,
        );
        const issuedAmount = rows
          .filter((transaction) => transaction.type === "ISSUANCE")
          .reduce((sum, transaction) => sum + (transaction._sum.amount ?? 0), 0);
        const debited = rows.reduce(
          (sum, transaction) => sum + Math.max(-(transaction._sum.amount ?? 0), 0),
          0,
        );
        const returned = rows
          .filter((transaction) => BANK_CYCLE_RETURN_TYPES.includes(transaction.type as (typeof BANK_CYCLE_RETURN_TYPES)[number]))
          .reduce((sum, transaction) => sum + Math.max(transaction._sum.amount ?? 0, 0), 0);
        return {
          pointType: bank.pointType,
          used: Math.max(debited - returned, 0),
          unused: bank.balance,
          issued: issuedAmount,
        };
      });
      const topRewardCounts = topRewardRows
        .sort((left, right) => right._count._all - left._count._all)
        .slice(0, 5);
      const topRewardDefinitions = topRewardCounts.length
        ? await prisma.reward.findMany({
            where: { programId, id: { in: topRewardCounts.map((row) => row.rewardId) } },
            select: { id: true, name: true },
          })
        : [];
      const rewardNames = new Map(topRewardDefinitions.map((reward) => [reward.id, reward.name]));
      const topRewards = topRewardCounts.flatMap((row) => {
        const name = rewardNames.get(row.rewardId);
        return name ? [{ name, redemptions: row._count._all }] : [];
      });
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
          recognitionCount: recognitionRowsAllTime.reduce((sum, row) => sum + row._count._all, 0),
          recognitionVolume,
          currentPointBalance: primaryPointType ? balanceByType.get(primaryPointType.id) ?? 0 : 0,
          currentPointBalanceType: primaryPointType
            ? { id: primaryPointType.id, name: primaryPointType.name, unitLabel: primaryPointType.unitLabel }
            : null,
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
