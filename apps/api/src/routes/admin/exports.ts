import type { AdminCapability } from "../../lib/permissions.js";
import { assertCapability } from "../../lib/permissions.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { LoyaltyError } from "../../lib/errors.js";
import { translateLegacyText } from "@loyaltyos/i18n";

const maxExportRows = 50_000;
const exportSchema = z.object({
  dataset: z.string().trim().min(1).max(80),
  fields: z.array(z.string().trim().min(1).max(160)).min(1).max(500),
  locale: z.enum(["vi-VN", "en-US"]).default("vi-VN"),
});

interface ExportField {
  key: string;
  label: string;
}

interface ExportDataset {
  key: string;
  label: string;
  description: string;
  capability: AdminCapability;
  fields: ExportField[];
}

type ExportRow = Record<string, unknown>;

const fields = (...definitions: Array<[string, string]>): ExportField[] =>
  definitions.map(([key, label]) => ({ key, label }));

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readableValue(value: unknown, locale: "vi-VN" | "en-US" = "en-US"): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return `${value.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}`;
  if (Array.isArray(value)) return value.map((item) => readableValue(item, locale)).filter(Boolean).join("; ");
  if (typeof value === "boolean") return translateLegacyText(value ? "Yes" : "No", locale);
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null) {
    const decimal = value as { toNumber?: unknown; toString?: unknown };
    if (typeof decimal.toNumber === "function" && typeof decimal.toString === "function") return decimal.toString();
  }
  if (typeof value !== "string") return "";
  if (value === "Unlimited") return translateLegacyText(value, locale);
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(value) || /^[A-Z]{3,}$/.test(value)) {
    const label = value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
    return translateLegacyText(label, locale);
  }
  return value;
}

function csvCell(value: unknown, locale: "vi-VN" | "en-US"): string {
  let text = readableValue(value, locale);
  // Prevent spreadsheet formula execution while keeping numeric values numeric.
  if (typeof value === "string" && /^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function ruleSummary(value: unknown): string {
  const renderCondition = (condition: Record<string, unknown>): string => {
    const field = String(condition.field ?? "Member field").replaceAll("_", " ");
    const operations: Array<[string, string]> = [
      ["eq", "is"], ["neq", "is not"], ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["contains", "contains"], ["in", "is one of"], ["between", "is between"],
    ];
    for (const [key, operator] of operations) {
      if (condition[key] === undefined) continue;
      const operand = Array.isArray(condition[key]) ? condition[key].map((value) => readableValue(value)).join(" and ") : readableValue(condition[key]);
      return `${field} ${operator} ${operand}`;
    }
    return field;
  };
  const renderGroup = (input: unknown): string => {
    if (Array.isArray(input)) return input.map(renderGroup).filter(Boolean).join(", ");
    const object = asRecord(input);
    if (typeof object.field === "string") return renderCondition(object);
    const all = Array.isArray(object.all) ? object.all.map(renderGroup).filter(Boolean) : [];
    const any = Array.isArray(object.any) ? object.any.map(renderGroup).filter(Boolean) : [];
    const parts = [all.length ? `all: ${all.join(" AND ")}` : "", any.length ? `any: ${any.join(" OR ")}` : ""].filter(Boolean);
    return parts.join("; ");
  };
  return renderGroup(value);
}

function memberName(member: { firstName: string | null; lastName: string | null }): string {
  return [member.firstName, member.lastName].filter(Boolean).join(" ");
}

async function sourceLabels(programId: string, sources: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(sources.filter(Boolean))];
  const campaignIds = unique.filter((source) => source.startsWith("campaign:")).map((source) => source.slice("campaign:".length));
  const rewardIds = unique.filter((source) => source.startsWith("reward:")).map((source) => source.slice("reward:".length));
  const adminIds = unique.filter((source) => source.startsWith("admin:")).map((source) => source.slice("admin:".length));
  const [campaigns, rewards, admins] = await Promise.all([
    campaignIds.length ? prisma.campaign.findMany({ where: { programId, id: { in: campaignIds } }, select: { id: true, name: true } }) : [],
    rewardIds.length ? prisma.reward.findMany({ where: { programId, id: { in: rewardIds } }, select: { id: true, name: true } }) : [],
    adminIds.length ? prisma.adminUser.findMany({ where: { programId, id: { in: adminIds } }, select: { id: true, name: true, email: true } }) : [],
  ]);
  const labels = new Map<string, string>();
  for (const source of unique) {
    const [prefix, id] = source.split(":", 2);
    if (prefix === "campaign") labels.set(source, `Campaign: ${campaigns.find((item) => item.id === id)?.name ?? "deleted campaign"}`);
    else if (prefix === "reward") labels.set(source, `Reward redemption: ${rewards.find((item) => item.id === id)?.name ?? "deleted reward"}`);
    else if (prefix === "admin") {
      const actor = admins.find((item) => item.id === id);
      labels.set(source, actor ? `Admin adjustment: ${actor.name} (${actor.email})` : "Admin adjustment");
    } else if (source === "member:exchange") labels.set(source, "Member exchange");
    else labels.set(source, source.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase()));
  }
  return labels;
}

