import { hashPassword, verifyPassword } from "@loyaltyos/core";
import type { Prisma } from "@prisma/client";

export const MEMBER_PASSWORD_MIN_LENGTH = 10;

// Keep the failed-login path computationally similar when the username does
// not exist. This is the same Argon2id profile used for administrator login.
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$xxxxxxxxxxxxxxxxxxxxxx$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

export function normalizeMemberUsername(username: string): string {
  return username.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function validateMemberUsername(username: string): string {
  const normalized = normalizeMemberUsername(username);
  if (normalized.length < 3 || normalized.length > 120) {
    throw new Error("Username must be between 3 and 120 characters.");
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._@+-]*$/u.test(normalized)) {
    throw new Error("Username may contain letters, numbers, dots, underscores, @, + and hyphens.");
  }
  return normalized;
}

export function validateMemberPassword(password: string): void {
  if (password.length < MEMBER_PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${String(MEMBER_PASSWORD_MIN_LENGTH)} characters.`);
  }
  if (password.length > 1024) throw new Error("Password is too long.");
}

export async function authenticateMember(
  client: Pick<Prisma.TransactionClient, "memberCredential"> | typeof import("../db.js").prisma,
  programId: string,
  username: string,
  password: string,
) {
  const credential = await client.memberCredential.findFirst({
    where: { programId, usernameNormalized: normalizeMemberUsername(username) },
    include: { member: true },
  });
  const valid = await verifyPassword(credential?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
  if (!credential || !credential.passwordHash || !valid) return null;
  if (
    credential.member.programId !== programId ||
    credential.member.status !== "ACTIVE" ||
    credential.member.deletedAt
  )
    return null;
  return credential.member;
}

export async function hashMemberPassword(password: string): Promise<string> {
  validateMemberPassword(password);
  return hashPassword(password);
}

export function memberCredentialSummary(
  credential: {
    username: string;
    passwordHash: string | null;
    passwordChangedAt: Date | null;
  } | null,
) {
  return credential
    ? {
        username: credential.username,
        credentialsConfigured: Boolean(credential.passwordHash),
        passwordChangedAt: credential.passwordChangedAt,
      }
    : {
        username: null,
        credentialsConfigured: false,
        passwordChangedAt: null,
      };
}
