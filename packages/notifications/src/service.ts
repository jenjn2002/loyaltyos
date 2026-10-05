import type { NotificationChannel, PrismaClient } from "@prisma/client";

import { NoopProvider } from "./provider.js";
import { render } from "./renderer.js";
import { createRepository } from "./repository.js";
import { notificationCreateSchema, templateCreateSchema, templateUpdateSchema } from "./schemas.js";
import type {
  NotificationCreateInput,
  NotificationProvider,
  NotificationRow,
  TemplateCreateInput,
  TemplateListFilters,
  TemplateRow,
  TemplateUpdateInput,
} from "./types.js";
import {
  NotificationNotFoundError,
  ProviderNotFoundError,
  TemplateNotFoundError,
} from "./types.js";

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface NotificationDeliveryFailure {
  notificationId: string;
  error: string;
  failureStage: "DELIVERY" | "PRIMARY_DELIVERY";
  attemptNumber?: number;
  fallbackChannel?: NotificationChannel;
}

export class NotificationsService {
  private repo: ReturnType<typeof createRepository>;
  private providers: Map<NotificationChannel, NotificationProvider>;
  private enqueueFn: ((notificationId: string) => Promise<void>) | null = null;
  private deliveryFailureObserver: ((failure: NotificationDeliveryFailure) => Promise<void>) | null = null;

  constructor(prisma: PrismaClient) {
    this.repo = createRepository(prisma);
    this.providers = new Map();
    // In-app notices are persisted locally, so a no-op delivery provider is
    // valid. External channels must be explicitly configured; treating them
    // as no-op would report undelivered email/SMS/push as SENT.
    this.providers.set("IN_APP", new NoopProvider("IN_APP"));
  }

  setProvider(channel: NotificationChannel, provider: NotificationProvider): void {
    this.providers.set(channel, provider);
  }

  /** Set a function that enqueues notifications for async delivery. When set, `send()` enqueues instead of sending directly. */
  setEnqueue(fn: (notificationId: string) => Promise<void>): void {
    this.enqueueFn = fn;
  }

  /** Observe a primary-channel failure when a fallback channel successfully delivers the notice. */
  setDeliveryFailureObserver(
    observer: (failure: NotificationDeliveryFailure) => Promise<void>,
  ): void {
    this.deliveryFailureObserver = observer;
  }

  private async observeDeliveryFailure(failure: NotificationDeliveryFailure): Promise<void> {
    if (!this.deliveryFailureObserver) return;
    try {
      await this.deliveryFailureObserver(failure);
    } catch (error) {
      console.error("[Notifications] Could not record fallback delivery failure:", error);
    }
  }

  // ── Templates ──────────────────────────────────────────

  async createTemplate(input: TemplateCreateInput): Promise<TemplateRow> {
    const parsed = templateCreateSchema.parse(input) as TemplateCreateInput;
    return this.repo.createTemplate(parsed);
  }

  async updateTemplate(id: string, input: TemplateUpdateInput): Promise<TemplateRow> {
    const parsed = templateUpdateSchema.parse(input) as TemplateUpdateInput;
    const existing = await this.repo.findTemplateById(id);
    if (!existing) throw new TemplateNotFoundError(id);
    return this.repo.updateTemplate(id, parsed);
  }

  async deleteTemplate(id: string): Promise<void> {
    const existing = await this.repo.findTemplateById(id);
    if (!existing) throw new TemplateNotFoundError(id);
    await this.repo.deleteTemplate(id);
  }

  async getTemplate(id: string): Promise<TemplateRow> {
    const template = await this.repo.findTemplateById(id);
    if (!template) throw new TemplateNotFoundError(id);
    return template;
  }

