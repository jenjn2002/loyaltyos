export interface Member {
  id: string;
  email: string;
  name: string;
  tier: string | null;
  pointBalance: number;
  pendingBalance: number;
  joinedAt: string;
  lastActivityAt: string | null;
  totalSpend: number;
}

export interface PointTransaction {
  id: string;
  memberId: string;
  amount: number;
  type: string;
  description: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  approvalStatus?: string;
  startsAt: string | null;
  endsAt: string | null;
  segmentId: string | null;
  conditions: Record<string, unknown> | null;
  isStackable: boolean;
  maxBudget: number | null;
  membersReached?: number;
  pointsIssued?: number;
  redemptions?: number;
  conversionRate?: number;
}

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  updatedAt: string;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  earnedAt: string;
}

export interface BadgeProgress {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  progress: number; // 0-100
}

export interface Coupon {
  id: string;
  programId: string;
  code: string;
  mode: "SHARED" | "INDIVIDUAL" | "LIMITED";
  discountType: string;
  discountValue: number | null;
  usedCount: number;
  maxUses: number | null;
  expiresAt: string | null;
}

export interface Reward {
  id: string;
  name: string;
  description: string | null;
  pointPrices: Array<{ pointTypeId: string; amount: number; pointType: { id: string; code: string; name: string; unitLabel: string } }>;
  stock: number | null;
  imageUrl: string | null;
}

export interface AnalyticsDashboard {
  activeMembers: number;
  inactiveMembers: number;
  newMembersLast30Days: number;
  totalPointsIssued: number;
  totalPointsRedeemed: number;
  pointExchanged: number;
  currentPointBalance: number;
  redemptionRatio: number;
  pointTypeMetrics: Array<Record<string, unknown>>;
  pointBanks: Array<Record<string, unknown>>;
  topRewards: Array<Record<string, unknown>>;
}

export type CampaignAnalytics = Record<string, unknown>;

export interface LoyaltyOSError {
  statusCode: number;
  message: string;
  code?: string;
}

export interface CoalitionBalance {
  memberId: string;
  coalitionBalance: number;
  provider: string;
}

export interface CoalitionTxResult {
  txId: string;
  coalitionRef: string;
  newBalance: number;
}

export interface CoalitionConvertResult {
  deductedOwnPoints: number;
  creditedCoalitionPoints: number;
  conversionRate: number;
  newOwnBalance: number;
  newCoalitionBalance: number;
}

export interface Tier {
  name: string;
  minPoints: number;
  benefits: string[];
}

export interface ProgramConfig {
  name: string;
  currency: string;
  tiers: Tier[];
  pointExpiryDays: number | null;
  coalitionEnabled: boolean;
  coalitionProvider: string | null;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export interface RedemptionStats {
  totalRedemptions: number;
  totalPointsBurned: number;
  uniqueMembers: number;
  topRewards?: { id: string; name: string; redemptions: number; pointsBurned: number }[];
}
