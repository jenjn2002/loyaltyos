import { prisma } from "../db.js";

type Request = { requestedByType: string; requestedById: string; payload: unknown };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";

const ACTION_LABELS: Record<string, { "en-US": string; "vi-VN": string }> = {
  CAMPAIGN_ISSUANCE_PROPOSAL: { "en-US": "Campaign", "vi-VN": "Chiến dịch" },
  POINT_ISSUANCE_PROPOSAL: { "en-US": "Point grant", "vi-VN": "Cấp điểm" },
  PROJECT_PLAN_APPROVAL: { "en-US": "Project plan", "vi-VN": "Kế hoạch dự án" },
  PROJECT_POINT_ISSUANCE: { "en-US": "Project point distribution", "vi-VN": "Phân bổ điểm dự án" },
  POINT_EXCHANGE: { "en-US": "Point exchange", "vi-VN": "Đổi điểm" },
  REWARD_REDEMPTION: { "en-US": "Reward redemption", "vi-VN": "Đổi phần thưởng" },
  CUSTOM_DOCUMENT_APPROVAL: { "en-US": "Custom document", "vi-VN": "Chứng từ tùy chỉnh" },
};

const SUBJECT_LABELS: Record<string, { "en-US": string; "vi-VN": string }> = {
  CAMPAIGN_ISSUANCE: { "en-US": "Campaign", "vi-VN": "Chiến dịch" },
  POINT_ISSUANCE_PROPOSAL: { "en-US": "Member point grant", "vi-VN": "Cấp điểm thành viên" },
  Project: { "en-US": "Project", "vi-VN": "Dự án" },
  ProjectIssueBatch: { "en-US": "Project point distribution", "vi-VN": "Phân bổ điểm dự án" },
  PointExchangeRequest: { "en-US": "Point exchange", "vi-VN": "Đổi điểm" },
  RewardRedemption: { "en-US": "Reward redemption", "vi-VN": "Đổi phần thưởng" },
  CustomDocument: { "en-US": "Custom document", "vi-VN": "Chứng từ tùy chỉnh" },
};

export function approvalActionLabels(actionKey: string): { "en-US": string; "vi-VN": string } {
  return ACTION_LABELS[actionKey] ?? { "en-US": "Approval request", "vi-VN": "Yêu cầu phê duyệt" };
}

export function approvalSubjectLabels(subjectType: string): { "en-US": string; "vi-VN": string } {
  return SUBJECT_LABELS[subjectType] ?? { "en-US": "Request", "vi-VN": "Yêu cầu" };
}

const LEGACY_STATUS_LABELS: Record<string, { "en-US": string; "vi-VN": string }> = {
  APPROVED: { "en-US": "approved", "vi-VN": "được phê duyệt" },
  REJECTED: { "en-US": "rejected", "vi-VN": "bị từ chối" },
  CANCELLED: { "en-US": "cancelled", "vi-VN": "bị hủy" },
  COMPLETED: { "en-US": "completed", "vi-VN": "hoàn tất" },
};

export function approvalResolutionNotificationCopy(input: {
  actionKey: string;
  subjectType: string;
  subjectName: string;
  status: string;
  comment?: string | null;
  locale: "en-US" | "vi-VN";
}): { title: string; body: string } {
  const isVietnamese = input.locale === "vi-VN";
  const status = LEGACY_STATUS_LABELS[input.status]?.[input.locale] ?? (isVietnamese ? "đã xử lý" : "resolved");
  const titleStatus = input.status === "APPROVED"
    ? isVietnamese ? "Đã phê duyệt" : "Approved"
    : input.status === "REJECTED"
      ? isVietnamese ? "Đã từ chối" : "Rejected"
      : input.status === "CANCELLED"
        ? isVietnamese ? "Đã hủy" : "Cancelled"
        : input.status === "COMPLETED"
          ? isVietnamese ? "Đã hoàn tất" : "Completed"
        : status;
  const labels = approvalActionLabels(input.actionKey);
  const subjectName = input.subjectName.trim() || approvalSubjectLabels(input.subjectType)[input.locale];
  const actionLabel = labels[input.locale];
  const body = isVietnamese
    ? `${actionLabel} “${subjectName}” ${input.status === "APPROVED" ? "đã được phê duyệt" : input.status === "REJECTED" ? "đã bị từ chối" : input.status === "CANCELLED" ? "đã bị hủy" : input.status === "COMPLETED" ? "đã hoàn tất" : status}.`
    : `${actionLabel} “${subjectName}” was ${status}.`;
  const comment = input.comment?.trim();
  return {
    title: `${subjectName} · ${titleStatus}`,
    body: [body, comment].filter(Boolean).join(" "),
  };
}

