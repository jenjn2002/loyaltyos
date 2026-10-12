import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  customFunctionDefinition: { findMany: vi.fn() },
  customAttachment: { count: vi.fn() },
}));
vi.mock("../db.js", () => ({ prisma: mocks }));

import {
  customFieldSchema,
  definitionSchema,
  fieldVisible,
  validateConfiguredValues,
  validateCustomValues,
  validateDefinition,
  visibleValues,
  type CustomDefinitionInput,
  type CustomField,
} from "../lib/customization.js";
import { LoyaltyError } from "../lib/errors.js";
import { walletService } from "../lib/wallets.js";
import { pointExchangeApprovalHook } from "../lib/workflow-integrations.js";

function field(key: string, type: CustomField["type"], options: Partial<CustomField> = {}): CustomField {
  return customFieldSchema.parse({ key, label: key, type, ...options });
}

function definition(overrides: Partial<CustomDefinitionInput> = {}): CustomDefinitionInput {
  return definitionSchema.parse({
    key: "project_note",
    name: "Project note",
    context: "CUSTOM",
    fields: [],
    states: [
      { key: "DRAFT", label: "Draft", initial: true, terminal: false },
      { key: "APPROVED", label: "Approved", terminal: true },
      { key: "REJECTED", label: "Rejected", terminal: true },
    ],
    transitions: [],
    readRoles: ["SUPER_ADMIN"],
    writeRoles: ["SUPER_ADMIN"],
    isActive: true,
    ...overrides,
  });
}

function expectCustomizationError(action: () => unknown, code: string): void {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(LoyaltyError);
  expect(error).toMatchObject({ code });
}

describe("custom field validation", () => {
  it("rejects invalid calendar dates and unsafe URL schemes", () => {
    expectCustomizationError(
      () => validateCustomValues([field("start_date", "DATE")], { start_date: "2026-02-30" }),
      "CUSTOMIZATION_FIELD_INVALID",
    );
    expectCustomizationError(
      () => validateCustomValues([field("reference", "URL")], { reference: "javascript:alert(1)" }),
      "CUSTOMIZATION_FIELD_INVALID",
    );
    expectCustomizationError(
      () => validateCustomValues([field("reference", "URL")], { reference: "https://user:pass@example.test" }),
      "CUSTOMIZATION_FIELD_INVALID",
    );
  });

  it("enforces number, string, select, and multiselect value types and choices", () => {
    const fields = [
      field("score", "NUMBER"),
      field("summary", "TEXT"),
      field("priority", "SELECT", { options: ["low", "high"] }),
      field("tags", "MULTI_SELECT", { options: ["finance", "people"] }),
    ];

    expect(validateCustomValues(fields, {
      score: 2.5,
      summary: "review",
      priority: "high",
      tags: ["finance", "people"],
    })).toEqual({ score: 2.5, summary: "review", priority: "high", tags: ["finance", "people"] });
    for (const values of [
      { score: "12" },
      { summary: 12 },
      { priority: "urgent" },
      { tags: ["finance", "unknown"] },
      { tags: ["finance", "finance"] },
    ]) {
      expectCustomizationError(
        () => validateCustomValues(fields, values),
        "CUSTOMIZATION_FIELD_INVALID",
      );
    }
  });

  it("allows missing required values only while drafting and defaults omitted booleans to false", () => {
    const fields = [field("title", "TEXT", { required: true }), field("enabled", "BOOLEAN")];

    expect(validateCustomValues(fields, {}, {}, true)).toEqual({ enabled: false });
    expectCustomizationError(
      () => validateCustomValues(fields, {}, {}, false),
      "CUSTOMIZATION_FIELD_REQUIRED",
    );
  });

  it("rejects unknown, archived, and reserved field keys", () => {
    expectCustomizationError(
      () => validateCustomValues([field("known", "TEXT")], { extra: "not defined" }),
      "CUSTOMIZATION_FIELD_UNKNOWN_OR_ARCHIVED",
    );
    expectCustomizationError(
      () => validateCustomValues([field("archived", "TEXT", { isActive: false })], { archived: "changed" }),
      "CUSTOMIZATION_FIELD_UNKNOWN_OR_ARCHIVED",
    );
    for (const key of ["constructor", "prototype"]) {
      expect(() => customFieldSchema.parse({ key, label: "Reserved", type: "TEXT" })).toThrow();
    }
  });

  it("filters private and inactive fields from values by role", () => {
    const fields = [
      field("public_note", "TEXT"),
      field("private_note", "TEXT", { readRoles: ["SUPER_ADMIN"] }),
      field("inactive_note", "TEXT", { isActive: false }),
    ];
    const values = { public_note: "shared", private_note: "confidential", inactive_note: "old" };

    expect(fieldVisible(fields[1]!, "ANALYST")).toBe(false);
    expect(visibleValues(fields, values, "ANALYST")).toEqual({ public_note: "shared" });
    expect(visibleValues(fields, values, "SUPER_ADMIN")).toEqual({
      public_note: "shared",
      private_note: "confidential",
    });
  });

  it("rejects FILE payload metadata outside the canonical reference shape", () => {
    const fileField = field("evidence", "FILE");
    for (const extra of [
      { base64: "aGVsbG8=" },
      { url: "https://example.test/proof.png" },
    ]) {
      expectCustomizationError(
        () => validateCustomValues([fileField], {
          evidence: { kind: "FILE", attachmentId: "attachment-1", name: "proof.png", ...extra },
        }),
        "CUSTOMIZATION_FIELD_INVALID",
      );
    }
  });

  it("accepts only a canonical FILE reference owned by the scoped project uploader", async () => {
    mocks.customFunctionDefinition.findMany.mockResolvedValue([{
      fields: [field("evidence", "FILE")],
      readRoles: ["SUPER_ADMIN"],
    }]);
    mocks.customAttachment.count.mockResolvedValue(1);

    const values = await validateConfiguredValues(
      "program-a",
      "PROJECT_DISTRIBUTION",
      { evidence: { kind: "FILE", attachmentId: "attachment-1", name: "proof.png" } },
      { role: "SUPER_ADMIN", adminId: "admin-1", projectId: "project-1" },
    );

    expect(values).toEqual({ evidence: { kind: "FILE", attachmentId: "attachment-1", name: "proof.png" } });
    expect(mocks.customAttachment.count).toHaveBeenCalledWith({
      where: {
        id: { in: ["attachment-1"] },
        programId: "program-a",
        contextType: "PROJECT",
        contextId: "project-1",
        uploadedByAdminId: "admin-1",
      },
    });
  });
});

