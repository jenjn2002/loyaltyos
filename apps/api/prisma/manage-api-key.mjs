#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const HELP = `LoyaltyOS API key provisioning (deployment owner only)

This script never runs automatically. It uses the existing DATABASE_URL and
checks --environment against LOYALTYOS_ENVIRONMENT (or NODE_ENV outside a
configured deployment). Never print DATABASE_URL or run against an unverified DB.
SERVER keys bypass admin capability checks and must stay on trusted servers.
CLIENT keys do not create a member session or grant access to /members/me.

Usage:
  node apps/api/prisma/manage-api-key.mjs list --environment sandbox --program-id <ID>
  node apps/api/prisma/manage-api-key.mjs create --environment sandbox --program-id <ID> --name <NAME> --scope SERVER --days 90
  node apps/api/prisma/manage-api-key.mjs revoke --environment sandbox --program-id <ID> --key-id <EXACT_KEY_ID>

Options:
  --environment  production | sandbox | development (required)
  --program-id   Exact existing program ID (required)
  --name         Integration label (required for create)
  --scope        SERVER | CLIENT (required for create)
  --days         Positive integer lifetime; defaults to 90 days
  --no-expiry    Explicitly create without expiry; cannot combine with --days
  --key-id       Exact key record ID (required for revoke)
  --help         Print this help without connecting to the database

Create prints the new secret once. Store it in a secret manager; avoid recorded
terminal sessions, CI logs, shared shells, and tickets. List and revoke never
return credentials. Revoke deactivates only the specified key in the program.
`;

export function parseApiKeyArgs(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--help")) return null;
  const [command, ...args] = argv;
  if (!["list", "create", "revoke"].includes(command)) throw new Error("Unknown command. Use --help.");
  const allowed = new Set(["--environment", "--program-id"]);
  if (command === "create") ["--name", "--scope", "--days", "--no-expiry"].forEach((flag) => allowed.add(flag));
  if (command === "revoke") allowed.add("--key-id");
  const flags = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!allowed.has(flag) || flags.has(flag)) throw new Error("Unknown or duplicate option. Use --help.");
    if (flag === "--no-expiry") {
      flags.set(flag, true);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--") || !value.trim() || /[\u0000-\u001f]/.test(value)) {
      throw new Error("Each option requires a non-empty value. Use --help.");
    }
    flags.set(flag, value.trim());
    index += 1;
  }
  const environment = flags.get("--environment");
  if (!["production", "sandbox", "development"].includes(environment)) {
    throw new Error("--environment must be production, sandbox, or development.");
  }
  const programId = flags.get("--program-id");
  if (!programId || programId.length > 200) throw new Error("--program-id is required and must be an exact program ID.");
  if (command === "list") return { command, environment, programId };
  if (command === "revoke") {
    const keyId = flags.get("--key-id");
    if (!keyId || keyId.length > 200) throw new Error("--key-id is required and must be an exact key record ID.");
    return { command, environment, programId, keyId };
  }
  const name = flags.get("--name");
  const scope = flags.get("--scope");
  if (!name || name.length > 120) throw new Error("--name is required and must be at most 120 characters.");
  if (!["SERVER", "CLIENT"].includes(scope)) throw new Error("--scope must explicitly be SERVER or CLIENT.");
  if (flags.has("--no-expiry") && flags.has("--days")) throw new Error("Use --days or --no-expiry, never both.");
  const daysInput = flags.get("--days") ?? "90";
  if (!/^\d+$/.test(daysInput)) throw new Error("--days must be a positive integer.");
  const days = Number(daysInput);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    throw new Error("--days must be between 1 and 3650.");
  }
  return { command, environment, programId, name, scope, days: flags.has("--no-expiry") ? null : days };
}

export function assertDatabaseContext(options, env = process.env) {
  if (!env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required; use the intended API deployment context.");
  const configured = env.LOYALTYOS_ENVIRONMENT?.trim()
    || (env.NODE_ENV === "production" ? "production" : "development");
  if (configured !== options.environment) {
    throw new Error("Environment mismatch. Verify the intended deployment and pass its --environment.");
  }
}

const metadataSelect = {
  id: true,
  programId: true,
  name: true,
  scope: true,
  isActive: true,
  expiresAt: true,
  lastUsedAt: true,
  createdAt: true,
};

export async function runApiKeyCommand(prisma, options) {
  const program = await prisma.program.findUnique({ where: { id: options.programId }, select: { id: true, isActive: true } });
  if (!program) throw new Error("Program not found in the selected database.");
  if (options.command === "list") {
    return { environment: options.environment, data: await prisma.apiKey.findMany({
      where: { programId: options.programId },
      select: metadataSelect,
      orderBy: { createdAt: "desc" },
    }) };
  }
  if (options.command === "revoke") {
    const result = await prisma.apiKey.updateMany({
      where: { id: options.keyId, programId: options.programId },
      data: { isActive: false },
    });
    if (result.count !== 1) throw new Error("Exact key ID not found in the selected program.");
    return { environment: options.environment, data: { id: options.keyId, programId: options.programId, isActive: false } };
  }
  if (!program.isActive) throw new Error("Cannot provision a key for an inactive program.");
  const secret = `los_${randomBytes(32).toString("base64url")}`;
  // Matches src/lib/api-keys.ts; this CLI also runs before TypeScript is built.
  const keyHash = `sha256:${createHash("sha256").update(secret, "utf8").digest("hex")}`;
  const key = await prisma.apiKey.create({
    data: {
      programId: options.programId,
      name: options.name,
      scope: options.scope,
      key: keyHash,
      expiresAt: options.days === null ? null : new Date(Date.now() + options.days * 86_400_000),
      isActive: true,
    },
    select: metadataSelect,
  });
  return { environment: options.environment, data: { ...key, key: secret }, notice: "New key printed once. Store securely; list never returns it." };
}

async function main() {
  let options;
  try {
    options = parseApiKeyArgs(process.argv.slice(2));
    if (!options) {
      process.stdout.write(HELP);
      return;
    }
    assertDatabaseContext(options);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  let prisma;
  try {
    const require = createRequire(new URL("../package.json", import.meta.url));
    const { PrismaClient } = require("@prisma/client");
    prisma = new PrismaClient();
    process.stdout.write(`${JSON.stringify(await runApiKeyCommand(prisma, options), null, 2)}\n`);
  } catch {
    // Prisma errors can include connection URLs or submitted secrets. Do not
    // print the raw exception, request arguments, or environment variables.
    process.stderr.write("API key operation failed. Verify the selected environment, program/key ID, and database connectivity in protected deployment tooling.\n");
    process.exitCode = 1;
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {
      process.stderr.write("Database cleanup failed; consult protected deployment tooling.\n");
      process.exitCode = 1;
    });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