/** True only for the exact built-in legacy copies; custom notification text remains untouched. */
export function isLegacyApprovalResolutionNotification(input: {
  title: string;
  body: string;
  actionKey: string;
  subjectType: string;
  status: string;
  comment?: string | null;
}): boolean {
  const viStatus = LEGACY_STATUS_LABELS[input.status]?.["vi-VN"];
  const enStatus = LEGACY_STATUS_LABELS[input.status]?.["en-US"];
  if (!viStatus || !enStatus) return false;
  const comment = input.comment?.trim();
  const suffix = comment ? ` ${comment}` : "";
  const legacyCopies = [
    {
      title: `Yêu cầu ${input.actionKey} đã ${viStatus}`,
      body: `Yêu cầu phê duyệt ${input.actionKey} cho ${input.subjectType} ${viStatus}.${suffix}`,
    },
    {
      title: `${input.actionKey} request ${enStatus}`,
      body: `Your ${input.actionKey} request for ${input.subjectType} was ${enStatus}.${suffix}`,
    },
  ];
  const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
  return legacyCopies.some((legacy) => normalize(legacy.title) === normalize(input.title) && normalize(legacy.body) === normalize(input.body));
}

export interface ApprovalResolutionCandidate {
  id: string;
  actionKey: string;
  status: string;
  subjectType: string;
  subjectId: string;
  resolutionComment: string | null;
  resolvedAt: Date | null;
  payload: unknown;
}

/** Resolve old notification links without guessing across other subjects or unrelated approvals. */
export function findLegacyApprovalResolutionCandidate(input: {
  requestId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  title: string;
  body: string;
  createdAt: Date;
}, candidates: ApprovalResolutionCandidate[]): ApprovalResolutionCandidate | null {
  const linked = input.requestId
    ? candidates.filter((candidate) => candidate.id === input.requestId)
    : input.entityType && input.entityId
      ? candidates.filter((candidate) => candidate.subjectType === input.entityType && candidate.subjectId === input.entityId)
      : [];
  const notificationTime = input.createdAt.getTime();
  const enqueueToleranceMs = 5 * 60 * 1000;
  return linked
    .filter((candidate) => candidate.resolvedAt !== null)
    .filter((candidate) => {
      const resolvedAt = candidate.resolvedAt!.getTime();
      return Math.abs(notificationTime - resolvedAt) <= enqueueToleranceMs;
    })
    .filter((candidate) => isLegacyApprovalResolutionNotification({
      title: input.title,
      body: input.body,
      actionKey: candidate.actionKey,
      subjectType: candidate.subjectType,
      status: candidate.status,
      comment: candidate.resolutionComment,
    }))
    .sort((left, right) => Math.abs(notificationTime - left.resolvedAt!.getTime()) - Math.abs(notificationTime - right.resolvedAt!.getTime()))[0] ?? null;
}