describe("custom definition state graph", () => {
  const submitTransition = {
    key: "submit",
    label: "Submit",
    from: "DRAFT",
    to: "APPROVED",
    roles: ["SUPER_ADMIN"],
  };

  it("requires a single initial state and unique field, state, and transition keys", () => {
    expectCustomizationError(
      () => validateDefinition(definition({ states: [{ key: "DRAFT", label: "Draft", initial: false }] })),
      "CUSTOMIZATION_INITIAL_STATE_REQUIRED",
    );
    expectCustomizationError(
      () => validateDefinition(definition({ states: [
        { key: "DRAFT", label: "Draft", initial: true },
        { key: "REVIEW", label: "Review", initial: true },
      ] })),
      "CUSTOMIZATION_INITIAL_STATE_REQUIRED",
    );
    expectCustomizationError(
      () => validateDefinition(definition({ fields: [field("note", "TEXT"), field("note", "TEXT")] })),
      "CUSTOMIZATION_DUPLICATE_KEY",
    );
    expectCustomizationError(
      () => validateDefinition(definition({ states: [
        { key: "DRAFT", label: "Draft", initial: true },
        { key: "DRAFT", label: "Duplicate" },
      ] })),
      "CUSTOMIZATION_DUPLICATE_KEY",
    );
    expectCustomizationError(
      () => validateDefinition(definition({ transitions: [submitTransition, submitTransition] })),
      "CUSTOMIZATION_DUPLICATE_KEY",
    );
  });

  it("rejects invalid edges, transitions out of terminal states, and built-in workflows", () => {
    for (const transition of [
      { ...submitTransition, from: "MISSING" },
      { ...submitTransition, to: "MISSING" },
      { ...submitTransition, from: "DRAFT", to: "DRAFT" },
      { ...submitTransition, from: "APPROVED", to: "DRAFT" },
    ]) {
      expectCustomizationError(
        () => validateDefinition(definition({ transitions: [transition] })),
        "CUSTOMIZATION_TRANSITION_INVALID",
      );
    }
    expectCustomizationError(
      () => validateDefinition(definition({ context: "MEMBER", transitions: [submitTransition] })),
      "CUSTOMIZATION_BUILTIN_WORKFLOW_PROTECTED",
    );
  });

  it("requires transition roles to be included in write roles and selection fields to define options", () => {
    expectCustomizationError(
      () => validateDefinition(definition({ transitions: [{ ...submitTransition, roles: ["OPERATOR"] }] })),
      "CUSTOMIZATION_TRANSITION_ROLE_INVALID",
    );
    expectCustomizationError(
      () => validateDefinition(definition({ fields: [field("choice", "SELECT")] })),
      "CUSTOMIZATION_OPTIONS_REQUIRED",
    );
    expectCustomizationError(
      () => validateDefinition(definition({ fields: [field("choice", "MULTI_SELECT", { options: ["A", "A"] })] })),
      "CUSTOMIZATION_DUPLICATE_OPTION",
    );
    expectCustomizationError(
      () => validateDefinition(definition({
        readRoles: ["SUPER_ADMIN", "OPERATOR"],
        writeRoles: ["SUPER_ADMIN", "OPERATOR"],
        fields: [field("private_required", "TEXT", { required: true, readRoles: ["SUPER_ADMIN"] })],
      })),
      "CUSTOMIZATION_REQUIRED_FIELD_HIDDEN",
    );
  });
});

