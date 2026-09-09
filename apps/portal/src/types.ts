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

/** @deprecated Point types are program-defined; use a pointTypeId string. */
export type CreditType = string;

export interface CreditBalance {
  pointTypeId: string;
  code: string;
  name: string;
  unitLabel: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  expiryMode: "NEVER" | "AFTER_DAYS" | "FIXED_DATE" | "PER_GRANT";
  expiryDays: number | null;
  fixedExpiryAt: string | null;
  expiryWarningDays: number[];
  transferable: boolean;
  redeemable: boolean;
  exchangeable: boolean;
  cashEligible: boolean;
  bankEnabled: boolean;
  giveEnabled: boolean;
  giveSource: "BALANCE" | "ALLOWANCE" | "BOTH";
  requireGiveMessage: boolean;
  allowMultiRecipient: boolean;
  maxRecipients: number;
  pairLimit: number | null;
  pairLimitPeriodDays: number;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  isPrimary: boolean;
  showZeroBalance: boolean;
  allowance: {
    allocated: number;
    remaining: number;
    cycleStart: string | null;
    cycleEnd: string | null;
    cycleDays: number;
  } | null;
  transferTargets: {
    id: string;
    code: string;
    name: string;
    unitLabel: string;
    color: string | null;
    sourceAmount: number;
    destinationAmount: number;
  }[];
}

export type CustomPointWallet = CreditBalance;

export interface CreditExchangeRate {
  id: string;
  pointTypeId: string;
  version: number;
  valueMinorPerPoint: number;
  currency: string;
  payoutMechanism: string;
  payoutType: "CASH" | "NON_CASH";
  minPoints: number;
  maxPoints: number | null;
  periodLimitPoints: number | null;
  periodDays: number;
  isActive: boolean;
  pointType: {
    id: string;
    code: string;
    name: string;
    unitLabel: string;
    color: string | null;
  };
}

export interface CreditTransaction {
  id: string;
  pointTypeId: string;
  action: string;
  amount: number;
  balanceAfter: number;
  source: string;
  reason: string | null;
  message: string | null;
  category: string | null;
  counterpartyMemberId: string | null;
  counterparty?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
  categoryRef?: { name: string } | null;
  pointType: {
    id: string;
    code: string;
    name: string;
    unitLabel: string;
    color: string | null;
  };
  metadata?: Record<string, unknown> | null;
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
  counterparty?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
}

export interface PointTransaction {
  id: string;
  action: string;
  amount: number;
  balanceAfter: number;
  source: string;
  reason: string | null;
  message: string | null;
  pointType: {
    id: string;
    code: string;
    name: string;
    unitLabel: string;
    color: string | null;
  };
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
  pointPrices?: {
    id: string;
    pointTypeId: string;
    amount: number;
    pointType: {
      id: string;
      code: string;
      name: string;
      unitLabel: string;
      color: string | null;
    };
    availableBalance?: number;
    eligible?: boolean;
  }[];
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
  pointTypeId: string | null;
  pointType: { code: string; name: string; unitLabel: string } | null;
  reward: { name: string; description: string | null };
}
