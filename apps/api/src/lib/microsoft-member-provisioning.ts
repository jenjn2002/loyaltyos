import { type Member, Prisma } from "@prisma/client";

import { prisma } from "../db.js";
import { LoyaltyError } from "./errors.js";
import {
  MICROSOFT_PROVIDER,
  type MicrosoftIdentityClaims,
  normalizeMicrosoftEmail,
} from "./microsoft-auth.js";

export type MicrosoftProvisioningOutcome =
  | "login_existing_identity"
  | "linked_existing_member"
  | "auto_provisioned_member";

export interface MicrosoftProvisioningResult {
  member: Member;
  outcome: MicrosoftProvisioningOutcome;
}

function isActiveMember(member: Pick<Member, "status" | "deletedAt">): boolean {
  return member.status === "ACTIVE" && member.deletedAt === null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export function deriveMicrosoftMemberNames(identity: MicrosoftIdentityClaims): {
  firstName: string | null;
  lastName: string | null;
} {
  if (identity.givenName ?? identity.familyName) {
    return {
      firstName: identity.givenName ?? identity.displayName,
      lastName: identity.familyName,
    };
  }

  const parts = identity.displayName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length > 1) {
    return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") };
  }
  return { firstName: parts[0] ?? null, lastName: null };
}

async function exactIdentity(
  client: Pick<Prisma.TransactionClient, "memberExternalIdentity">,
  programId: string,
  identity: MicrosoftIdentityClaims,
) {
  return client.memberExternalIdentity.findUnique({
    where: {
      programId_provider_providerSubject_tenantId: {
        programId,
        provider: MICROSOFT_PROVIDER,
        providerSubject: identity.subject,
        tenantId: identity.tenantId,
      },
    },
    include: { member: true },
  });
}

async function emailMatches(
  client: Pick<Prisma.TransactionClient, "member">,
  programId: string,
  email: string,
) {
  return client.member.findMany({
    where: {
      programId,
      email: { equals: email, mode: "insensitive" },
    },
    orderBy: { createdAt: "asc" },
  });
}

async function resolveInTransaction(
  tx: Prisma.TransactionClient,
  programId: string,
  identity: MicrosoftIdentityClaims,
  autoProvisionMembers: boolean,
): Promise<MicrosoftProvisioningResult> {
  // Serialize provisioning for a program. Member email is intentionally not
  // unique, so this lock prevents two first logins from creating duplicates.
  await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "Program" WHERE "id" = ${programId} FOR UPDATE
  `);

  const linked = await exactIdentity(tx, programId, identity);
  if (linked) {
    if (!isActiveMember(linked.member)) {
      throw new LoyaltyError("MICROSOFT_MEMBER_UNAVAILABLE", 401);
    }
    return { member: linked.member, outcome: "login_existing_identity" };
  }

  if (!autoProvisionMembers) {
    throw new LoyaltyError("MICROSOFT_IDENTITY_NOT_LINKED", 401);
  }

  const email = normalizeMicrosoftEmail(identity.email);
  if (!email) throw new LoyaltyError("MICROSOFT_EMAIL_REQUIRED", 401);

  const matches = await emailMatches(tx, programId, email);
  const activeMatches = matches.filter(isActiveMember);
  const inactiveMatches = matches.filter((member) => !isActiveMember(member));
  if (inactiveMatches.length > 0) {
    throw new LoyaltyError("MICROSOFT_MEMBER_UNAVAILABLE", 401);
  }
  if (activeMatches.length > 1) {
    throw new LoyaltyError("MICROSOFT_EMAIL_AMBIGUOUS", 401);
  }

  if (activeMatches.length === 1) {
    const member = activeMatches[0];
    if (!member) throw new LoyaltyError("MICROSOFT_MEMBER_UNAVAILABLE", 401);
    const created = await tx.memberExternalIdentity.create({
      data: {
        programId,
        memberId: member.id,
        provider: MICROSOFT_PROVIDER,
        providerSubject: identity.subject,
        tenantId: identity.tenantId,
        email,
        displayName: identity.displayName,
      },
      include: { member: true },
    });
    return { member: created.member, outcome: "linked_existing_member" };
  }

  // Re-check both keys immediately before creating anything. The program row
  // lock normally makes this redundant, but it keeps the invariant explicit
  // for alternate transaction adapters and future provisioning paths.
  const identityRecheck = await exactIdentity(tx, programId, identity);
  if (identityRecheck) {
    if (!isActiveMember(identityRecheck.member)) {
      throw new LoyaltyError("MICROSOFT_MEMBER_UNAVAILABLE", 401);
    }
    return { member: identityRecheck.member, outcome: "login_existing_identity" };
  }
  const emailRecheck = await emailMatches(tx, programId, email);
  if (emailRecheck.length > 0) {
    const activeRecheck = emailRecheck.filter(isActiveMember);
    if (emailRecheck.some((member) => !isActiveMember(member))) {
      throw new LoyaltyError("MICROSOFT_MEMBER_UNAVAILABLE", 401);
    }
    if (activeRecheck.length > 1) {
      throw new LoyaltyError("MICROSOFT_EMAIL_AMBIGUOUS", 401);
    }
    const member = activeRecheck[0];
    if (!member) throw new LoyaltyError("MICROSOFT_MEMBER_UNAVAILABLE", 401);
    const created = await tx.memberExternalIdentity.create({
      data: {
        programId,
        memberId: member.id,
        provider: MICROSOFT_PROVIDER,
        providerSubject: identity.subject,
        tenantId: identity.tenantId,
        email,
        displayName: identity.displayName,
      },
      include: { member: true },
    });
    return { member: created.member, outcome: "linked_existing_member" };
  }

  const names = deriveMicrosoftMemberNames(identity);
  const member = await tx.member.create({
    data: {
      programId,
      email,
      firstName: names.firstName,
      lastName: names.lastName,
    },
  });
  await tx.memberExternalIdentity.create({
    data: {
      programId,
      memberId: member.id,
      provider: MICROSOFT_PROVIDER,
      providerSubject: identity.subject,
      tenantId: identity.tenantId,
      email,
      displayName: identity.displayName,
    },
  });
  return { member, outcome: "auto_provisioned_member" };
}

export async function resolveMicrosoftMember(
  programId: string,
  identity: MicrosoftIdentityClaims,
  autoProvisionMembers: boolean,
): Promise<MicrosoftProvisioningResult> {
  try {
    return await prisma.$transaction((tx) =>
      resolveInTransaction(tx, programId, identity, autoProvisionMembers),
    );
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    // A concurrent adapter/database path may win the identity insert. Treat
    // that as an idempotent login if the winner is still an active member.
    const linked = await exactIdentity(prisma, programId, identity);
    if (linked && isActiveMember(linked.member)) {
      return { member: linked.member, outcome: "login_existing_identity" };
    }
    throw new LoyaltyError("MICROSOFT_PROVISION_FAILED", 409);
  }
}