async function buildCatalog(programId: string): Promise<ExportDataset[]> {
  const [pointTypes, customFields] = await Promise.all([
    prisma.pointTypeDefinition.findMany({ where: { programId }, orderBy: { sortOrder: "asc" } }),
    prisma.memberFieldDefinition.findMany({ where: { programId }, orderBy: { sortOrder: "asc" } }),
  ]);
  const memberFields = [
    ...fields(
      ["memberId", "Member ID"], ["email", "Email"], ["externalId", "External ID"], ["phone", "Phone"],
      ["firstName", "First name"], ["lastName", "Last name"], ["department", "Department"], ["photoUrl", "Photo URL"],
      ["status", "Member status"], ["username", "Username"], ["locale", "Preferred language"], ["tags", "Tags"],
      ["joinedAt", "Joined at"], ["lastActiveAt", "Last active at"], ["createdAt", "Account created at"],
    ),
    ...customFields.map((field) => ({ key: `custom:${field.key}`, label: field.label })),
    ...pointTypes.map((pointType) => ({ key: `balance:${pointType.id}`, label: `Balance · ${pointType.name} (${pointType.code})` })),
  ];
  const rewardFields = [
    ...fields(
      ["rewardId", "Reward ID"], ["name", "Reward name"], ["description", "Description"], ["category", "Category"],
      ["tierRequired", "Required tier"], ["stock", "Stock remaining"], ["isActive", "Active"],
      ["availableFrom", "Available from"], ["availableUntil", "Available until"], ["createdAt", "Created at"],
    ),
    ...pointTypes.map((pointType) => ({ key: `price:${pointType.id}`, label: `Points required · ${pointType.name} (${pointType.code})` })),
  ];

  return [
    { key: "members", label: "Members", description: "Member profiles, custom member fields and current point balances. Passwords and authentication secrets are never included.", capability: "member.view", fields: memberFields },
    { key: "member_fields", label: "Member field definitions", description: "Custom profile fields configured for members, including their type and whether they are required.", capability: "member.view", fields: fields(["key", "Field key"], ["label", "Field name"], ["type", "Field type"], ["required", "Required"], ["options", "Available choices"], ["isActive", "Active"], ["createdAt", "Created at"]) },
    { key: "point_transactions", label: "Point transaction ledger", description: "Individual point transactions with member and point type names.", capability: "wallet.view", fields: fields(["transactionId", "Transaction ID"], ["memberId", "Member ID"], ["memberName", "Member name"], ["memberEmail", "Member email"], ["pointType", "Point type"], ["action", "Transaction type"], ["amount", "Amount"], ["balanceAfter", "Balance after"], ["source", "Source"], ["category", "Category"], ["reason", "Reason"], ["message", "Message"], ["expiresAt", "Expires at"], ["createdAt", "Transaction date"]) },
    { key: "credit_transactions", label: "P/R credit ledger", description: "P-credit and R-credit history, with member identity and readable transaction details.", capability: "wallet.view", fields: fields(["transactionId", "Transaction ID"], ["memberId", "Member ID"], ["memberName", "Member name"], ["memberEmail", "Member email"], ["creditType", "Credit type"], ["transactionType", "Transaction type"], ["amount", "Amount"], ["balanceAfter", "Balance after"], ["source", "Source"], ["category", "Category"], ["reason", "Reason"], ["message", "Message"], ["expiresAt", "Expires at"], ["createdAt", "Transaction date"]) },
    { key: "credit_exchange_requests", label: "P/R credit exchange requests", description: "P-credit and R-credit exchange requests, requester, payout details and approval or fulfillment status.", capability: "exchange.view", fields: fields(["requestId", "Request ID"], ["memberId", "Member ID"], ["memberName", "Member name"], ["memberEmail", "Member email"], ["creditType", "Credit type"], ["amount", "Amount"], ["valueMinor", "Payout value (minor units)"], ["currency", "Currency"], ["payoutMechanism", "Payout method"], ["payoutType", "Payout type"], ["status", "Status"], ["requestedAt", "Requested at"], ["approvedAt", "Approved at"], ["approvedBy", "Approved by (ID)"], ["fulfilledAt", "Fulfilled at"], ["fulfilledBy", "Fulfilled by (ID)"], ["cancelledAt", "Cancelled at"], ["cancellationReason", "Cancellation reason"]) },
    { key: "point_exchange_requests", label: "Point exchange requests", description: "Custom point conversion or payout requests with member, amount, rate and processing status.", capability: "exchange.view", fields: fields(["requestId", "Request ID"], ["documentNumber", "Document number"], ["memberId", "Member ID"], ["memberName", "Member name"], ["memberEmail", "Member email"], ["pointType", "Point type"], ["amount", "Amount"], ["valueMinor", "Payout value (minor units)"], ["currency", "Currency"], ["payoutMechanism", "Payout method"], ["payoutType", "Payout type"], ["status", "Status"], ["requestedAt", "Requested at"], ["approvedAt", "Approved at"], ["approvedBy", "Approved by (ID)"], ["approvalNote", "Approval note"], ["completedAt", "Completed at"], ["completedBy", "Completed by (ID)"], ["completionReference", "Completion reference"], ["cancelledAt", "Cancelled at"], ["cancellationReason", "Cancellation reason"]) },
    { key: "point_types", label: "Point type registry", description: "Point types and their expiry, transfer and usage settings. Complex configuration JSON is omitted.", capability: "point_type.view", fields: fields(["pointTypeId", "Point type ID"], ["code", "Code"], ["name", "Name"], ["unitLabel", "Unit label"], ["description", "Description"], ["expiryMode", "Expiry policy"], ["expiryDays", "Expiry days"], ["fixedExpiryAt", "Fixed expiry date"], ["transferable", "Transfer enabled"], ["redeemable", "Redemption enabled"], ["exchangeable", "Exchange enabled"], ["bankEnabled", "Bank enabled"], ["giveEnabled", "Give enabled"], ["allowManualAdjustment", "Manual adjustment enabled"], ["isActive", "Active"], ["createdAt", "Created at"]) },
    { key: "point_transfer_rules", label: "Point transfer rules", description: "Allowed source-to-destination point conversions and their configured ratios.", capability: "point_type.view", fields: fields(["sourceType", "Give source"], ["destinationType", "Receive type"], ["sourceAmount", "Source amount"], ["destinationAmount", "Receive amount"], ["isActive", "Active"], ["createdAt", "Created at"]) },
    { key: "point_issuance_rules", label: "Point issuance rules", description: "Automatic point issuance conditions, schedule and limits in readable form.", capability: "issuance.view", fields: fields(["event", "Event"], ["pointType", "Point type"], ["multiplier", "Points / multiplier"], ["conditions", "Condition summary"], ["isActive", "Active"], ["startsAt", "Starts at"], ["endsAt", "Ends at"], ["createdAt", "Created at"]) },
    { key: "bank_cycles", label: "Point bank cycles", description: "Cycle windows, allocations, closing balances, notes and clearing reasons.", capability: "bank.view", fields: fields(["cycleId", "Cycle ID"], ["pointType", "Point type"], ["startsAt", "Cycle starts"], ["endsAt", "Cycle ends"], ["status", "Cycle status"], ["opening", "Opening balance"], ["allocated", "Allocated points"], ["closing", "Closing balance"], ["note", "Cycle note"], ["clearReason", "Closing / clearing reason"], ["clearedAt", "Closed at"], ["clearedBy", "Closed by (ID)"], ["createdAt", "Opened at"]) },
    { key: "bank_transactions", label: "Point bank transactions", description: "Movements into and out of point banks, including the cycle and reason.", capability: "bank.view", fields: fields(["transactionId", "Transaction ID"], ["pointType", "Point type"], ["cycleId", "Cycle ID"], ["type", "Movement type"], ["amount", "Amount"], ["balanceAfter", "Bank balance after"], ["reason", "Reason"], ["actorId", "Performed by (ID)"], ["createdAt", "Transaction date"]) },
    { key: "credit_bank_cycles", label: "P/R credit bank cycles", description: "P-credit and R-credit bank cycle opening, allocation, closing and status totals.", capability: "bank.view", fields: fields(["startsAt", "Cycle starts"], ["endsAt", "Cycle ends"], ["status", "Cycle status"], ["openingP", "Opening P-credit balance"], ["openingR", "Opening R-credit balance"], ["allocatedP", "Allocated P-credit"], ["allocatedR", "Allocated R-credit"], ["closingP", "Closing P-credit balance"], ["closingR", "Closing R-credit balance"], ["clearedAt", "Closed at"], ["clearedBy", "Closed by (ID)"], ["note", "Cycle note"], ["createdAt", "Opened at"]) },
    { key: "credit_bank_transactions", label: "P/R credit bank transactions", description: "Movements into and out of P-credit and R-credit banks, including the cycle and reason.", capability: "bank.view", fields: fields(["creditType", "Credit type"], ["type", "Movement type"], ["amount", "Amount"], ["balanceAfter", "Bank balance after"], ["reason", "Reason"], ["actorId", "Performed by (ID)"], ["cycleId", "Cycle ID"], ["createdAt", "Transaction date"]) },
    { key: "campaigns", label: "Campaigns", description: "Campaign setup and status, without exporting raw rule or A/B configuration JSON.", capability: "campaign.view", fields: fields(["campaignId", "Campaign ID"], ["name", "Campaign name"], ["description", "Description"], ["type", "Campaign type"], ["event", "Trigger event"], ["policy", "Approval policy"], ["approvalStatus", "Approval status"], ["issuanceMode", "Point delivery mode"], ["pointType", "Point type"], ["points", "Points per member"], ["budget", "Point budget"], ["maxUsesPerMember", "Maximum uses per member"], ["segment", "Audience segment"], ["isActive", "Active"], ["startsAt", "Starts at"], ["endsAt", "Ends at"], ["createdBy", "Created by"], ["createdAt", "Created at"]) },
    { key: "campaign_issuance", label: "Campaign issuance and claims", description: "Who received or was offered points from each campaign, including claim status.", capability: "campaign.view", fields: fields(["recordType", "Record type"], ["campaign", "Campaign"], ["memberId", "Member ID"], ["memberName", "Member name"], ["memberEmail", "Member email"], ["department", "Department"], ["pointType", "Point type"], ["points", "Points"], ["status", "Issuance / claim status"], ["event", "Trigger event"], ["occurrence", "Occurrence"], ["variant", "A/B variant"], ["createdAt", "Issued / offered at"], ["claimedAt", "Claimed at"]) },
    { key: "events", label: "Event definitions", description: "Configured event names, trigger modes and time zones.", capability: "event.view", fields: fields(["eventId", "Event ID"], ["name", "Event name"], ["key", "Event key"], ["description", "Description"], ["mode", "Trigger mode"], ["timezone", "Time zone"], ["isActive", "Active"], ["createdAt", "Created at"]) },
    { key: "check_ins", label: "Member check-in history", description: "Completed member check-ins with event, date and member details.", capability: "event.view", fields: fields(["eventKey", "Check-in event"], ["eventName", "Event name"], ["checkInDate", "Check-in date"], ["memberId", "Member ID"], ["memberName", "Member name"], ["memberEmail", "Member email"], ["department", "Department"], ["createdAt", "Recorded at"]) },
    { key: "coupons", label: "Coupons", description: "Coupon codes, discount rules and usage limits.", capability: "coupon.view", fields: fields(["couponId", "Coupon ID"], ["code", "Coupon code"], ["mode", "Coupon mode"], ["discountType", "Discount type"], ["discountValue", "Discount value"], ["minimumPurchase", "Minimum purchase"], ["uses", "Times used"], ["maxUses", "Maximum uses"], ["maxUsesPerMember", "Maximum uses per member"], ["isStackable", "Can combine with other offers"], ["channels", "Available channels"], ["isExpired", "Expired"], ["startsAt", "Starts at"], ["expiresAt", "Expires at"], ["createdAt", "Created at"]) },
    { key: "coupon_redemptions", label: "Coupon redemptions", description: "Members and dates associated with redeemed coupons.", capability: "coupon.view", fields: fields(["coupon", "Coupon code"], ["memberId", "Member ID"], ["memberName", "Member name"], ["memberEmail", "Member email"], ["redeemedAt", "Redeemed at"]) },
    { key: "recognition_categories", label: "Recognition categories", description: "Categories used to classify recognition and credit transactions.", capability: "recognition.view", fields: fields(["name", "Category name"], ["description", "Description"], ["isActive", "Active"], ["createdAt", "Created at"]) },
    { key: "rewards", label: "Rewards", description: "Reward catalogue and point prices by point type.", capability: "reward.view", fields: rewardFields },
    { key: "reward_redemptions", label: "Reward redemptions", description: "Members, points spent and fulfillment status for redeemed rewards.", capability: "reward.view", fields: fields(["reward", "Reward"], ["memberId", "Member ID"], ["memberName", "Member name"], ["memberEmail", "Member email"], ["pointType", "Point type"], ["pointsSpent", "Points spent"], ["status", "Fulfillment status"], ["redeemedAt", "Redeemed at"], ["fulfilledAt", "Fulfilled at"]) },
    { key: "segments", label: "Segments", description: "Segment definitions and a plain-language summary of their rules.", capability: "segment.view", fields: fields(["segmentId", "Segment ID"], ["name", "Segment name"], ["description", "Description"], ["type", "Segment type"], ["rules", "Rule summary"], ["staticMemberCount", "Selected members"], ["isActive", "Active"], ["createdAt", "Created at"]) },
    { key: "tiers", label: "Tiers", description: "Tier levels and readable point qualification requirements.", capability: "tier.view", fields: fields(["tierId", "Tier ID"], ["name", "Tier name"], ["rank", "Rank"], ["requirements", "Qualification requirements"], ["qualificationLogic", "Rule logic"], ["color", "Color"], ["createdAt", "Created at"]) },
    { key: "member_tiers", label: "Member tiers", description: "Current tier assignment and upgrade date for each member.", capability: "tier.view", fields: fields(["memberId", "Member ID"], ["memberName", "Member name"], ["memberEmail", "Member email"], ["tier", "Tier"], ["upgradedAt", "Reached tier at"]) },
    { key: "badges", label: "Badges", description: "Badge catalogue with a readable summary of award conditions.", capability: "badge.view", fields: fields(["badgeId", "Badge ID"], ["name", "Badge name"], ["type", "Badge type"], ["description", "Description"], ["conditions", "Condition summary"], ["isActive", "Active"], ["createdAt", "Created at"]) },
    { key: "member_badges", label: "Member badges", description: "Badge progress and unlock dates for members.", capability: "badge.view", fields: fields(["memberId", "Member ID"], ["memberName", "Member name"], ["memberEmail", "Member email"], ["badge", "Badge"], ["progress", "Progress"], ["unlockedAt", "Unlocked at"]) },
    { key: "approval_requests", label: "Approval requests", description: "Approval subject, requester, current status and resolution details. Request payload JSON is omitted.", capability: "approval.view", fields: fields(["requestId", "Request ID"], ["action", "Approval type"], ["subjectType", "Requested item type"], ["subjectId", "Requested item ID"], ["status", "Status"], ["requesterType", "Requested by type"], ["requesterId", "Requested by ID"], ["workflow", "Workflow"], ["requestedAt", "Requested at"], ["resolvedAt", "Resolved at"], ["resolvedBy", "Resolved by (ID)"], ["resolutionComment", "Resolution comment"]) },
    { key: "workflows", label: "Approval workflows", description: "Workflow names, action keys, status and policy; nested workflow JSON is omitted.", capability: "workflow.view", fields: fields(["workflowId", "Workflow ID"], ["name", "Workflow name"], ["actionKey", "Action key"], ["description", "Description"], ["priority", "Priority"], ["selfApprovalPolicy", "Self-approval policy"], ["isActive", "Active"], ["createdAt", "Created at"]) },
    { key: "logs", label: "System logs", description: "Audit events with readable actor, target and changed-field summaries (not raw JSON).", capability: "audit.view", fields: fields(["logId", "Log ID"], ["date", "Date"], ["actorType", "Actor type"], ["actor", "Performed by"], ["action", "Action"], ["feature", "Feature"], ["targetId", "Target ID"], ["reason", "Reason"], ["details", "Recorded details"]) },
    { key: "notification_templates", label: "Notification templates", description: "Template names, language, channel, trigger and readable message content.", capability: "notification.view", fields: fields(["templateId", "Template ID"], ["name", "Template name"], ["language", "Language"], ["channel", "Channel"], ["trigger", "Trigger"], ["subject", "Subject"], ["message", "Message text"], ["transactional", "Transactional"], ["createdAt", "Created at"]) },
    { key: "notifications", label: "Notification delivery history", description: "Recipient, channel and delivery status without exporting internal payloads.", capability: "notification.view", fields: fields(["notificationId", "Notification ID"], ["memberId", "Member ID"], ["memberName", "Member name"], ["memberEmail", "Member email"], ["template", "Template"], ["channel", "Channel"], ["status", "Delivery status"], ["subject", "Subject"], ["sentAt", "Sent at"], ["readAt", "Read at"], ["createdAt", "Created at"]) },
    { key: "gift_card_batches", label: "Gift card batches", description: "Batch-level gift card status and totals. Card codes are not exported here; use the secured export in each batch.", capability: "giftcard.view", fields: fields(["batchId", "Batch ID"], ["name", "Batch name"], ["quantity", "Requested cards"], ["generatedCount", "Cards generated"], ["initialAmount", "Initial amount per card"], ["currency", "Currency"], ["expirationDate", "Expiration date"], ["status", "Batch status"], ["terms", "Terms"], ["createdBy", "Created by"], ["createdAt", "Created at"]) },
    { key: "coalition_transactions", label: "Coalition transactions", description: "Coalition account transactions with member and external reference details.", capability: "coalition.view", fields: fields(["memberId", "Member ID"], ["memberName", "Member name"], ["memberEmail", "Member email"], ["provider", "Provider"], ["type", "Transaction type"], ["amount", "Amount"], ["localReference", "Local reference"], ["externalReference", "External reference"], ["status", "Status"], ["attempts", "Attempts"], ["createdAt", "Created at"]) },
  ];
}

