import { prisma } from "../db.js";

type Request = { requestedByType: string; requestedById: string; payload: unknown };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";

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
