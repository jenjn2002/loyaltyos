export interface MemberProfile {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  department?: string | null;
  photoUrl?: string | null;
  joinedAt: string;
}

export interface Balance {
  confirmed: number;
  pending: number;
  total: number;
}

export type CreditType = "P" | "R";

export interface CreditBalance {
  creditType: CreditType;
  balance: number;
  totalGranted: number;
  totalSpent: number;
}

export interface CreditExchangeRate {
  id: string;
  creditType: CreditType;
  version: number;
  valueMinorPerCredit: number;
  currency: string;
  payoutMechanism: string;
  cashEligible: boolean;
  minCredits: number;
  maxCredits: number | null;
  isActive: boolean;
}

export interface CreditTransaction {
  id: string;
  creditType: CreditType;
  type: string;
  amount: number;
  balanceAfter: number;
  source: string;
  reason: string | null;
  message: string | null;
  category: string | null;
  counterpartyMemberId: string | null;
  counterparty?: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null;
  categoryRef?: { name: string } | null;
  createdAt: string;
}

export interface CreditHistory {
  items: CreditTransaction[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CreditCategory {
  id: string;
  name: string;
  description: string | null;
}

export interface RecognitionFeedItem extends CreditTransaction {
  member?: { id: string; firstName: string | null; lastName: string | null; email: string | null };
  counterparty?: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null;
}

export interface PointTransaction {
  id: string;
  type: "EARN" | "REDEEM" | "ADJUST" | "REVERSE" | "EXPIRE";
  amount: number;
  balanceAfter: number;
  source: string;
  description: string | null;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Reward {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
  stock: number | null;
  imageUrl: string | null;
  category: string | null;
  tierRequired: string | null;
  isActive: boolean;
  redemptions: { id: string; memberId: string }[];
}

export interface RewardDetail extends Reward {
  eligible?: boolean;
  reason?: string;
}

export interface BadgeProgress {
  progress: number;
  currentValue: number;
  targetValue: number;
  unlocked: boolean;
  unlockedAt: string | null;
  remainingCount: number;
  badge: {
    id: string;
    name: string;
    description: string | null;
    type: string;
    imageUrl: string | null;
  };
}

export interface TierStatus {
  currentTier: {
    id: string;
    name: string;
    rank: number;
    minPoints: number;
    color: string | null;
    iconUrl: string | null;
  } | null;
  nextTier: {
    id: string;
    name: string;
    rank: number;
    minPoints: number;
  } | null;
  pointsProgress: number;
  pointsToNext: number | null;
}

export interface RedeemResult {
  redemption: {
    id: string;
    rewardId: string;
    memberId: string;
    pointsSpent: number;
  };
  transaction: {
    transactionId: string;
    amount: number;
    balanceAfter: number;
  };
}

export interface MemberRewardRedemption {
  id: string;
  rewardId: string;
  pointsSpent: number;
  fulfillmentStatus: "PENDING" | "FULFILLED" | "CANCELLED";
  redeemedAt: string;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  reward: { name: string; description: string | null };
}