/** Resolve a readable subject name for approval notifications without crossing program boundaries. */
export async function approvalSubjectName(
  programId: string,
  subjectType: string,
  subjectId: string,
  payloadInput: unknown,
): Promise<string> {
  const payload = object(payloadInput);
  if (subjectType === "CustomDocument") {
    const document = await prisma.customDocument.findFirst({ where: { id: subjectId, programId }, select: { title: true } });
    return document?.title || text(payload.documentTitle) || "Custom document";
  }
  if (subjectType === "CAMPAIGN_ISSUANCE") {
    const campaign = await prisma.campaign.findFirst({ where: { id: subjectId, programId }, select: { name: true } });
    return (campaign?.name ?? text(payload.name)) || "Campaign";
  }
  if (subjectType === "Project") {
    const project = await prisma.project.findFirst({ where: { id: subjectId, programId }, select: { name: true } });
    return (project?.name ?? text(payload.projectName)) || "Project";
  }
  if (subjectType === "ProjectIssueBatch") {
    const batch = await prisma.projectIssueBatch.findFirst({
      where: { id: subjectId, project: { programId } },
      select: { project: { select: { name: true } } },
    });
    return (batch?.project.name ?? text(payload.projectName)) || "Project point distribution";
  }
  if (subjectType === "PointExchangeRequest") {
    const exchange = await prisma.pointExchangeRequest.findFirst({ where: { id: subjectId, programId }, select: { documentNumber: true } });
    return (exchange?.documentNumber ?? text(payload.documentNumber)) || "Point exchange";
  }
  if (subjectType === "RewardRedemption") {
    const redemption = await prisma.rewardRedemption.findFirst({
      where: { id: subjectId, reward: { programId } },
      select: { reward: { select: { name: true } } },
    });
    return (redemption?.reward.name ?? text(payload.rewardName)) || "Reward redemption";
  }
  if (subjectType === "POINT_ISSUANCE_PROPOSAL" || typeof payload.memberId === "string") {
    const memberId = subjectType === "POINT_ISSUANCE_PROPOSAL" ? subjectId : text(payload.memberId);
    const member = await prisma.member.findFirst({
      where: { id: memberId, programId },
      select: { firstName: true, lastName: true, email: true },
    });
    return [member?.firstName, member?.lastName].filter(Boolean).join(" ") || member?.email || text(payload.memberName) || "Member";
  }
  return text(payload.projectName) || text(payload.name) || text(payload.documentNumber) || approvalSubjectLabels(subjectType)["en-US"];
}

/** Display-only enrichment of already authorized requests; all lookups stay in the program. */
export async function withApprovalDisplay<T extends Request>(programId: string, requests: T[]) {
  const payloads = requests.map((request) => object(request.payload));
  const adminIds = requests.filter((request) => request.requestedByType === "ADMIN_USER").map((request) => request.requestedById);
  const memberIds = [...requests.filter((request) => request.requestedByType === "MEMBER").map((request) => request.requestedById), ...payloads.map((payload) => text(payload.memberId))].filter(Boolean);
  const pointIds = payloads.map((payload) => text(payload.pointTypeId)).filter(Boolean);
  const segmentIds = payloads.map((payload) => text(payload.segmentId)).filter(Boolean);
  const eventKeys = payloads.map((payload) => text(payload.eventType)).filter(Boolean);
  const [admins, members, pointTypes, segments, events] = await Promise.all([
    adminIds.length ? prisma.adminUser.findMany({ where: { programId, id: { in: adminIds } }, select: { id: true, name: true, email: true } }) : [],
    memberIds.length ? prisma.member.findMany({ where: { programId, id: { in: memberIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [],
    pointIds.length ? prisma.pointTypeDefinition.findMany({ where: { programId, id: { in: pointIds } }, select: { id: true, name: true, code: true } }) : [],
    segmentIds.length ? prisma.segment.findMany({ where: { programId, id: { in: segmentIds } }, select: { id: true, name: true } }) : [],
    eventKeys.length ? prisma.eventDefinition.findMany({ where: { programId, key: { in: eventKeys } }, select: { key: true, name: true } }) : [],
  ]);
  const adminsById = new Map(admins.map((admin) => [admin.id, { name: admin.name, email: admin.email }]));
  const membersById = new Map(members.map((member) => [member.id, { name: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email || "", email: member.email }]));
  const pointsById = new Map(pointTypes.map((point) => [point.id, { name: point.name, code: point.code }]));
  const segmentsById = new Map(segments.map((segment) => [segment.id, segment.name]));
  const eventsByKey = new Map(events.map((event) => [event.key, event.name]));
  return requests.map((request, index) => {
    const payload = payloads[index]!;
    return { ...request, display: {
      requester: request.requestedByType === "ADMIN_USER" ? adminsById.get(request.requestedById) ?? null : request.requestedByType === "MEMBER" ? membersById.get(request.requestedById) ?? null : null,
      member: membersById.get(text(payload.memberId)) ?? null,
      pointType: pointsById.get(text(payload.pointTypeId)) ?? null,
      segmentName: segmentsById.get(text(payload.segmentId)) ?? null,
      eventName: eventsByKey.get(text(payload.eventType)) ?? null,
    } };
  });
}
