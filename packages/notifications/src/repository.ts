import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  NotificationCreateInput,
  NotificationRow,
  TemplateCreateInput,
  TemplateListFilters,
  TemplateRow,
  TemplateUpdateInput,
} from "./types.js";

interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export function createRepository(prisma: PrismaClient) {
  return {
    // Template CRUD
    async createTemplate(data: TemplateCreateInput): Promise<TemplateRow> {
      return prisma.notificationTemplate.create({ data });
    },

    async updateTemplate(id: string, data: TemplateUpdateInput): Promise<TemplateRow> {
      return prisma.notificationTemplate.update({ where: { id }, data });
    },

    async deleteTemplate(id: string): Promise<void> {
      await prisma.notificationTemplate.delete({ where: { id } });
    },

    async findTemplateById(id: string): Promise<TemplateRow | null> {
      return prisma.notificationTemplate.findFirst({ where: { id } });
    },

    async findTemplates(
      programId: string,
      filters: TemplateListFilters = {},
    ): Promise<{ items: TemplateRow[]; total: number }> {
      const where: Prisma.NotificationTemplateWhereInput = { programId };

      if (filters.channel) where.channel = filters.channel;
      if (filters.triggerEvent) where.triggerEvent = filters.triggerEvent;
      if (filters.search) {
        where.name = { contains: filters.search, mode: "insensitive" };
      }

      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;

      const [items, total] = await Promise.all([
        prisma.notificationTemplate.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.notificationTemplate.count({ where }),
      ]);

      return { items, total };
    },

    async findTemplatesByTrigger(
      programId: string,
      triggerEvent: string,
      locale?: string,
    ): Promise<TemplateRow[]> {
      const where: Prisma.NotificationTemplateWhereInput = { programId, triggerEvent };
      if (locale) where.locale = locale;
      return prisma.notificationTemplate.findMany({ where });
    },

    async findMemberLocale(memberId: string): Promise<string | null> {
      const member = await prisma.member.findUnique({
        where: { id: memberId },
        select: { locale: true, program: { select: { defaultLocale: true } } },
      });
      if (!member) return null;
      return member.locale ?? member.program.defaultLocale;
    },

    async findMemberEmail(memberId: string): Promise<string | null> {
      const member = await prisma.member.findUnique({
        where: { id: memberId },
        select: { email: true },
      });
      return member?.email ?? null;
    },

    async findProgramDefaultLocale(memberId: string): Promise<string | null> {
      const member = await prisma.member.findUnique({
        where: { id: memberId },
        select: { program: { select: { defaultLocale: true } } },
      });
      return member?.program.defaultLocale ?? null;
    },

    // Notification
    async createNotification(data: NotificationCreateInput): Promise<NotificationRow> {
      return prisma.notification.create({
        data: {
          templateId: data.templateId,
          memberId: data.memberId,
          channel: data.channel,
          subject: data.subject,
          body: data.body,
          metadata: data.metadata as Prisma.InputJsonValue,
        },
      });
    },

    async findNotificationById(id: string): Promise<NotificationRow | null> {
      return prisma.notification.findFirst({ where: { id } });
    },

    async updateNotificationStatus(
      id: string,
      status: string,
      extra: { sentAt?: Date; readAt?: Date | null; error?: string } = {},
    ): Promise<NotificationRow> {
      return prisma.notification.update({
        where: { id },
        data: {
          status: status as never,
          ...(extra.sentAt !== undefined && { sentAt: extra.sentAt }),
          ...(extra.readAt !== undefined && { readAt: extra.readAt }),
          ...(extra.error !== undefined && { error: extra.error }),
        },
      });
    },

    async findNotificationsByMember(
      memberId: string,
      pagination?: PaginationParams,
    ): Promise<{ items: NotificationRow[]; total: number }> {
      const page = pagination?.page ?? 1;
      const pageSize = pagination?.pageSize ?? 20;

      const where: Prisma.NotificationWhereInput = { memberId, channel: "IN_APP" };

      const [items, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.notification.count({ where }),
      ]);

      return { items, total };
    },

    async countUnreadNotifications(memberId: string): Promise<number> {
      return prisma.notification.count({
        where: { memberId, channel: "IN_APP", readAt: null, status: { not: "READ" } },
      });
    },

    async markMemberNotificationsRead(memberId: string): Promise<number> {
      const result = await prisma.notification.updateMany({
        where: { memberId, channel: "IN_APP", readAt: null, status: { not: "READ" } },
        data: { readAt: new Date(), status: "READ" },
      });
      return result.count;
    },

    async setMemberNotificationRead(memberId: string, id: string, read: boolean): Promise<NotificationRow | null> {
      const result = await prisma.notification.updateMany({
        where: { id, memberId, channel: "IN_APP" },
        data: { readAt: read ? new Date() : null, status: read ? "READ" : "SENT" },
      });
      if (result.count === 0) return null;
      return prisma.notification.findFirst({ where: { id, memberId, channel: "IN_APP" } });
    },

    // Webhook Subscriptions
    async createWebhook(data: {
      programId: string;
      url: string;
      events: string[];
      secret: string;
    }) {
      return prisma.webhookSubscription.create({ data });
    },

    async findWebhookById(id: string, programId: string) {
      return prisma.webhookSubscription.findFirst({ where: { id, programId } });
    },

    async findWebhooks(
      programId: string,
      filters: { isActive?: boolean; page?: number; pageSize?: number } = {},
    ) {
      const where: Prisma.WebhookSubscriptionWhereInput = { programId };
      if (filters.isActive !== undefined) where.isActive = filters.isActive;
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      const [items, total] = await Promise.all([
        prisma.webhookSubscription.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.webhookSubscription.count({ where }),
      ]);
      return { items, total };
    },

    async updateWebhook(
      id: string,
      programId: string,
      data: { url?: string; events?: string[]; secret?: string; isActive?: boolean },
    ) {
      const updated = await prisma.webhookSubscription.updateMany({ where: { id, programId }, data });
      if (updated.count === 0) return null;
      return prisma.webhookSubscription.findFirst({ where: { id, programId } });
    },

    async deleteWebhook(id: string, programId: string): Promise<boolean> {
      const deleted = await prisma.webhookSubscription.deleteMany({ where: { id, programId } });
      return deleted.count > 0;
    },

    // Notification list (admin)
    async findNotifications(
      programId: string,
      filters: {
        channel?: string;
        status?: string;
        memberId?: string;
        page?: number;
        pageSize?: number;
      } = {},
    ) {
      const where: Prisma.NotificationWhereInput = { member: { is: { programId } } };
      if (filters.channel) where.channel = filters.channel as never;
      if (filters.status) where.status = filters.status as never;
      if (filters.memberId) where.memberId = filters.memberId;
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      const [items, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          include: { template: true },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.notification.count({ where }),
      ]);
      return { items, total };
    },

    // Notification preferences
    async findMemberPreferences(
      memberId: string,
      programId: string,
      channel: string,
    ): Promise<{ optedIn: boolean } | null> {
      const row = await prisma.memberNotificationPreferences.findUnique({
        where: { memberId_programId_channel: { memberId, programId, channel: channel as never } },
        select: { optedIn: true },
      });
      return row;
    },

    async upsertMemberPreference(
      memberId: string,
      programId: string,
      channel: string,
      optedIn: boolean,
    ): Promise<void> {
      await prisma.memberNotificationPreferences.upsert({
        where: { memberId_programId_channel: { memberId, programId, channel: channel as never } },
        create: { memberId, programId, channel: channel as never, optedIn },
        update: { optedIn, updatedAt: new Date() },
      });
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;
