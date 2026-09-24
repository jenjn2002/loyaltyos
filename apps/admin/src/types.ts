export interface MemberPointWallet {
  pointTypeId: string;
  code: string;
  name: string;
  unitLabel: string;
  balance: number;
  allowance?: { allocated: number; remaining: number } | null;
  allowManualAdjustment?: boolean;
  expiryMode?: string;
}

export interface CreatedBy {
  id: string;
  name: string;
  email: string | null;
}

export interface Member {
  id: string;
  externalId: string | null;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  department?: string | null;
  photoUrl?: string | null;
  metadata: unknown;
  tags: string[];
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
  status?: "ACTIVE" | "INACTIVE";
  deactivatedAt?: string | null;
  deletedAt?: string | null;
  username?: string | null;
  credentialsConfigured?: boolean;
  passwordChangedAt?: string | null;
  pointWallets?: MemberPointWallet[];
  createdBy?: CreatedBy | null;
}

export interface DashboardStats {
  activeMembers: number;
  inactiveMembers?: number;
  newMembersLast30Days?: number;
  totalPointsIssued: number;
  totalPointsRedeemed: number;
  redemptionRatio: number;
  recentTransactions: number;
  pointIssued?: number;
  pointRedeemed?: number;
  pointExchanged?: number;
  currentPointBalance?: number;
  recognitionCount?: number;
  recognitionVolume?: number;
  pointTypeMetrics?: {
    pointType: { id: string; code: string; name: string; unitLabel: string; color: string | null };
    balance: number;
    issued: number;
    redeemed: number;
    exchanged: number;
    recognition: { count: number; volume: number };
  }[];
  pointBanks?: {
    pointType: { id: string; code: string; name: string; unitLabel: string; color: string | null };
    used: number;
    unused: number;
    issued: number;
  }[];
  topRewards?: { name: string; redemptions: number }[];
  recognitionOverTime?: { date: string; count: number }[];
}

export interface PointTransaction {
  id: string;
  action: string;
  amount: number;
  balanceAfter: number;
  source: string;
  sourceLabel?: string;
  reason: string | null;
  message: string | null;
  pointType: { id: string; code: string; name: string; unitLabel: string };
  createdAt: string;
}

export interface Balance {
  confirmed: number;
  pending: number;
  total: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type CampaignType =
  | "BONUS_POINTS"
  | "SPEND_AND_GET"
  | "FREQUENCY"
  | "MILESTONE"
  | "REFERRAL"
  | "BIRTHDAY"
  | "ANNIVERSARY"
  | "FLASH_SALE"
  | "TIER_UPGRADE_BONUS";

export interface CampaignVariant {
  id: string;
  name: string;
  trafficPct: number;
  config: unknown;
}

export interface Campaign {
  issuancePolicy?: "STANDING" | "APPROVAL_REQUIRED";
  issuanceMode?: "AUTO" | "CLAIM";
  approvalStatus: string;
  justification: string | null;
  id: string;
  programId: string;
  createdById?: string | null;
  createdBy?: { id: string; name: string; email: string } | null;
  pointTypeId: string | null;
  segmentId?: string | null;
  eventType?: string | null;
  name: string;
  description: string | null;
  type: CampaignType;
  conditions: unknown;
  multiplier: number;
  maxBudget: number | null;
  maxUsesPerMember: number | null;
  isStackable: boolean;
  isActive: boolean;
  abTesting: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  variants?: CampaignVariant[];
  applications?: unknown[];
  issuance?: { count: number; points: number; pendingClaims?: number };
}

export interface CampaignIssuanceMember {
  id: string;
  email: string;
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  department: string | null;
}

export interface CampaignIssuanceItem {
  id: string;
  memberId: string;
  eventId: string | null;
  pointsAwarded: number;
  occurrence?: string;
  status?: string;
  claimedAt?: string | null;
  recordType?: "ISSUED" | "CLAIM";
  metadata: unknown;
  createdAt: string;
  member: CampaignIssuanceMember | null;
}

export interface CampaignIssuanceStatus {
  campaign: {
    id: string;
    name: string;
    eventType: string | null;
    issuancePolicy: string;
    issuanceMode: "AUTO" | "CLAIM";
    approvalStatus: string;
    isActive: boolean;
    startsAt: string | null;
    endsAt: string | null;
    maxBudget: number | null;
    segmentId: string | null;
  };
  status: string;
  issuedCount: number;
  totalPoints: number;
  pendingClaims: number;
  items: CampaignIssuanceItem[];
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CampaignEstimate {
  estimatedMembers: number;
  estimatedPoints: number;
  estimatedCost: number;
}

export type CouponMode = "SHARED" | "INDIVIDUAL" | "LIMITED";

export type CouponDiscountType =
  | "PERCENTAGE"
  | "FIXED"
  | "FREE_PRODUCT"
  | "FREE_SHIPPING"
  | "EXTRA_POINTS"
  | "EXPERIENCE";

export interface Coupon {
  id: string;
  programId: string;
  code: string;
  mode: CouponMode;
  discountType: CouponDiscountType;
  discountValue: number | null;
  minPurchase: number | null;
  maxUses: number | null;
  maxUsesPerMember: number | null;
  usedCount: number;
  isStackable: boolean;
  isActive: boolean;
  channels: string[];
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: CreatedBy | null;
}

export interface CouponStats {
  totalRedemptions: number;
  uniqueMembers: number;
  totalDiscount: number;
  redemptionRate: number;
}

export type SegmentType = "STATIC" | "DYNAMIC";

export interface RuleCondition {
  field: string;
  eq?: unknown;
  neq?: unknown;
  gt?: number;
  lt?: number;
  gte?: number;
  lte?: number;
  in?: unknown[];
  between?: [number, number];
  contains?: string;
}

export interface RuleGroup {
  all?: (RuleCondition | RuleGroup)[];
  any?: (RuleCondition | RuleGroup)[];
}

export interface Segment {
  id: string;
  programId: string;
  name: string;
  description: string | null;
  type: SegmentType;
  rules: RuleGroup | null;
  memberIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: CreatedBy | null;
}

export interface SegmentMemberCount {
  count: number;
}

export interface SegmentMember {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  department: string | null;
  status: string;
  joinedAt: string;
  totalSpent: number;
  currentTier: string | null;
}

export interface GiftCardBatch {
  id: string;
  programId: string;
  name: string;
  quantity: number;
  initialAmount: number;
  currency: string;
  prefix?: string;
  expirationDate: string;
  termsTemplateId: string;
  status: string;
  generatedCount: number;
  createdById: string;
  createdAt: string;
  createdBy?: CreatedBy | null;
}

export interface GiftCard {
  id: string;
  code: string;
  batchId: string;
  initialAmount: number;
  balance: number;
  currency: string;
  expirationDate: string;
  status: string;
  activatedAt?: string;
  lastRedemptionAt?: string;
}

export interface GiftCardTransaction {
  id: string;
  giftCardId: string;
  type: string;
  amount: number;
  balanceAfter: number;
  memberId?: string;
  orderRef?: string;
  idempotencyKey?: string;
  createdById?: string;
  createdAt: string;
}

export interface TermsTemplate {
  id: string;
  programId: string;
  name: string;
  locale: string;
  body: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  createdBy?: CreatedBy | null;
}

export interface GiftCardMetrics {
  outstandingBalances: { programId: string; currency: string; total: number }[];
  active: number;
  outstandingBalance: number;
}
