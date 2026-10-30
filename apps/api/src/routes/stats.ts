import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LoyaltyError } from "../lib/errors.js";
import { assertCapability } from "../lib/permissions.js";

import { prisma } from "../db.js";
import { requireCapability } from "../lib/permissions.js";
import { BANK_CYCLE_RETURN_TYPES } from "../lib/wallets.js";

export function statsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get(
    "/stats/dashboard",
    { preHandler: [requireCapability("dashboard.view")] },
    async (request, reply) => {
      const programId = request.programId;
      const query = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), timeZone: z.string().max(100).optional() }).parse(request.query);
      const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86_400_000);
      const to = query.to ? new Date(query.to) : new Date();
      if (from > to) throw new LoyaltyError("INVALID_DATE_RANGE", 400);
      const period = { gte: from, lte: to };
      let dayFormatter: Intl.DateTimeFormat;
      try { dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: query.timeZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }); }
      catch { throw new LoyaltyError("INVALID_TIME_ZONE", 400); }
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
          where: { programId, deletedAt: null, createdAt: period },
        }),
        prisma.customPointTransaction.groupBy({
          where: {
            programId,
            createdAt: period,
            amount: { gt: 0 },
            action: { in: ["EARN", "GRANT", "ADJUSTMENT"] },
          },
          by: ["pointTypeId"],
          _sum: { amount: true },
        }),
        prisma.customPointTransaction.groupBy({
          where: { programId, action: "REDEEM", amount: { lt: 0 }, createdAt: period },
          by: ["pointTypeId"],
          _sum: { amount: true },
        }),
        prisma.customPointTransaction.groupBy({
          where: { programId, action: "EXCHANGE", amount: { lt: 0 }, createdAt: period },
          by: ["pointTypeId"],
          _sum: { amount: true },
        }),
        prisma.customPointTransaction.count({
          where: { programId, createdAt: period },
        }),
        prisma.customPointTransaction.groupBy({
          where: { programId, action: "GIVE_IN", createdAt: period },
          by: ["pointTypeId"],
          _count: { _all: true },
          _sum: { amount: true },
        }),
        prisma.customPointTransaction.findMany({
          where: { programId, action: "GIVE_IN", createdAt: period },
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
          where: { programId, createdAt: period },
          by: ["pointTypeId", "type"],
          _sum: { amount: true },
        }),
        prisma.rewardRedemption.groupBy({
          by: ["rewardId"],
          where: { reward: { programId }, cancelledAt: null, redeemedAt: period },
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
          (sum, transaction) => sum + (transaction.type === "CYCLE_CLEAR" ? 0 : Math.max(-(transaction._sum.amount ?? 0), 0)),
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
          const parts = dayFormatter.formatToParts(row.createdAt);
          const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "";
          const day = `${part("year")}-${part("month")}-${part("day")}`;
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

  app.get("/stats/dashboard/details", { preHandler: [requireCapability("dashboard.view")] }, async (request, reply) => {
    const query = z.object({
      metric: z.enum(["activeMembers", "inactiveMembers", "newMembersLast30Days", "recentTransactions", "totalPointsIssued", "totalPointsRedeemed", "pointExchanged", "redemptionRatio", "currentPointBalance", "recognitionVolume", "recognitionTrend", "pointTypeBalance", "pointTypeIssued", "pointsOverview", "bank", "topRewards", "giftCardsActive", "giftCardsOutstanding"]),
      from: z.string().datetime(), to: z.string().datetime(), pointTypeId: z.string().optional(), page: z.coerce.number().int().min(1).default(1),
    }).parse(request.query);
    const from = new Date(query.from), to = new Date(query.to);
    if (from > to) throw new LoyaltyError("INVALID_DATE_RANGE", 400);
    const programId = request.programId, take = 20, skip = (query.page - 1) * take;
    const period = { gte: from, lte: to };
    const memberName = (member: { firstName: string | null; lastName: string | null; email: string | null }) => [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email || "Member";
    if (["activeMembers", "inactiveMembers", "newMembersLast30Days"].includes(query.metric)) {
      await assertCapability(request, "member.view");
      const where = { programId, deletedAt: null, ...(query.metric === "activeMembers" ? { status: "ACTIVE" as const } : query.metric === "inactiveMembers" ? { status: "INACTIVE" as const } : { createdAt: period }) };
      const [rows, total] = await Promise.all([prisma.member.findMany({ where, select: { id: true, firstName: true, lastName: true, email: true, status: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take }), prisma.member.count({ where })]);
      return reply.send({ data: { items: rows.map((row) => ({ id: row.id, title: memberName(row), description: [row.email, row.status].filter(Boolean).join(" · "), date: row.createdAt })), total, page: query.page } });
    }
    if (query.metric === "bank") {
      await assertCapability(request, "bank.view");
      const where = { programId, createdAt: period, ...(query.pointTypeId ? { pointTypeId: query.pointTypeId } : {}) };
      const [rows, total] = await Promise.all([prisma.pointBankTransaction.findMany({ where, include: { pointType: { select: { name: true, unitLabel: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take }), prisma.pointBankTransaction.count({ where })]);
      return reply.send({ data: { items: rows.map((row) => ({ id: row.id, title: `${row.type} · ${row.pointType.name}`, description: row.reason, amount: row.amount, unit: row.pointType.unitLabel, date: row.createdAt })), total, page: query.page } });
    }
    if (query.metric === "giftCardsActive" || query.metric === "giftCardsOutstanding") {
      await assertCapability(request, "giftcard.view");
      const where = { batch: { programId }, status: { in: ["active" as const, "partially_redeemed" as const] } };
      const [rows, total] = await Promise.all([prisma.giftCard.findMany({ where, select: { id: true, code: true, balance: true, currency: true, status: true, activatedAt: true }, orderBy: { id: "desc" }, skip, take }), prisma.giftCard.count({ where })]);
      return reply.send({ data: { items: rows.map((row) => ({ id: row.id, title: row.code, description: row.status, amount: Number(row.balance), unit: row.currency, date: row.activatedAt })), total, page: query.page } });
    }
    if (query.metric === "currentPointBalance" || query.metric === "pointTypeBalance") {
      await assertCapability(request, "wallet.view");
      const primary = query.metric === "currentPointBalance" ? await prisma.pointTypeDefinition.findFirst({ where: { programId, isActive: true, archivedAt: null }, orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } }) : null;
      const where = { programId, member: { deletedAt: null }, pointType: { isActive: true, archivedAt: null }, ...(primary ? { pointTypeId: primary.id } : {}) };
      const [rows, total] = await Promise.all([prisma.customPointWallet.findMany({ where, include: { member: { select: { firstName: true, lastName: true, email: true } }, pointType: { select: { name: true, unitLabel: true } } }, orderBy: [{ balance: "desc" }, { id: "desc" }], skip, take }), prisma.customPointWallet.count({ where })]);
      return reply.send({ data: { items: rows.map((row) => ({ id: row.id, title: memberName(row.member), description: row.pointType.name, amount: row.balance, unit: row.pointType.unitLabel })), total, page: query.page } });
    }
    if (query.metric === "topRewards") {
      await assertCapability(request, "reward.view");
      const where = { reward: { programId }, cancelledAt: null, redeemedAt: period };
      const [rows, total] = await Promise.all([prisma.rewardRedemption.findMany({ where, include: { reward: { select: { name: true } }, member: { select: { firstName: true, lastName: true, email: true } } }, orderBy: [{ redeemedAt: "desc" }, { id: "desc" }], skip, take }), prisma.rewardRedemption.count({ where })]);
      return reply.send({ data: { items: rows.map((row) => ({ id: row.id, title: row.reward.name, description: memberName(row.member), date: row.redeemedAt })), total, page: query.page } });
    }
    await assertCapability(request, "wallet.view");
    const actions = query.metric === "totalPointsIssued" || query.metric === "pointTypeIssued" ? ["EARN", "GRANT", "ADJUSTMENT"] : query.metric === "totalPointsRedeemed" ? ["REDEEM"] : query.metric === "pointExchanged" ? ["EXCHANGE"] : query.metric === "recognitionVolume" || query.metric === "recognitionTrend" ? ["GIVE_IN"] : query.metric === "redemptionRatio" || query.metric === "pointsOverview" ? ["EARN", "GRANT", "ADJUSTMENT", "REDEEM"] : undefined;
    const amount = query.metric === "totalPointsIssued" || query.metric === "pointTypeIssued" ? { gt: 0 } : query.metric === "totalPointsRedeemed" || query.metric === "pointExchanged" ? { lt: 0 } : undefined;
    const where = { programId, createdAt: period, ...(actions ? { action: { in: actions } } : {}), ...(amount ? { amount } : {}), ...(["redemptionRatio", "pointsOverview"].includes(query.metric) ? { OR: [{ action: { in: ["EARN", "GRANT", "ADJUSTMENT"] }, amount: { gt: 0 } }, { action: "REDEEM", amount: { lt: 0 } }] } : {}) };
    const [rows, total] = await Promise.all([prisma.customPointTransaction.findMany({ where, include: { member: { select: { firstName: true, lastName: true, email: true } }, pointType: { select: { name: true, unitLabel: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take }), prisma.customPointTransaction.count({ where })]);
    return reply.send({ data: { items: rows.map((row) => ({ id: row.id, title: memberName(row.member), description: `${row.action} · ${row.pointType.name}`, amount: row.amount, unit: row.pointType.unitLabel, date: row.createdAt })), total, page: query.page } });
  });

  done();
}
