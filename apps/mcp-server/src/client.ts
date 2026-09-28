import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";

import type {
  AnalyticsDashboard,
  Badge,
  BadgeProgress,
  Campaign,
  CampaignAnalytics,
  CoalitionBalance,
  CoalitionConvertResult,
  CoalitionTxResult,
  Coupon,
  Member,
  PointTransaction,
  ProgramConfig,
  RedemptionStats,
  Reward,
  Segment,
  Webhook,
} from "./types.js";

export class LoyaltyOSClient {
  private readonly http: AxiosInstance;

  private toMember(raw: Record<string, unknown>): Member {
    const wallets = Array.isArray(raw.pointWallets) ? raw.pointWallets as Array<Record<string, unknown>> : [];
    const memberTier = raw.currentTier ?? raw.tier;
    const tierName = typeof memberTier === "string"
      ? memberTier
      : memberTier && typeof memberTier === "object" && "name" in memberTier
        ? String((memberTier as { name: unknown }).name)
        : null;
    return {
      id: String(raw.id ?? raw.memberId ?? ""),
      email: String(raw.email ?? ""),
      name: [raw.firstName, raw.lastName].filter((part): part is string => typeof part === "string" && part.length > 0).join(" "),
      tier: tierName,
      pointBalance: wallets.reduce((sum, wallet) => sum + Number(wallet.balance ?? 0), 0),
      pendingBalance: wallets.reduce((sum, wallet) => sum + Number(wallet.pendingBalance ?? 0), 0),
      joinedAt: String(raw.joinedAt ?? raw.createdAt ?? ""),
      lastActivityAt: typeof raw.lastActiveAt === "string" ? raw.lastActiveAt : null,
      totalSpend: wallets.reduce((sum, wallet) => sum + Number(wallet.totalEarned ?? 0), 0),
    };
  }

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: baseUrl,
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      timeout: 15_000,
    });
    this.http.interceptors.request.use((config) => {
      const url = config.url ?? "";
      // Legacy MCP calls use /api/...; LoyaltyOS mounts its REST routes at /api/v1.
      // Coalition is intentionally left untouched as it is outside this remediation scope.
      if (url.startsWith("/api/") && !url.startsWith("/api/v1/") && !url.startsWith("/api/coalition/")) {
        config.url = url.replace(/^\/api\//, "/api/v1/");
      }
      return config;
    });
    this.http.interceptors.response.use((response) => {
      const payload: unknown = response.data;
      if (payload && typeof payload === "object" && !Array.isArray(payload) && "data" in payload) {
        response.data = (payload as { data: unknown }).data;
      }
      return response;
    });
  }

  // ── Members ──

  async getMember(id: string): Promise<Member> {
    const { data } = await this.http.get<Record<string, unknown>>(`/api/members/${id}`);
    return this.toMember(data);
  }

  async listMembers(filters: {
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<{ members: Member[]; total: number; hasMore: boolean }> {
    const pageSize = filters.limit ?? 20;
    const page = Math.floor((filters.offset ?? 0) / pageSize) + 1;
    const { data } = await this.http.get<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number }>(
      "/api/members",
      { params: { page, pageSize, search: filters.search } },
    );
    return {
      members: data.items.map((member) => this.toMember(member)),
      total: data.total,
      hasMore: data.page * data.pageSize < data.total,
    };
  }

  async getMemberBalance(id: string): Promise<{ balance: number; pendingBalance: number }> {
    const { data } = await this.http.get<Array<{ balance: number; pendingBalance?: number }>>(
      `/api/members/${id}/balance`,
    );
    return {
      balance: data.reduce((sum, wallet) => sum + wallet.balance, 0),
      pendingBalance: data.reduce((sum, wallet) => sum + (wallet.pendingBalance ?? 0), 0),
    };
  }

  async getMemberTransactions(
    id: string,
    filters: {
      limit?: number;
      type?: "EARN" | "REDEEM" | "EXPIRE" | "ADJUSTMENT";
      startDate?: string;
      endDate?: string;
    },
  ): Promise<{ transactions: PointTransaction[]; total: number }> {
    const pageSize = filters.limit ?? 20;
    const { data } = await this.http.get<{ items: Array<Record<string, unknown>>; total: number }>(
      `/api/members/${id}/transactions`,
      { params: { page: 1, pageSize, type: filters.type, from: filters.startDate, to: filters.endDate } },
    );
    return {
      transactions: data.items.map((item) => ({
        id: String(item.id),
        memberId: String(item.memberId),
        amount: Number(item.amount),
        type: String(item.action),
        description: String(item.sourceLabel ?? item.reason ?? item.message ?? item.source ?? ""),
        createdAt: String(item.createdAt),
      })),
      total: data.total,
    };
  }

  async adjustMemberPoints(
    id: string,
    pointTypeId: string,
    amount: number,
    note: string,
    idempotencyKey?: string,
  ): Promise<{ newBalance: number; transactionId: string }> {
    const config: AxiosRequestConfig = {};
    if (idempotencyKey) {
      config.headers = { "Idempotency-Key": idempotencyKey };
    }
    const { data } = await this.http.post<{ newBalance: number; transactionId: string }>(
      `/api/members/${id}/adjust`,
      { pointTypeId, amount, reason: note },
      config,
    );
    return data;
  }

  async getMemberBadges(
    id: string,
    includeProgress?: boolean,
  ): Promise<{ earned: Badge[]; inProgress: BadgeProgress[] }> {
    const { data } = await this.http.get<{ earned: Badge[]; inProgress: BadgeProgress[] }>(
      `/api/members/${id}/badges`,
      { params: { includeProgress } },
    );
    return data;
  }

  // ── Campaigns ──

  async createCampaign(payload: {
    name: string;
    pointTypeId: string;
    type: "BONUS_POINTS" | "SPEND_AND_GET" | "FREQUENCY" | "MILESTONE" | "REFERRAL" | "BIRTHDAY" | "ANNIVERSARY" | "FLASH_SALE" | "TIER_UPGRADE_BONUS";
    startsAt?: string | null;
    endsAt?: string | null;
    eventType?: string | null;
    multiplier?: number;
    segmentId?: string;
    conditions?: Record<string, unknown>;
    isStackable?: boolean;
    maxBudget?: number | null;
    maxUsesPerMember?: number;
    issuanceMode?: "AUTO" | "CLAIM";
    issuancePolicy?: "STANDING" | "APPROVAL_REQUIRED";
    saveAsDraft?: boolean;
    justification?: string;
  }): Promise<Record<string, unknown>> {
    const { data } = await this.http.post<Record<string, unknown>>("/api/admin/campaigns", payload);
    return data;
  }

  async listCampaigns(filters: {
    status?: "active" | "draft" | "paused" | "ended";
    limit?: number;
    offset?: number;
  }): Promise<{ campaigns: Campaign[]; total: number }> {
    const { data } = await this.http.get<{ items: Campaign[]; total: number }>(
      "/api/admin/campaigns",
      { params: filters.status === "active" ? { isActive: true, pageSize: filters.limit, page: filters.offset ? Math.floor(filters.offset / (filters.limit ?? 20)) + 1 : 1 } : filters.status ? { isActive: false, pageSize: filters.limit, page: filters.offset ? Math.floor(filters.offset / (filters.limit ?? 20)) + 1 : 1 } : { pageSize: filters.limit, page: filters.offset ? Math.floor(filters.offset / (filters.limit ?? 20)) + 1 : 1 } },
    );
    const items = filters.status === "ended"
      ? data.items.filter((item) => Boolean(item.endsAt && new Date(item.endsAt) < new Date()))
      : filters.status === "draft"
        ? data.items.filter((item) => item.approvalStatus === "DRAFT")
        : filters.status === "paused"
          ? data.items.filter((item) => item.approvalStatus !== "DRAFT")
          : data.items;
    return { campaigns: items, total: data.total };
  }

  async getCampaign(id: string): Promise<Campaign> {
    const { data } = await this.http.get<Campaign>(`/api/admin/campaigns/${id}`);
    return data;
  }

  async activateCampaign(
    id: string,
  ): Promise<{ id: string; action: string }> {
    const { data } = await this.http.post<{ id: string; action: string }>(`/api/admin/campaigns/${id}/lifecycle`, { action: "activate" });
    return data;
  }

  async pauseCampaign(
    id: string,
    reason?: string,
  ): Promise<{ id: string; action: string }> {
    const { data } = await this.http.post<{ id: string; action: string }>(`/api/admin/campaigns/${id}/lifecycle`, { action: "pause", reason });
    return data;
  }

  // ── Segments ──

  async createSegment(payload: {
    name: string;
    description?: string;
    type: "STATIC" | "DYNAMIC";
    rules?: Record<string, unknown>;
    memberIds?: string[];
  }): Promise<{ segmentId: string; estimatedSize: number; segment: Record<string, unknown> }> {
    const { data: segment } = await this.http.post<Record<string, unknown>>("/api/admin/segments", payload);
    const estimatedSize = payload.type === "DYNAMIC" && payload.rules
      ? (await this.previewSegment({ rules: payload.rules })).estimatedCount
      : payload.memberIds?.length ?? 0;
    return { segmentId: String(segment.id), estimatedSize, segment };
  }

  async listSegments(): Promise<{ segments: Segment[]; total: number }> {
    const { data } = await this.http.get<{ items: Segment[]; total: number }>("/api/admin/segments");
    return { segments: data.items, total: data.total };
  }

  async previewSegment(payload: {
    rules: Record<string, unknown>;
  }): Promise<{ estimatedCount: number }> {
    const { data } = await this.http.post<{ count: number }>("/api/admin/segments/estimate", payload);
    return { estimatedCount: data.count };
  }

  async getSegmentMembers(id: string): Promise<{ members: Member[]; total: number }> {
    const { data } = await this.http.get<{ items: Member[]; total: number }>(
      `/api/admin/segments/${id}/members`,
    );
    return { members: data.items, total: data.total };
  }

  // ── Analytics ──

  async getDashboard(): Promise<AnalyticsDashboard> {
    const { data } = await this.http.get<AnalyticsDashboard>("/api/stats/dashboard");
    return data;
  }

  async getCampaignStats(id: string): Promise<CampaignAnalytics> {
    const { data } = await this.http.get<CampaignAnalytics>(`/api/admin/campaigns/${id}/issuance`);
    return data;
  }

  // ── Coupons ──

  async createCoupon(payload: {
    code: string;
    mode: "SHARED" | "INDIVIDUAL" | "LIMITED";
    discountType: "PERCENTAGE" | "FIXED" | "FREE_PRODUCT" | "FREE_SHIPPING" | "EXTRA_POINTS" | "EXPERIENCE";
    discountValue?: number;
    minPurchase?: number;
    maxUses?: number;
    expiresAt?: string;
    maxUsesPerMember?: number;
    isStackable?: boolean;
    isActive?: boolean;
    channels?: string[];
    startsAt?: string;
  }): Promise<Coupon> {
    const { data } = await this.http.post<Coupon>(
      "/api/admin/coupons",
      payload,
    );
    return data;
  }

  async listCoupons(filters: {
    limit?: number;
    offset?: number;
    active?: boolean;
  }): Promise<{ coupons: Coupon[]; total: number }> {
    const pageSize = filters.limit ?? 20;
    const { data } = await this.http.get<{ items: Coupon[]; total: number }>(
      "/api/admin/coupons",
      { params: { page: Math.floor((filters.offset ?? 0) / pageSize) + 1, pageSize, isActive: filters.active } },
    );
    return { coupons: data.items, total: data.total };
  }

  async validateCoupon(code: string, memberId: string, purchaseAmount?: number): Promise<{ valid: boolean; coupon?: Coupon }> {
    const { data } = await this.http.post<{ valid: boolean; coupon?: Coupon }>(
      "/api/coupons/validate",
      { code, memberId, purchaseAmount },
    );
    return data;
  }

  async getCouponStats(id: string): Promise<{ redemptions: number; pointsBurned: number }> {
    const { data } = await this.http.get<{ redemptions: number; pointsBurned: number }>(
      `/api/admin/coupons/${id}/stats`,
    );
    return data;
  }

  // ── Rewards ──

  async listRewards(filters: {
    limit?: number;
    offset?: number;
    maxCost?: number;
    category?: string;
    availableOnly?: boolean;
  }): Promise<{ rewards: Reward[]; total: number }> {
    const pageSize = filters.limit ?? 20;
    const page = Math.floor((filters.offset ?? 0) / pageSize) + 1;
    const { data } = await this.http.get<{ items: Reward[]; total: number }>(
      "/api/admin/rewards",
      { params: { page, pageSize, maxPoints: filters.maxCost, category: filters.category, isActive: filters.availableOnly ? true : undefined } },
    );
    return { rewards: data.items, total: data.total };
  }

  async createReward(payload: {
    name: string;
    description?: string | null;
    pointPrices: { pointTypeId: string; amount: number }[];
    stock?: number | null;
    imageUrl?: string | null;
    category?: string | null;
    tierRequired?: string | null;
    availableFrom?: string | null;
    availableUntil?: string | null;
    isActive?: boolean;
  }): Promise<Record<string, unknown>> {
    const { data } = await this.http.post<Record<string, unknown>>(
      "/api/admin/rewards",
      payload,
    );
    return data;
  }

  async getRedemptionStats(
    rewardId?: string,
    period?: "7d" | "30d" | "90d" | "365d",
  ): Promise<RedemptionStats> {
    const { data } = await this.http.get<RedemptionStats>("/api/admin/rewards/redemption-stats", {
      params: { rewardId, period },
    });
    return data;
  }

  // ── Coalition ──

  async getCoalitionBalance(memberId: string): Promise<CoalitionBalance> {
    const { data } = await this.http.get<CoalitionBalance>(
      `/api/coalition/members/${memberId}/balance`,
    );
    return data;
  }

  async accumulateCoalition(
    memberId: string,
    points: number,
    transactionRef: string,
    metadata?: Record<string, unknown>,
  ): Promise<CoalitionTxResult> {
    const config: AxiosRequestConfig = {
      headers: { "Idempotency-Key": transactionRef },
    };
    const { data } = await this.http.post<CoalitionTxResult>(
      "/api/coalition/accumulate",
      { memberId, points, metadata },
      config,
    );
    return data;
  }

  async convertCoalition(memberId: string, ownPoints: number): Promise<CoalitionConvertResult> {
    const { data } = await this.http.post<CoalitionConvertResult>("/api/coalition/convert", {
      memberId,
      ownPoints,
    });
    return data;
  }

  // ── Gift Cards ──

  async createGiftCardBatch(payload: {
    name: string;
    quantity: number;
    initialAmount: number;
    currency: string;
    prefix?: string;
    expirationDate: string;
    termsTemplateId: string;
  }): Promise<Record<string, unknown>> {
    const { data } = await this.http.post<Record<string, unknown>>(
      "/api/v1/admin/giftcards/batches",
      payload,
    );
    return data;
  }

  async getGiftCardBatch(batchId: string): Promise<Record<string, unknown>> {
    const { data } = await this.http.get<Record<string, unknown>>(
      `/api/v1/admin/giftcards/batches/${batchId}`,
    );
    return data;
  }

  async redeemGiftCard(
    code: string,
    payload: { amount: number; memberId?: string; orderRef?: string; idempotencyKey: string },
  ): Promise<Record<string, unknown>> {
    const config: AxiosRequestConfig = {
      headers: { "Idempotency-Key": payload.idempotencyKey },
    };
    const { data } = await this.http.post<Record<string, unknown>>(
      `/api/v1/giftcards/redeem`,
      { code, amount: payload.amount, memberId: payload.memberId, orderRef: payload.orderRef },
      config,
    );
    return data;
  }

  async lookupGiftCard(code: string): Promise<Record<string, unknown>> {
    const { data } = await this.http.post<Record<string, unknown>>(`/api/v1/giftcards/validate`, {
      code,
    });
    return data;
  }

  // ── Program ──

  async getProgramConfig(): Promise<ProgramConfig> {
    const { data } = await this.http.get<ProgramConfig>("/api/admin/program/config");
    return data;
  }

  async listWebhooks(): Promise<{ webhooks: Webhook[] }> {
    const { data } = await this.http.get<{ webhooks: Webhook[] }>("/api/admin/webhooks");
    return data;
  }
}