  async listTemplates(
    programId: string,
    filters: TemplateListFilters = {},
  ): Promise<PaginatedResult<TemplateRow>> {
    const { items, total } = await this.repo.findTemplates(programId, filters);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ── Notifications ──────────────────────────────────────

  async createNotification(input: NotificationCreateInput): Promise<NotificationRow> {
    const parsed = notificationCreateSchema.parse(input) as NotificationCreateInput;
    return this.repo.createNotification(parsed);
  }

  async getNotification(id: string): Promise<NotificationRow> {
    const notification = await this.repo.findNotificationById(id);
    if (!notification) throw new NotificationNotFoundError(id);
    return notification;
  }

  async createAndSendNotification(
    input: NotificationCreateInput,
    emailCopy = false,
  ): Promise<NotificationRow[]> {
    let payload = input;
    if ((emailCopy || input.channel === "EMAIL") && !input.metadata?.email) {
      const email = await this.repo.findMemberEmail(input.memberId);
      if (email) {
        payload = { ...input, metadata: { ...input.metadata, email } };
      }
    }

    const notice = await this.createNotification(payload);
    const notices = [notice];
    try {
      notices[0] = await this.send(notice.id);
    } catch (error) {
      notices[0] = await this.persistSendFailure(notice.id, error);
    }

    const recipient = payload.metadata?.email;
    if (
      !emailCopy ||
      input.channel !== "IN_APP" ||
      typeof recipient !== "string" ||
      !recipient
    ) {
      return notices;
    }

    try {
      const emailNotice = await this.createNotification({
        ...payload,
        channel: "EMAIL",
      });
      notices.push(emailNotice);
      try {
        notices[notices.length - 1] = await this.send(emailNotice.id);
      } catch (error) {
        notices[notices.length - 1] = await this.persistSendFailure(emailNotice.id, error);
      }
    } catch (error) {
      console.error("[Notifications] Failed to create email copy", {
        memberId: input.memberId,
        error,
      });
    }

    return notices;
  }

  private async persistSendFailure(id: string, error: unknown): Promise<NotificationRow> {
    const persisted = await this.repo.findNotificationById(id);
    if (persisted?.status === "FAILED") return persisted;
    return this.repo.updateNotificationStatus(id, "FAILED", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  async sendTrigger(
    programId: string,
    triggerEvent: string,
    memberId: string,
    context: Record<string, unknown>,
  ): Promise<NotificationRow[]> {
    // Resolve locale: context._locale override > member.locale > program.defaultLocale > vi-VN
    const contextLocale = typeof context._locale === "string" ? context._locale : undefined;
    const memberLocale = await this.repo.findMemberLocale(memberId);
    const programDefaultLocale = await this.repo.findProgramDefaultLocale(memberId);
    const resolvedLocale = contextLocale ?? memberLocale ?? "vi-VN";

    // Find templates matching the trigger, filtered by locale
    let templates = await this.repo.findTemplatesByTrigger(programId, triggerEvent, resolvedLocale);

    // Keep the English experience English when a member explicitly uses it.
    // For other locales, retain the configured program default as the next
    // fallback before trying the neutral English catalog.
    if (templates.length === 0 && resolvedLocale !== "en-US" && programDefaultLocale && programDefaultLocale !== resolvedLocale) {
      templates = await this.repo.findTemplatesByTrigger(
        programId,
        triggerEvent,
        programDefaultLocale,
      );
    }
    if (templates.length === 0 && resolvedLocale !== "en-US") {
      templates = await this.repo.findTemplatesByTrigger(programId, triggerEvent, "en-US");
    }

    if (templates.length === 0) return [];

    const member = context.member as Record<string, unknown> | undefined;
    const metadata: Record<string, unknown> = {};
    if (member?.email) metadata.email = member.email;
    if (member?.phone) metadata.phone = member.phone;
    if (typeof context.projectInvitationId === "string") metadata.projectInvitationId = context.projectInvitationId;
    const projectContext = context.project;
    if (projectContext && typeof projectContext === "object" && !Array.isArray(projectContext)) {
      const projectId = (projectContext as Record<string, unknown>).id;
      if (typeof projectId === "string") metadata.projectId = projectId;
    }
    const hasEmailTemplate = templates.some((template) => template.channel === "EMAIL");

    // Pass locale to template context for formatting helpers
    const renderContext = { ...context, _locale: resolvedLocale };

    const notifications: NotificationRow[] = [];

    for (const template of templates) {
      const body = template.bodyHtml
        ? render(template.bodyHtml, renderContext)
        : template.bodyText
          ? render(template.bodyText, renderContext)
          : undefined;
      const subject = template.subject ? render(template.subject, renderContext) : undefined;

      const notificationInput = {
        templateId: template.id,
        memberId,
        channel: template.channel,
        subject,
        body,
        metadata,
      };
      notifications.push(
        ...(await this.createAndSendNotification(
          notificationInput,
          template.channel === "IN_APP" && !hasEmailTemplate,
        )),
      );
    }

    return notifications;
  }

  /** Send a notification. Checks opt-out preferences, then enqueues or delivers. */
  async send(id: string): Promise<NotificationRow> {
    const notification = await this.repo.findNotificationById(id);
    if (!notification) throw new NotificationNotFoundError(id);

    // Check opt-out preferences (skip for transactional notifications)
    const skipReason = await this.checkOptOut(notification);
    if (skipReason) {
      return this.repo.updateNotificationStatus(id, "SKIPPED_OPT_OUT", {
        error: skipReason,
      });
    }

    if (notification.channel === "EMAIL" && !this.emailRecipient(notification)) {
      const failed = await this.repo.updateNotificationStatus(id, "FAILED", {
        error: "NO_EMAIL_RECIPIENT: Member has no email address; delivery was not attempted.",
      });
      await this.observeDeliveryFailure({ notificationId: id, failureStage: "DELIVERY", error: failed.error ?? "No email recipient" });
      return failed;
    }

    if (!this.providers.get(notification.channel)) {
      const error = new ProviderNotFoundError(notification.channel);
      const failed = await this.repo.updateNotificationStatus(id, "FAILED", { error: error.message });
      await this.observeDeliveryFailure({ notificationId: id, failureStage: "DELIVERY", error: error.message });
      return failed;
    }

    // If an async queue is configured, enqueue and return immediately
    if (this.enqueueFn) {
      try {
        await this.enqueueFn(id);
      } catch (error) {
        await this.repo.updateNotificationStatus(id, "FAILED", {
          error: `NOTIFICATION_ENQUEUE_FAILED: ${error instanceof Error ? error.message : String(error)}`,
        });
        throw error;
      }
      if (notification.status === "FAILED") {
        return this.repo.updateNotificationStatus(id, "PENDING", { error: null, sentAt: null });
      }
      return notification;
    }

    return this.deliver(id);
  }

  /** Check if the member has opted out of this notification's channel. Returns the reason string if skipped, null otherwise. */
  private async checkOptOut(notification: NotificationRow): Promise<string | null> {
    if (!notification.templateId) return null;

    const template = await this.repo.findTemplateById(notification.templateId);
    if (!template) return null;

    // Transactional notifications ignore preferences
    if (template.transactional) return null;

    // Check member preferences — need programId from template
    const programId = template.programId;
    const prefs = await this.repo.findMemberPreferences(
      notification.memberId,
      programId,
      notification.channel,
    );

    if (prefs && !prefs.optedIn) {
      return `Member opted out of ${notification.channel} notifications`;
    }

    return null;
  }

  /** Deliver a notification via its channel's provider (used by the worker). Falls back to fallbackChannel on failure. */
  async deliver(id: string): Promise<NotificationRow> {
    const notification = await this.repo.findNotificationById(id);
    if (!notification) throw new NotificationNotFoundError(id);

    if (notification.channel === "EMAIL" && !this.emailRecipient(notification)) {
      const failed = await this.repo.updateNotificationStatus(id, "FAILED", {
        error: "NO_EMAIL_RECIPIENT: Member has no email address; delivery was not attempted.",
      });
      await this.observeDeliveryFailure({ notificationId: id, failureStage: "DELIVERY", error: failed.error ?? "No email recipient" });
      return failed;
    }

    // Try primary channel
    const provider = this.providers.get(notification.channel);
    if (!provider) {
      const error = new ProviderNotFoundError(notification.channel);
      const failed = await this.repo.updateNotificationStatus(id, "FAILED", { error: error.message });
      await this.observeDeliveryFailure({ notificationId: id, failureStage: "DELIVERY", error: error.message });
      return failed;
    }

    let result: Awaited<ReturnType<NotificationProvider["send"]>>;
    try {
      result = await provider.send(notification);
    } catch (error) {
      result = { success: false, error: error instanceof Error ? error.message : String(error) };
    }

    if (result.success) {
      const isMagicLink = notification.channel === "EMAIL" && notification.templateId
        ? (await this.repo.findTemplateById(notification.templateId))?.triggerEvent === "auth.magic_link"
        : false;
      return this.repo.updateNotificationStatus(id, "SENT", {
        sentAt: new Date(),
        error: null,
        ...(isMagicLink ? { body: null } : {}),
      });
    }

    // Check for fallback channel on the template
    const fallbackChannel = await this.getFallbackChannel(notification);
    if (fallbackChannel && fallbackChannel !== notification.channel) {
      const fallbackProvider = this.providers.get(fallbackChannel);
      if (fallbackProvider) {
        let fallbackResult: Awaited<ReturnType<NotificationProvider["send"]>>;
        try {
          fallbackResult = await fallbackProvider.send({
            ...notification,
            channel: fallbackChannel,
          });
        } catch (error) {
          fallbackResult = { success: false, error: error instanceof Error ? error.message : String(error) };
        }

        if (fallbackResult.success) {
          if (fallbackChannel === "IN_APP") {
            const metadata =
              notification.metadata &&
              typeof notification.metadata === "object" &&
              !Array.isArray(notification.metadata)
                ? notification.metadata
                : {};
            const fallbackNotice = await this.createNotification({
              templateId: notification.templateId ?? undefined,
              memberId: notification.memberId,
              channel: "IN_APP",
              subject: notification.subject ?? undefined,
              body: notification.body ?? undefined,
              metadata: { ...metadata, fallbackFromNotificationId: id },
            });
            const deliveredFallback = await this.repo.updateNotificationStatus(fallbackNotice.id, "SENT", {
              sentAt: new Date(),
              error: null,
            });
            await this.repo.updateNotificationStatus(id, "FAILED", {
              error: `Primary (${notification.channel}) failed: ${result.error ?? "unknown"}. Delivered through IN_APP fallback.`,
            });
            await this.observeDeliveryFailure({
              notificationId: id,
              error: result.error ?? "Primary notification provider failed",
              failureStage: "PRIMARY_DELIVERY",
              fallbackChannel,
            });
            return deliveredFallback;
          }
          await this.observeDeliveryFailure({
            notificationId: id,
            error: result.error ?? "Primary notification provider failed",
            failureStage: "PRIMARY_DELIVERY",
            fallbackChannel,
          });
          return this.repo.updateNotificationStatus(id, "SENT", {
            sentAt: new Date(),
            error: null,
          });
        }

        const message = `Primary and fallback both failed. Primary: ${result.error ?? "unknown"}. Fallback (${fallbackChannel}): ${fallbackResult.error ?? "unknown"}`;
        await this.repo.updateNotificationStatus(id, "FAILED", { error: message });
        throw new Error(message);
      }
    }

    const message = result.error ?? "Unknown error";
    await this.repo.updateNotificationStatus(id, "FAILED", { error: message });
    throw new Error(message);
  }

  private emailRecipient(notification: NotificationRow): string | null {
    const metadata = notification.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
    const email = (metadata as Record<string, unknown>).email;
    return typeof email === "string" && email.trim() ? email.trim() : null;
  }

  /** Get the fallback channel from the notification's template, if any. */
  private async getFallbackChannel(
    notification: NotificationRow,
  ): Promise<NotificationChannel | null> {
    if (!notification.templateId) return null;
    const template = await this.repo.findTemplateById(notification.templateId);
    const fallbackChannel = (template?.fallbackChannel as NotificationChannel | null) ?? null;
    if (
      notification.channel === "EMAIL" &&
      fallbackChannel === "IN_APP" &&
      template?.triggerEvent
    ) {
      const siblingTemplates = await this.repo.findTemplatesByTrigger(
        template.programId,
        template.triggerEvent,
        template.locale,
      );
      if (siblingTemplates.some((sibling) => sibling.channel === "IN_APP")) return null;
    }
    return fallbackChannel;
  }

  /** Get member notification preferences for all channels. */
  async getMemberPreferences(
    memberId: string,
    programId: string,
  ): Promise<{ channel: NotificationChannel; optedIn: boolean }[]> {
    const channels: NotificationChannel[] = ["EMAIL", "SMS", "PUSH", "IN_APP"];
    const results = await Promise.all(
      channels.map(async (channel) => {
        const prefs = await this.repo.findMemberPreferences(memberId, programId, channel);
        return { channel, optedIn: prefs?.optedIn ?? true };
      }),
    );
    return results;
  }

  /** Upsert a member's notification preference for a channel. */
  async upsertMemberPreference(
    memberId: string,
    programId: string,
    channel: NotificationChannel,
    optedIn: boolean,
  ): Promise<void> {
    await this.repo.upsertMemberPreference(memberId, programId, channel, optedIn);
  }

  async markRead(id: string): Promise<NotificationRow> {
    const notification = await this.repo.findNotificationById(id);
    if (!notification) throw new NotificationNotFoundError(id);
    return this.repo.updateNotificationStatus(id, "READ", { readAt: new Date() });
  }

  async setMemberNotificationRead(
    memberId: string,
    notificationId: string,
    read: boolean,
  ): Promise<NotificationRow> {
    const notification = await this.repo.setMemberNotificationRead(memberId, notificationId, read);
    if (!notification) throw new NotificationNotFoundError(notificationId);
    return notification;
  }

  async getMemberUnreadNotificationCount(memberId: string): Promise<number> {
    return this.repo.countUnreadNotifications(memberId);
  }

  async markMemberNotificationsRead(memberId: string): Promise<number> {
    return this.repo.markMemberNotificationsRead(memberId);
  }

  // ── Webhooks ─────────────────────────────────────────

  async createWebhook(input: { programId: string; url: string; events: string[]; secret: string }) {
    return this.repo.createWebhook(input);
  }

  async getWebhook(id: string, programId: string) {
    return this.repo.findWebhookById(id, programId);
  }

  async listWebhooks(
    programId: string,
    filters: { isActive?: boolean; page?: number; pageSize?: number } = {},
  ) {
    const { items, total } = await this.repo.findWebhooks(programId, filters);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    return {
      items: items.map(({ secret: _secret, ...webhook }) => webhook),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async updateWebhook(
    id: string,
    programId: string,
    data: { url?: string; events?: string[]; secret?: string; isActive?: boolean },
  ) {
    const webhook = await this.repo.updateWebhook(id, programId, data);
    if (!webhook) return null;
    const { secret: _secret, ...safeWebhook } = webhook;
    return safeWebhook;
  }

  async deleteWebhook(id: string, programId: string): Promise<boolean> {
    return this.repo.deleteWebhook(id, programId);
  }

  // ── Admin notification list ────────────────────────

  async listNotifications(
    programId: string,
    filters: {
      channel?: string;
      status?: string;
      memberId?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const { items, total } = await this.repo.findNotifications(programId, filters);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getMemberNotifications(
    memberId: string,
    pagination?: { page?: number; pageSize?: number },
  ): Promise<PaginatedResult<NotificationRow & { isRead: boolean }>> {
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 20;
    const { items, total } = await this.repo.findNotificationsByMember(memberId, {
      page,
      pageSize,
    });
    return {
      items: items.map((notification) => ({
        ...notification,
        isRead: notification.readAt !== null || notification.status === "READ",
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