describe("custom-document approval hook", () => {
  beforeEach(() => vi.restoreAllMocks());

  function pendingDocument() {
    return {
      id: "document-1",
      programId: "program-a",
      status: "DRAFT",
      approvalRequestId: "approval-1",
      pendingTransition: {
        key: "submit",
        from: "DRAFT",
        to: "APPROVED",
        approvalRequestId: "approval-1",
      },
      version: 7,
    };
  }

  function hookInput(overrides: Record<string, unknown> = {}) {
    return {
      id: "approval-1",
      programId: "program-a",
      actionKey: "CUSTOM_DOCUMENT_APPROVAL",
      subjectType: "CustomDocument",
      subjectId: "document-1",
      ...overrides,
    } as Parameters<typeof pointExchangeApprovalHook>[1];
  }

  it.each([
    ["APPROVE", "APPROVED"],
    ["REJECT", "DRAFT"],
  ] as const)("applies %s to the snapshotted target state and clears the pending transition", async (decision, expectedStatus) => {
    const document = pendingDocument();
    const tx = {
      customDocument: {
        findFirst: vi.fn().mockResolvedValue(document),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          const version = data.version as { increment: number };
          Object.assign(document, data, { version: document.version + version.increment });
          return document;
        }),
      },
    };
    const walletSpies = [
      vi.spyOn(walletService, "issueWithTransaction"),
      vi.spyOn(walletService, "reserveProjectBudgetWithTransaction"),
      vi.spyOn(walletService, "updateExchangeRequestWithTransaction"),
    ];

    await pointExchangeApprovalHook(
      tx as never,
      hookInput(),
      decision,
      "approver-9",
      "Reviewed",
    );

    expect(tx.customDocument.findFirst).toHaveBeenCalledWith({
      where: {
        id: "document-1",
        programId: "program-a",
        approvalRequestId: "approval-1",
        archivedAt: null,
      },
    });
    expect(tx.customDocument.update).toHaveBeenCalledWith({
      where: { id: "document-1" },
      data: {
        status: expectedStatus,
        pendingTransition: Prisma.DbNull,
        updatedByAdminId: "approver-9",
        version: { increment: 1 },
      },
    });
    expect(document).toMatchObject({ status: expectedStatus, updatedByAdminId: "approver-9", version: 8 });
    expect(document.pendingTransition).toBe(Prisma.DbNull);
    for (const walletSpy of walletSpies) expect(walletSpy).not.toHaveBeenCalled();
  });

  it("does not resolve a stale or mismatched approval snapshot", async () => {
    const document = pendingDocument();
    document.pendingTransition.approvalRequestId = "different-approval";
    const tx = {
      customDocument: {
        findFirst: vi.fn().mockResolvedValue(document),
        update: vi.fn(),
      },
    };

    await expect(pointExchangeApprovalHook(
      tx as never,
      hookInput(),
      "APPROVE",
      "approver-9",
    )).rejects.toThrow("Custom document transition is no longer pending");
    expect(tx.customDocument.update).not.toHaveBeenCalled();
  });

  it("scopes the pending lookup to the approval program and request ID", async () => {
    const document = pendingDocument();
    const tx = {
      customDocument: {
        findFirst: vi.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          where.programId === document.programId && where.approvalRequestId === document.approvalRequestId
            ? document
            : null,
        ),
        update: vi.fn(),
      },
    };

    await expect(pointExchangeApprovalHook(
      tx as never,
      hookInput({ programId: "program-b" }),
      "APPROVE",
      "approver-9",
    )).rejects.toThrow("Custom document transition is no longer pending");
    await expect(pointExchangeApprovalHook(
      tx as never,
      hookInput({ id: "approval-other" }),
      "APPROVE",
      "approver-9",
    )).rejects.toThrow("Custom document transition is no longer pending");
    expect(tx.customDocument.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.customDocument.update).not.toHaveBeenCalled();
  });

  it("ignores unrelated approval contexts", async () => {
    const tx = { customDocument: { findFirst: vi.fn(), update: vi.fn() } };

    await pointExchangeApprovalHook(tx as never, hookInput({ actionKey: "PROJECT_PLAN_APPROVAL" }), "APPROVE", "approver-9");

    expect(tx.customDocument.findFirst).not.toHaveBeenCalled();
    expect(tx.customDocument.update).not.toHaveBeenCalled();
  });
});
