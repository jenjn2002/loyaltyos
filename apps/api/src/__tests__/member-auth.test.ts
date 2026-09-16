import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  member: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  memberExternalIdentity: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../db.js", () => ({ prisma: mockPrisma }));

import {
  hashMemberPassword,
  memberCredentialSummary,
  normalizeMemberUsername,
  validateMemberPassword,
  validateMemberUsername,
} from "../lib/member-auth.js";
import {
  buildMicrosoftAuthorizationUrl,
  isMicrosoftTenantId,
  normalizeMicrosoftEmail,
  normalizeMicrosoftScopes,
} from "../lib/microsoft-auth.js";
import { resolveMicrosoftMember } from "../lib/microsoft-member-provisioning.js";

const activeMember = {
  id: "member-a",
  programId: "program-a",
  email: "alex@example.com",
  firstName: "Alex",
  lastName: "Example",
  status: "ACTIVE",
  deletedAt: null,
} as never;

const identity = {
  subject: "ms-subject",
  tenantId: "11111111-1111-4111-8111-111111111111",
  email: "alex@example.com",
  displayName: "Alex Example",
  givenName: "Alex",
  familyName: "Example",
};

function transactionFixture(): typeof mockPrisma {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "program-a" }]),
    member: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    memberExternalIdentity: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };
  mockPrisma.$transaction.mockImplementationOnce(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  return tx as unknown as typeof mockPrisma;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("member credentials", () => {
  it("normalizes usernames within a program without making them global", () => {
    expect(normalizeMemberUsername("  Alice.Example ")).toBe("alice.example");
    expect(validateMemberUsername("Alice.Example")).toBe("alice.example");
  });

  it("enforces the ten-character password minimum and hashes with Argon2id", async () => {
    expect(() => validateMemberPassword("short")).toThrow();
    const hash = await hashMemberPassword("member-password");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(
      memberCredentialSummary({ username: "alice", passwordHash: hash, passwordChangedAt: null }),
    ).toEqual({
      username: "alice",
      credentialsConfigured: true,
      passwordChangedAt: null,
    });
  });

  it("does not expose a password hash for an unprovisioned member", () => {
    expect(memberCredentialSummary(null)).toEqual({
      username: null,
      credentialsConfigured: false,
      passwordChangedAt: null,
    });
  });
});

describe("Microsoft sign-in configuration", () => {
  const config = {
    enabled: true,
    tenantId: "11111111-1111-4111-8111-111111111111",
    clientId: "22222222-2222-4222-8222-222222222222",
    encryptedClientSecret: "encrypted",
    scopes: ["openid", "profile", "email"],
    autoProvisionMembers: true,
  } as never;

  it("accepts only concrete tenants and the minimum OIDC scopes", () => {
    expect(isMicrosoftTenantId(config.tenantId)).toBe(true);
    expect(isMicrosoftTenantId("common")).toBe(false);
    expect(normalizeMicrosoftScopes(undefined)).toEqual(["openid", "profile", "email"]);
    expect(() => normalizeMicrosoftScopes(["openid", "offline_access"])).toThrow();
    expect(normalizeMicrosoftEmail(" Alex@Example.com ")).toBe("alex@example.com");
    expect(normalizeMicrosoftEmail("not-an-email")).toBeNull();
  });

  it("builds an authorization request with state, nonce and S256 PKCE", () => {
    const result = buildMicrosoftAuthorizationUrl(
      config,
      {
        issuer: "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0",
        authorizationEndpoint: "https://login.microsoftonline.com/authorize",
        tokenEndpoint: "https://login.microsoftonline.com/token",
        jwksUri: "https://login.microsoftonline.com/keys",
      },
      "program-a",
    );
    const url = new URL(result.url);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(result.stateCookie).toContain("HttpOnly");
  });
});

describe("Microsoft member provisioning", () => {
  it("signs in an existing linked identity", async () => {
    const tx = transactionFixture();
    tx.memberExternalIdentity.findUnique.mockResolvedValue({ member: activeMember });

    await expect(resolveMicrosoftMember("program-a", identity, true)).resolves.toEqual({
      member: activeMember,
      outcome: "login_existing_identity",
    });
    expect(tx.member.findMany).not.toHaveBeenCalled();
  });

  it("links a unique active member by case-insensitive email", async () => {
    const tx = transactionFixture();
    tx.memberExternalIdentity.findUnique.mockResolvedValue(null);
    tx.member.findMany.mockResolvedValue([activeMember]);
    tx.memberExternalIdentity.create.mockResolvedValue({ member: activeMember });

    const result = await resolveMicrosoftMember("program-a", identity, true);

    expect(result.outcome).toBe("linked_existing_member");
    expect(tx.memberExternalIdentity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          programId: "program-a",
          memberId: "member-a",
          email: "alex@example.com",
        }),
      }),
    );
  });

  it("rejects missing email before provisioning", async () => {
    const tx = transactionFixture();
    tx.memberExternalIdentity.findUnique.mockResolvedValue(null);

    await expect(
      resolveMicrosoftMember("program-a", { ...identity, email: null }, true),
    ).rejects.toMatchObject({ code: "MICROSOFT_EMAIL_REQUIRED" });
    expect(tx.member.findMany).not.toHaveBeenCalled();
  });

  it("auto-creates an active Microsoft-only member when no email match exists", async () => {
    const tx = transactionFixture();
    const createdMember = {
      ...activeMember,
      id: "member-new",
      email: "new@example.com",
      firstName: "New",
      lastName: "Person",
    };
    tx.memberExternalIdentity.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    tx.member.findMany.mockResolvedValue([]);
    tx.member.create.mockResolvedValue(createdMember);

    const result = await resolveMicrosoftMember(
      "program-a",
      { ...identity, email: "new@example.com", givenName: "New", familyName: "Person" },
      true,
    );

    expect(result).toEqual({ member: createdMember, outcome: "auto_provisioned_member" });
    expect(tx.memberExternalIdentity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ memberId: "member-new", email: "new@example.com" }),
      }),
    );
  });

  it("rejects duplicate and inactive email matches without attaching", async () => {
    const tx = transactionFixture();
    tx.memberExternalIdentity.findUnique.mockResolvedValue(null);
    tx.member.findMany.mockResolvedValue([activeMember, { ...activeMember, id: "member-b" }]);
    await expect(resolveMicrosoftMember("program-a", identity, true)).rejects.toMatchObject({
      code: "MICROSOFT_EMAIL_AMBIGUOUS",
    });

    vi.clearAllMocks();
    const inactiveTx = transactionFixture();
    inactiveTx.memberExternalIdentity.findUnique.mockResolvedValue(null);
    inactiveTx.member.findMany.mockResolvedValue([
      { ...activeMember, status: "INACTIVE", deletedAt: null },
    ]);
    await expect(resolveMicrosoftMember("program-a", identity, true)).rejects.toMatchObject({
      code: "MICROSOFT_MEMBER_UNAVAILABLE",
    });
    expect(inactiveTx.member.create).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const deletedTx = transactionFixture();
    deletedTx.memberExternalIdentity.findUnique.mockResolvedValue(null);
    deletedTx.member.findMany.mockResolvedValue([
      { ...activeMember, deletedAt: new Date("2025-01-01") },
    ]);
    await expect(resolveMicrosoftMember("program-a", identity, true)).rejects.toMatchObject({
      code: "MICROSOFT_MEMBER_UNAVAILABLE",
    });
    expect(deletedTx.member.create).not.toHaveBeenCalled();
  });

  it("keeps provisioning program-scoped and disabled auto-provisioning pre-linked-only", async () => {
    const tx = transactionFixture();
    tx.memberExternalIdentity.findUnique.mockResolvedValue(null);
    await expect(resolveMicrosoftMember("program-b", identity, false)).rejects.toMatchObject({
      code: "MICROSOFT_IDENTITY_NOT_LINKED",
    });
    expect(tx.member.findMany).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const isolatedTx = transactionFixture();
    isolatedTx.memberExternalIdentity.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    isolatedTx.member.findMany.mockResolvedValue([]);
    isolatedTx.member.create.mockResolvedValue({ ...activeMember, id: "member-b" });
    await resolveMicrosoftMember("program-b", { ...identity, email: "b@example.com" }, true);
    expect(isolatedTx.member.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ programId: "program-b" }) }),
    );
  });

  it("treats a concurrent identity insert as an idempotent login", async () => {
    mockPrisma.$transaction.mockRejectedValueOnce({ code: "P2002" });
    mockPrisma.memberExternalIdentity.findUnique.mockResolvedValue({ member: activeMember });

    await expect(resolveMicrosoftMember("program-a", identity, true)).resolves.toEqual({
      member: activeMember,
      outcome: "login_existing_identity",
    });
  });
});