function memberBase(member: { id: string; email: string | null; externalId: string | null; phone: string | null; firstName: string | null; lastName: string | null; department: string | null; photoUrl: string | null; status: string; locale: string | null; tags: string[]; joinedAt: Date; lastActiveAt: Date | null; createdAt: Date }) {
  return {
    memberId: member.id,
    email: member.email,
    externalId: member.externalId,
    phone: member.phone,
    firstName: member.firstName,
    lastName: member.lastName,
    memberName: memberName(member),
    department: member.department,
    photoUrl: member.photoUrl,
    status: member.status,
    locale: member.locale,
    tags: member.tags,
    joinedAt: member.joinedAt,
    lastActiveAt: member.lastActiveAt,
    createdAt: member.createdAt,
  };
}

async function loadRows(dataset: string, programId: string, catalog: ExportDataset[]): Promise<ExportRow[]> {
  const selected = catalog.find((item) => item.key === dataset);
  if (!selected) throw new LoyaltyError("EXPORT_DATASET_NOT_FOUND", 404);

  switch (dataset) {
    case "members": {
      const members = await prisma.member.findMany({
        where: { programId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: maxExportRows + 1,
        include: {
          credential: { select: { username: true } },
          pointWallets: { include: { pointType: { select: { id: true } } } },
        },
      });
      return members.map((member) => {
        const row: ExportRow = { ...memberBase(member), username: member.credential?.username ?? null };
        const metadata = asRecord(member.metadata);
        for (const field of selected.fields) {
          if (field.key.startsWith("custom:")) row[field.key] = metadata[field.key.slice("custom:".length)];
          if (field.key.startsWith("balance:")) row[field.key] = member.pointWallets.find((wallet) => wallet.pointTypeId === field.key.slice("balance:".length))?.balance ?? 0;
        }
        return row;
      });
    }
    case "member_fields": {
      const definitions = await prisma.memberFieldDefinition.findMany({ where: { programId }, orderBy: { sortOrder: "asc" }, take: maxExportRows + 1 });
      return definitions.map((item) => ({ key: item.key, label: item.label, type: item.type, required: item.required, options: Array.isArray(item.options) ? item.options.map((value) => readableValue(value)).join("; ") : "", isActive: item.isActive, createdAt: item.createdAt }));
    }
    case "point_transactions": {
      const transactions = await prisma.customPointTransaction.findMany({
        where: { programId }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1,
        include: { member: { select: { id: true, email: true, firstName: true, lastName: true } }, pointType: { select: { code: true, name: true } }, categoryRef: { select: { name: true } } },
      });
      const sources = await sourceLabels(programId, transactions.map((item) => item.source));
      return transactions.map((item) => ({ transactionId: item.id, memberId: item.memberId, memberName: memberName(item.member), memberEmail: item.member.email, pointType: `${item.pointType.name} (${item.pointType.code})`, action: item.action, amount: item.amount, balanceAfter: item.balanceAfter, source: sources.get(item.source) ?? item.source, category: item.categoryRef?.name ?? item.category, reason: item.reason, message: item.message, expiresAt: item.expiresAt, createdAt: item.createdAt }));
    }
    case "credit_transactions": {
      const transactions = await prisma.creditTransaction.findMany({
        where: { programId }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1,
        include: { member: { select: { id: true, email: true, firstName: true, lastName: true } }, categoryRef: { select: { name: true } } },
      });
      const sources = await sourceLabels(programId, transactions.map((item) => item.source));
      return transactions.map((item) => ({ transactionId: item.id, memberId: item.memberId, memberName: memberName(item.member), memberEmail: item.member.email, creditType: item.creditType, transactionType: item.type, amount: item.amount, balanceAfter: item.balanceAfter, source: sources.get(item.source) ?? item.source, category: item.categoryRef?.name ?? item.category, reason: item.reason, message: item.message, expiresAt: item.expiresAt, createdAt: item.createdAt }));
    }
    case "credit_exchange_requests": {
      const requests = await prisma.creditExchangeRequest.findMany({ where: { programId }, include: { member: { select: { id: true, email: true, firstName: true, lastName: true } } }, orderBy: { requestedAt: "desc" }, take: maxExportRows + 1 });
      return requests.map((item) => ({ requestId: item.id, memberId: item.member.id, memberName: memberName(item.member), memberEmail: item.member.email, creditType: item.creditType, amount: item.amount, valueMinor: item.valueMinor, currency: item.currency, payoutMechanism: item.payoutMechanism, payoutType: item.payoutType, status: item.status, requestedAt: item.requestedAt, approvedAt: item.approvedAt, approvedBy: item.approvedBy, fulfilledAt: item.fulfilledAt, fulfilledBy: item.fulfilledBy, cancelledAt: item.cancelledAt, cancellationReason: item.cancellationReason }));
    }
    case "point_exchange_requests": {
      const requests = await prisma.pointExchangeRequest.findMany({ where: { programId }, include: { member: { select: { id: true, email: true, firstName: true, lastName: true } }, pointType: { select: { name: true, code: true } } }, orderBy: { requestedAt: "desc" }, take: maxExportRows + 1 });
      return requests.map((item) => ({ requestId: item.id, documentNumber: item.documentNumber, memberId: item.member.id, memberName: memberName(item.member), memberEmail: item.member.email, pointType: `${item.pointType.name} (${item.pointType.code})`, amount: item.amount, valueMinor: item.valueMinor, currency: item.currency, payoutMechanism: item.payoutMechanism, payoutType: item.payoutType, status: item.status, requestedAt: item.requestedAt, approvedAt: item.approvedAt, approvedBy: item.approvedBy, approvalNote: item.approvalNote, completedAt: item.completedAt, completedBy: item.completedBy, completionReference: item.completionReference, cancelledAt: item.cancelledAt, cancellationReason: item.cancellationReason }));
    }
    case "point_types": {
      const types = await prisma.pointTypeDefinition.findMany({ where: { programId }, orderBy: { sortOrder: "asc" }, take: maxExportRows + 1 });
      return types.map((item) => ({ pointTypeId: item.id, code: item.code, name: item.name, unitLabel: item.unitLabel, description: item.description, expiryMode: item.expiryMode, expiryDays: item.expiryDays, fixedExpiryAt: item.fixedExpiryAt, transferable: item.transferable, redeemable: item.redeemable, exchangeable: item.exchangeable, bankEnabled: item.bankEnabled, giveEnabled: item.giveEnabled, allowManualAdjustment: item.allowManualAdjustment, isActive: item.isActive, createdAt: item.createdAt }));
    }
    case "point_transfer_rules": {
      const rules = await prisma.pointTransferRule.findMany({ where: { programId }, include: { sourceType: { select: { name: true, code: true } }, destinationType: { select: { name: true, code: true } } }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return rules.map((item) => ({ sourceType: `${item.sourceType.name} (${item.sourceType.code})`, destinationType: `${item.destinationType.name} (${item.destinationType.code})`, sourceAmount: item.sourceAmount, destinationAmount: item.destinationAmount, isActive: item.isActive, createdAt: item.createdAt }));
    }
    case "point_issuance_rules": {
      const rules = await prisma.pointRule.findMany({ where: { programId }, include: { pointType: { select: { name: true, code: true } } }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return rules.map((item) => ({ event: item.eventType, pointType: item.pointType ? `${item.pointType.name} (${item.pointType.code})` : "All point types", multiplier: item.multiplier, conditions: ruleSummary(item.conditions), isActive: item.isActive, startsAt: item.startsAt, endsAt: item.endsAt, createdAt: item.createdAt }));
    }
    case "bank_cycles": {
      const cycles = await prisma.pointBankCycle.findMany({ where: { programId }, include: { pointType: { select: { code: true, name: true } } }, orderBy: { startsAt: "desc" }, take: maxExportRows + 1 });
      return cycles.map((item) => ({ cycleId: item.id, pointType: `${item.pointType.name} (${item.pointType.code})`, startsAt: item.startsAt, endsAt: item.endsAt, status: item.status, opening: item.opening, allocated: item.allocated, closing: item.closing, note: item.note, clearReason: item.clearReason, clearedAt: item.clearedAt, clearedBy: item.clearedBy, createdAt: item.createdAt }));
    }
    case "bank_transactions": {
      const transactions = await prisma.pointBankTransaction.findMany({ where: { programId }, include: { pointType: { select: { code: true, name: true } } }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return transactions.map((item) => ({ transactionId: item.id, pointType: `${item.pointType.name} (${item.pointType.code})`, cycleId: item.cycleId, type: item.type, amount: item.amount, balanceAfter: item.balanceAfter, reason: item.reason, actorId: item.actorId, createdAt: item.createdAt }));
    }
    case "credit_bank_cycles": {
      const cycles = await prisma.creditBankCycle.findMany({ where: { programId }, orderBy: { startsAt: "desc" }, take: maxExportRows + 1 });
      return cycles.map((item) => ({ startsAt: item.startsAt, endsAt: item.endsAt, status: item.status, openingP: item.openingP, openingR: item.openingR, allocatedP: item.allocatedP, allocatedR: item.allocatedR, closingP: item.closingP, closingR: item.closingR, clearedAt: item.clearedAt, clearedBy: item.clearedBy, note: item.note, createdAt: item.createdAt }));
    }
    case "credit_bank_transactions": {
      const transactions = await prisma.creditBankTransaction.findMany({ where: { programId }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return transactions.map((item) => ({ creditType: item.creditType, type: item.type, amount: item.amount, balanceAfter: item.balanceAfter, reason: item.reason, actorId: item.actorId, cycleId: item.cycleId, createdAt: item.createdAt }));
    }
    case "campaigns": {
      const campaigns = await prisma.campaign.findMany({ where: { programId, deletedAt: null }, include: { pointType: { select: { code: true, name: true } }, segment: { select: { name: true } }, createdBy: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return campaigns.map((item) => ({ campaignId: item.id, name: item.name, description: item.description, type: item.type, event: item.eventType, policy: item.issuancePolicy, approvalStatus: item.approvalStatus, issuanceMode: item.issuanceMode, pointType: item.pointType ? `${item.pointType.name} (${item.pointType.code})` : null, points: item.multiplier, budget: item.maxBudget ?? "Unlimited", maxUsesPerMember: item.maxUsesPerMember ?? "Unlimited", segment: item.segment?.name, isActive: item.isActive, startsAt: item.startsAt, endsAt: item.endsAt, createdBy: item.createdBy ? `${item.createdBy.name} (${item.createdBy.email})` : "System / legacy", createdAt: item.createdAt }));
    }
    case "campaign_issuance": {
      const [applications, claims] = await Promise.all([
        prisma.campaignApplication.findMany({ where: { campaign: { programId } }, include: { campaign: { select: { name: true, eventType: true, pointType: { select: { name: true, code: true } } } }, variant: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 }),
        prisma.campaignClaim.findMany({ where: { campaign: { programId } }, include: { campaign: { select: { name: true, eventType: true, pointType: { select: { name: true, code: true } } } }, member: { select: { id: true, email: true, firstName: true, lastName: true, department: true } }, variant: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 }),
      ]);
      const memberIds = [...new Set([...applications.map((item) => item.memberId), ...claims.map((item) => item.memberId)])];
      const members = memberIds.length ? await prisma.member.findMany({ where: { programId, id: { in: memberIds } }, select: { id: true, email: true, firstName: true, lastName: true, department: true } }) : [];
      const memberById = new Map(members.map((member) => [member.id, member]));
      const fallbackMember = (id: string) => memberById.get(id) ?? { id, email: null, firstName: "Deleted member", lastName: null, department: null };
      return [
        ...applications.map((item) => { const member = fallbackMember(item.memberId); return { recordType: "ISSUED", campaign: item.campaign.name, memberId: member.id, memberName: memberName(member), memberEmail: member.email, department: member.department, pointType: item.campaign.pointType ? `${item.campaign.pointType.name} (${item.campaign.pointType.code})` : "", points: item.pointsAwarded, status: "ISSUED", event: item.campaign.eventType, occurrence: "", variant: item.variant?.name, createdAt: item.createdAt, claimedAt: null }; }),
        ...claims.map((item) => ({ recordType: "CLAIM", campaign: item.campaign.name, memberId: item.member.id, memberName: memberName(item.member), memberEmail: item.member.email, department: item.member.department, pointType: item.campaign.pointType ? `${item.campaign.pointType.name} (${item.campaign.pointType.code})` : "", points: item.pointsAwarded, status: item.status, event: item.campaign.eventType, occurrence: item.occurrence, variant: item.variant?.name, createdAt: item.createdAt, claimedAt: item.claimedAt })),
      ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    case "events": {
      const definitions = await prisma.eventDefinition.findMany({ where: { programId }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return definitions.map((item) => {
        const automation = asRecord(item.automation);
        return { eventId: item.id, name: item.name, key: item.key, description: item.description, mode: automation.mode, timezone: automation.timezone, isActive: item.isActive, createdAt: item.createdAt };
      });
    }
    case "check_ins": {
      const definitions = await prisma.eventDefinition.findMany({ where: { programId }, select: { name: true, key: true, automation: true } });
      const checkIns = definitions.filter((item) => asRecord(item.automation).mode === "MEMBER_CHECK_IN");
      const byKey = new Map(checkIns.map((item) => [item.key, item.name]));
      if (!checkIns.length) return [];
      const events = await prisma.event.findMany({ where: { programId, type: { in: checkIns.map((item) => item.key) }, processed: true }, include: { member: { select: { id: true, email: true, firstName: true, lastName: true, department: true } } }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return events.map((item) => ({ eventKey: item.type, eventName: byKey.get(item.type), checkInDate: asRecord(item.payload).checkInDate, memberId: item.member?.id, memberName: item.member ? memberName(item.member) : "Deleted member", memberEmail: item.member?.email, department: item.member?.department, createdAt: item.createdAt }));
    }
    case "coupons": {
      const coupons = await prisma.coupon.findMany({ where: { programId, deletedAt: null }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      const now = new Date();
      return coupons.map((item) => ({ couponId: item.id, code: item.code, mode: item.mode, discountType: item.discountType, discountValue: item.discountValue, minimumPurchase: item.minPurchase, uses: item.usedCount, maxUses: item.maxUses, maxUsesPerMember: item.maxUsesPerMember, isStackable: item.isStackable, channels: item.channels, isExpired: item.expiresAt !== null && item.expiresAt < now, startsAt: item.startsAt, expiresAt: item.expiresAt, createdAt: item.createdAt }));
    }
    case "coupon_redemptions": {
      const redemptions = await prisma.couponRedemption.findMany({ where: { coupon: { programId } }, include: { coupon: { select: { code: true } }, member: { select: { id: true, email: true, firstName: true, lastName: true } } }, orderBy: { redeemedAt: "desc" }, take: maxExportRows + 1 });
      return redemptions.map((item) => ({ coupon: item.coupon.code, memberId: item.member.id, memberName: memberName(item.member), memberEmail: item.member.email, redeemedAt: item.redeemedAt }));
    }
    case "recognition_categories": {
      const categories = await prisma.creditCategory.findMany({ where: { programId }, orderBy: { name: "asc" }, take: maxExportRows + 1 });
      return categories.map((item) => ({ name: item.name, description: item.description, isActive: item.isActive, createdAt: item.createdAt }));
    }
    case "rewards": {
      const rewards = await prisma.reward.findMany({ where: { programId, deletedAt: null }, include: { pointPrices: { include: { pointType: { select: { id: true } } } } }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return rewards.map((item) => {
        const row: ExportRow = { rewardId: item.id, name: item.name, description: item.description, category: item.category, tierRequired: item.tierRequired, stock: item.stock, isActive: item.isActive, availableFrom: item.availableFrom, availableUntil: item.availableUntil, createdAt: item.createdAt };
        for (const field of selected.fields) {
          if (field.key.startsWith("price:")) row[field.key] = item.pointPrices.find((price) => price.pointTypeId === field.key.slice("price:".length))?.amount ?? null;
        }
        return row;
      });
    }
    case "reward_redemptions": {
      const redemptions = await prisma.rewardRedemption.findMany({ where: { reward: { programId } }, include: { reward: { select: { name: true } }, member: { select: { id: true, email: true, firstName: true, lastName: true } }, pointType: { select: { name: true, code: true } } }, orderBy: { redeemedAt: "desc" }, take: maxExportRows + 1 });
      return redemptions.map((item) => ({ reward: item.reward.name, memberId: item.member.id, memberName: memberName(item.member), memberEmail: item.member.email, pointType: item.pointType ? `${item.pointType.name} (${item.pointType.code})` : "", pointsSpent: item.pointsSpent, status: item.fulfillmentStatus, redeemedAt: item.redeemedAt, fulfilledAt: item.fulfilledAt }));
    }
    case "segments": {
      const segments = await prisma.segment.findMany({ where: { programId }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return segments.map((item) => ({ segmentId: item.id, name: item.name, description: item.description, type: item.type, rules: item.type === "STATIC" ? "Manually selected members" : ruleSummary(item.rules), staticMemberCount: item.type === "STATIC" ? item.memberIds.length : null, isActive: item.isActive, createdAt: item.createdAt }));
    }
    case "tiers": {
      const pointTypes = await prisma.pointTypeDefinition.findMany({ where: { programId }, select: { id: true, code: true, name: true, unitLabel: true } });
      const tiers = await prisma.tier.findMany({ where: { programId }, include: { pointType: { select: { name: true, code: true } } }, orderBy: { rank: "asc" }, take: maxExportRows + 1 });
      return tiers.map((item) => {
        const qualificationRules = Array.isArray(item.qualificationRules) ? item.qualificationRules.map(asRecord) : [];
        const rules = qualificationRules.map((rule) => {
          const type = pointTypes.find((pointType) => pointType.id === rule.pointTypeId);
          return `${type?.name ?? type?.code ?? "Point type"} ≥ ${readableValue(rule.minPoints)} ${type?.unitLabel ?? "points"}`;
        });
        if (!rules.length && item.pointType) rules.push(`${item.pointType.name} ≥ ${item.minPoints} points`);
        return { tierId: item.id, name: item.name, rank: item.rank, requirements: rules.join(item.qualificationOperator === "OR" ? " OR " : " AND "), qualificationLogic: item.qualificationOperator, color: item.color, createdAt: item.createdAt };
      });
    }
    case "member_tiers": {
      const assignments = await prisma.memberTier.findMany({ where: { member: { programId } }, include: { member: { select: { id: true, email: true, firstName: true, lastName: true } }, tier: { select: { name: true } } }, orderBy: { upgradedAt: "desc" }, take: maxExportRows + 1 });
      return assignments.map((item) => ({ memberId: item.member.id, memberName: memberName(item.member), memberEmail: item.member.email, tier: item.tier.name, upgradedAt: item.upgradedAt }));
    }
    case "badges": {
      const badges = await prisma.badge.findMany({ where: { programId }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return badges.map((item) => ({ badgeId: item.id, name: item.name, type: item.type, description: item.description, conditions: ruleSummary(item.conditions), isActive: item.isActive, createdAt: item.createdAt }));
    }
    case "member_badges": {
      const items = await prisma.memberBadge.findMany({ where: { member: { programId } }, include: { member: { select: { id: true, email: true, firstName: true, lastName: true } }, badge: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return items.map((item) => ({ memberId: item.member.id, memberName: memberName(item.member), memberEmail: item.member.email, badge: item.badge.name, progress: item.progress, unlockedAt: item.unlockedAt }));
    }
    case "approval_requests": {
      const requests = await prisma.approvalRequest.findMany({ where: { programId }, include: { workflow: { select: { name: true } } }, orderBy: { requestedAt: "desc" }, take: maxExportRows + 1 });
      return requests.map((item) => ({ requestId: item.id, action: item.actionKey, subjectType: item.subjectType, subjectId: item.subjectId, status: item.status, requesterType: item.requestedByType, requesterId: item.requestedById, workflow: item.workflow.name, requestedAt: item.requestedAt, resolvedAt: item.resolvedAt, resolvedBy: item.resolvedBy, resolutionComment: item.resolutionComment }));
    }
    case "workflows": {
      const workflows = await prisma.approvalWorkflow.findMany({ where: { programId }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return workflows.map((item) => ({ workflowId: item.id, name: item.name, actionKey: item.actionKey, description: item.description, priority: item.priority, selfApprovalPolicy: item.selfApprovalPolicy, isActive: item.isActive, createdAt: item.createdAt }));
    }
    case "logs": {
      const logs = await prisma.auditLog.findMany({ where: { programId }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      const adminIds = [...new Set(logs.filter((item) => item.actorType === "ADMIN_USER").map((item) => item.actorId))];
      const memberIds = [...new Set(logs.filter((item) => item.actorType === "MEMBER").map((item) => item.actorId))];
      const [admins, members] = await Promise.all([
        adminIds.length ? prisma.adminUser.findMany({ where: { programId, id: { in: adminIds } }, select: { id: true, name: true, email: true } }) : [],
        memberIds.length ? prisma.member.findMany({ where: { programId, id: { in: memberIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [],
      ]);
      return logs.map((item) => {
        const detail = Object.entries(asRecord(item.diff)).filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value) || (Array.isArray(value) && value.every((part) => ["string", "number", "boolean"].includes(typeof part)))).map(([key, value]) => `${key.replaceAll("_", " ")}: ${readableValue(value)}`).join("; ");
        const adminActor = admins.find((actor) => actor.id === item.actorId);
        const memberActor = members.find((actor) => actor.id === item.actorId);
        const actor = adminActor ? `${adminActor.name} (${adminActor.email})` : memberActor ? `${memberName(memberActor)} (${memberActor.email ?? "no email"})` : item.actorType === "SYSTEM" ? "System" : `${item.actorType} · ${item.actorId}`;
        return { logId: item.id, date: item.createdAt, actorType: item.actorType, actor, action: item.action, feature: item.entityType.replaceAll("_", " "), targetId: item.entityId, reason: item.reason, details: detail };
      });
    }
    case "notification_templates": {
      const templates = await prisma.notificationTemplate.findMany({ where: { programId }, orderBy: [{ name: "asc" }, { locale: "asc" }], take: maxExportRows + 1 });
      return templates.map((item) => ({ templateId: item.id, name: item.name, language: item.locale, channel: item.channel, trigger: item.triggerEvent, subject: item.subject, message: item.bodyText ?? item.bodyHtml?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(), transactional: item.transactional, createdAt: item.createdAt }));
    }
    case "notifications": {
      const notifications = await prisma.notification.findMany({ where: { member: { programId } }, include: { member: { select: { id: true, email: true, firstName: true, lastName: true } }, template: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return notifications.map((item) => ({ notificationId: item.id, memberId: item.member.id, memberName: memberName(item.member), memberEmail: item.member.email, template: item.template?.name, channel: item.channel, status: item.status, subject: item.subject, sentAt: item.sentAt, readAt: item.readAt, createdAt: item.createdAt }));
    }
    case "gift_card_batches": {
      const batches = await prisma.giftCardBatch.findMany({ where: { programId }, include: { termsTemplate: { select: { name: true } }, createdBy: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: maxExportRows + 1 });
      return batches.map((item) => ({ batchId: item.id, name: item.name, quantity: item.quantity, generatedCount: item.generatedCount, initialAmount: item.initialAmount, currency: item.currency, expirationDate: item.expirationDate, status: item.status, terms: item.termsTemplate.name, createdBy: `${item.createdBy.name} (${item.createdBy.email})`, createdAt: item.createdAt }));
    }
    case "coalition_transactions": {
      const transactions = await prisma.coalitionTransaction.findMany({
        where: { account: { programId } },
        include: { account: { select: { provider: true, member: { select: { id: true, email: true, firstName: true, lastName: true } } } } },
        orderBy: { createdAt: "desc" },
        take: maxExportRows + 1,
      });
      return transactions.map((item) => ({ memberId: item.account.member.id, memberName: memberName(item.account.member), memberEmail: item.account.member.email, provider: item.account.provider, type: item.type, amount: item.amount, localReference: item.localTxRef, externalReference: item.externalTxRef, status: item.status, attempts: item.attempts, createdAt: item.createdAt }));
    }
    default:
      throw new LoyaltyError("EXPORT_DATASET_NOT_FOUND", 404);
  }
}

export function adminExportsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/admin/exports/catalog", async (request, reply) => {
    const catalog = await buildCatalog(request.programId);
    const available = await Promise.all(catalog.map(async (dataset) => {
      try {
        await assertCapability(request, dataset.capability);
        return dataset;
      } catch {
        return null;
      }
    }));
    return reply.send({ data: { datasets: available.filter((dataset): dataset is ExportDataset => dataset !== null) } });
  });

  app.post("/admin/exports", async (request, reply) => {
    const body = exportSchema.parse(request.body);
    const catalog = await buildCatalog(request.programId);
    const dataset = catalog.find((item) => item.key === body.dataset);
    if (!dataset) throw new LoyaltyError("EXPORT_DATASET_NOT_FOUND", 404);
    await assertCapability(request, dataset.capability);
    if (new Set(body.fields).size !== body.fields.length || body.fields.some((key) => !dataset.fields.some((field) => field.key === key))) {
      throw new LoyaltyError("EXPORT_FIELDS_INVALID", 400);
    }

    const rows = await loadRows(dataset.key, request.programId, catalog);
    if (rows.length > maxExportRows) throw new LoyaltyError("EXPORT_ROW_LIMIT_EXCEEDED", 413);
    const selectedFields = body.fields.map((key) => dataset.fields.find((field) => field.key === key)!);
    const header = selectedFields.map((field) => translateLegacyText(field.label, body.locale));
    const lines = [header, ...rows.map((row) => selectedFields.map((field) => row[field.key]))]
      .map((line) => line.map((value) => csvCell(value, body.locale)).join(","));
    const csv = `\uFEFF${lines.join("\r\n")}\r\n`;
    await audit(request.programId, request.actor, "OTHER", "data_export", null, {
      dataset: dataset.key,
      fields: selectedFields.map((field) => field.label),
      rowCount: rows.length,
    });
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="loyaltyos-${dataset.key}.csv"`)
      .header("X-Export-Row-Count", String(rows.length))
      .send(csv);
  });

  done();
}
