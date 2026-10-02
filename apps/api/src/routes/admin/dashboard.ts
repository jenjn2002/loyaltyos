import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { LoyaltyError } from "../../lib/errors.js";
import { requireCapability } from "../../lib/permissions.js";

const widgetSchema = z.object({
  id: z.string().trim().min(1).max(120),
  metric: z.enum([
    "activeMembers",
    "inactiveMembers",
    "newMembersLast30Days",
    "recentTransactions",
    "totalPointsIssued",
    "totalPointsRedeemed",
    "pointExchanged",
    "currentPointBalance",
    "recognitionVolume",
    "giftCardsActive",
    "giftCardsOutstanding",
    "pointTypeBalance",
    "pointTypeIssued",
    "recognitionTrend",
  ]),
  title: z.string().trim().min(1).max(80),
});
const layoutSchema = z.object({ widgets: z.array(widgetSchema).max(30) });

function currentAdmin(request: { adminId: string | null }): string {
  if (!request.adminId) throw new LoyaltyError("UNAUTHORIZED", 401);
  return request.adminId;
}

function storedWidgets(value: unknown): z.infer<typeof layoutSchema>["widgets"] {
  const parsed = layoutSchema.shape.widgets.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function adminDashboardRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get(
    "/admin/dashboard-layout",
    { preHandler: [requireCapability("dashboard.view")] },
    async (request, reply) => {
      const preference = await prisma.adminDashboardPreference.findUnique({
        where: {
          programId_adminUserId: {
            programId: request.programId,
            adminUserId: currentAdmin(request),
          },
        },
        select: { widgets: true },
      });
      return reply.send({ data: { widgets: storedWidgets(preference?.widgets) } });
    },
  );

  app.patch(
    "/admin/dashboard-layout",
    { preHandler: [requireCapability("dashboard.view")] },
    async (request, reply) => {
      const body = layoutSchema.parse(request.body);
      const adminUserId = currentAdmin(request);
      const preference = await prisma.adminDashboardPreference.upsert({
        where: {
          programId_adminUserId: {
            programId: request.programId,
            adminUserId,
          },
        },
        create: {
          programId: request.programId,
          adminUserId,
          widgets: body.widgets as Prisma.InputJsonValue,
        },
        update: { widgets: body.widgets as Prisma.InputJsonValue },
        select: { widgets: true },
      });
      return reply.send({ data: { widgets: storedWidgets(preference.widgets) } });
    },
  );

  done();
}
