import type { PrismaClient } from "@prisma/client";

import { createRepository } from "./repository.js";
import {
  evaluateRulesInContext,
  hasComputedFields,
  ruleGroupToPrismaWhere,
} from "./rule-evaluator.js";
import { segmentCreateSchema, segmentUpdateSchema } from "./schemas.js";
import type {
  MemberWithComputedFields,
  SegmentCreateInput,
  SegmentEvaluationResult,
  SegmentListFilters,
  SegmentRow,
  SegmentUpdateInput,
} from "./types.js";
import { SegmentNotActiveError, SegmentNotFoundError, SegmentNotStaticError } from "./types.js";

const DAY_MS = 86_400_000;

function monthDay(value: Date): string {
  return value.toISOString().slice(5, 10);
}

function memberContext(member: MemberWithComputedFields): Record<string, unknown> {
  const now = new Date();
  return {
    totalSpent: member.totalSpent,
    currentTier: member.currentTier,
    tags: member.tags,
    metadata: member.metadata ?? {},
    status: member.status,
    department: member.department,
    joinedAt: member.joinedAt.getTime(),
    lastActiveAt: member.lastActiveAt?.getTime() ?? null,
    accountAgeDays: Math.max(0, Math.floor((now.getTime() - member.joinedAt.getTime()) / DAY_MS)),
    joinedMonthDay: monthDay(member.joinedAt),
    todayMonthDay: monthDay(now),
    email: member.email,
    phone: member.phone,
    firstName: member.firstName,
    lastName: member.lastName,
  };
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class SegmentsService {
  private repo: ReturnType<typeof createRepository>;

  constructor(prisma: PrismaClient) {
    this.repo = createRepository(prisma);
  }

  async create(input: SegmentCreateInput): Promise<SegmentRow> {
    const parsed = segmentCreateSchema.parse(input) as SegmentCreateInput;
    return this.repo.createSegment(parsed);
  }

  async update(id: string, input: SegmentUpdateInput): Promise<SegmentRow> {
    const parsed = segmentUpdateSchema.parse(input) as SegmentUpdateInput;
    const segment = await this.repo.findById(id);
    if (!segment) throw new SegmentNotFoundError(id);
    return this.repo.updateSegment(id, parsed);
  }

  async delete(id: string): Promise<void> {
    const segment = await this.repo.findById(id);
    if (!segment) throw new SegmentNotFoundError(id);
    await this.repo.updateSegment(id, { isActive: false });
  }

  async getById(id: string): Promise<SegmentRow> {
    const segment = await this.repo.findById(id);
    if (!segment) throw new SegmentNotFoundError(id);
    return segment;
  }

  async list(
    programId: string,
    filters: SegmentListFilters = {},
  ): Promise<PaginatedResult<SegmentRow>> {
    const { items, total } = await this.repo.findMany(programId, filters);
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

  async evaluate(memberId: string, segmentId: string): Promise<SegmentEvaluationResult> {
    const segment = await this.repo.findById(segmentId);
    if (!segment) throw new SegmentNotFoundError(segmentId);
    if (!segment.isActive) throw new SegmentNotActiveError(segmentId);

    if (segment.type === "STATIC") {
      return { belongsTo: segment.memberIds.includes(memberId) };
    }

    const memberCtx = await this.repo.findMemberWithAccountAndTiers(memberId);
    if (!memberCtx || memberCtx.deletedAt) {
      return { belongsTo: false };
    }

    const context = memberContext(memberCtx);

    const belongsTo = evaluateRulesInContext(
      segment.rules as Record<string, unknown> | null,
      context,
    );
    return { belongsTo };
  }

  async getMembers(
    segmentId: string,
    pagination?: { page?: number; pageSize?: number },
  ): Promise<PaginatedResult<MemberWithComputedFields>> {
    const segment = await this.repo.findById(segmentId);
    if (!segment) throw new SegmentNotFoundError(segmentId);

    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 20;

    if (segment.type === "STATIC") {
      if (segment.memberIds.length === 0) {
        return { items: [], total: 0, page, pageSize, totalPages: 0 };
      }
      const result = await this.repo.findMembersByIds(segment.memberIds, { page, pageSize }, segment.programId);
      return { ...result, page, pageSize, totalPages: Math.ceil(result.total / pageSize) };
    }

    const rules = segment.rules as Record<string, unknown> | null;
    if (!rules || Object.keys(rules).length === 0) {
      return { items: [], total: 0, page, pageSize, totalPages: 0 };
    }

    if (hasComputedFields(rules)) {
      const allMembers = await this.repo.findMembersWithAccounts(segment.programId);
      const filtered = allMembers.filter((m) => {
        const context = memberContext(m);
        return evaluateRulesInContext(rules, context);
      });

      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const items = filtered.slice(start, start + pageSize);
      return {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }

    const where = { ...ruleGroupToPrismaWhere(rules), programId: segment.programId };
    const result = await this.repo.findMembersByWhere(where, { page, pageSize });
    return { ...result, page, pageSize, totalPages: Math.ceil(result.total / pageSize) };
  }

  async estimateCount(programId: string, rules: Record<string, unknown> | null): Promise<number> {
    if (!rules || Object.keys(rules).length === 0) return 0;

    if (hasComputedFields(rules)) {
      const allMembers = await this.repo.findMembersWithAccounts(programId);
      return allMembers.filter((m) => {
        const context = memberContext(m);
        return evaluateRulesInContext(rules, context);
      }).length;
    }

    const where = { ...ruleGroupToPrismaWhere(rules), programId };
    return this.repo.countMembersByWhere(where);
  }

  async count(segmentId: string): Promise<number> {
    const segment = await this.repo.findById(segmentId);
    if (!segment) throw new SegmentNotFoundError(segmentId);

    if (segment.type === "STATIC") {
      return segment.memberIds.length;
    }

    return this.estimateCount(segment.programId, segment.rules as Record<string, unknown> | null);
  }

  async addMembers(segmentId: string, memberIds: string[]): Promise<SegmentRow> {
    const segment = await this.repo.findById(segmentId);
    if (!segment) throw new SegmentNotFoundError(segmentId);
    if (segment.type !== "STATIC") throw new SegmentNotStaticError(segmentId);
    return this.repo.addMemberIds(segmentId, memberIds);
  }

  async removeMembers(segmentId: string, memberIds: string[]): Promise<SegmentRow> {
    const segment = await this.repo.findById(segmentId);
    if (!segment) throw new SegmentNotFoundError(segmentId);
    if (segment.type !== "STATIC") throw new SegmentNotStaticError(segmentId);
    return this.repo.removeMemberIds(segmentId, segment.memberIds, memberIds);
  }
}
