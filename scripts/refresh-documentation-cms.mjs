#!/usr/bin/env node

// Conservative, one-off CMS content refresh. Dry-run is the default.
// Usage (inside the API runtime, with its normal DATABASE_URL):
//   node scripts/refresh-documentation-cms.mjs --manifest /tmp/guide-refresh.json --program-id <id>
// Review the plan, then explicitly add --apply to write.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const apiRequire = createRequire(resolve(scriptDir, "../apps/api/package.json"));
const { PrismaClient } = apiRequire("@prisma/client");

const updateAllowlist = new Set([
  "ADMIN:projects",
  "ADMIN:how-project-plan-approval",
  "ADMIN:how-project-invite-members",
  "ADMIN:how-project-complete-distribute",
  "CUSTOMER:projects",
  "CUSTOMER:how-project-invitation",
]);
const unpublishAllowlist = new Set([
  "ADMIN:how-project-tasks",
  "CUSTOMER:how-project-tasks-completion",
]);
const insertAllowlist = new Set([
  "CUSTOMER:how-project-team",
  "ADMIN:how-custom-forms-workflows",
]);

function parseArgs(argv) {
  const options = { manifest: null, programId: null, apply: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--manifest" || option === "--program-id") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
      options[option === "--manifest" ? "manifest" : "programId"] = value;
      index += 1;
    } else if (option === "--apply") {
      options.apply = true;
    } else if (option === "--dry-run") {
      options.dryRun = true;
    } else if (option === "--help") {
      process.stdout.write("Usage: node scripts/refresh-documentation-cms.mjs --manifest <json> --program-id <id> [--dry-run|--apply]\nDry-run is the default; --apply is required for database writes.\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }
  if (!options.manifest || !options.programId) throw new Error("--manifest and --program-id are required");
  if (options.apply && options.dryRun) throw new Error("Choose either --dry-run or --apply, not both");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(options.programId)) throw new Error("Invalid program id");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be provided by the API runtime environment");
  return options;
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function articleKey(article) {
  return `${article.audience}:${article.slug}`;
}

function validateArticleIdentity(article, label, allowed) {
  assertRecord(article, label);
  if (!new Set(["ADMIN", "CUSTOMER"]).has(article.audience) || typeof article.slug !== "string") {
    throw new Error(`${label} has an invalid audience/slug`);
  }
  if (!allowed.has(articleKey(article))) throw new Error(`${label} is outside the project-documentation allowlist: ${articleKey(article)}`);
}

function stableStringify(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item) ?? "null").join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentWithoutScreenshots(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) return content;
  const { screenshots: _screenshots, ...copy } = content;
  return copy;
}

function sameDefaultContent(actual, expected) {
  return stableStringify(contentWithoutScreenshots(actual)) === stableStringify(contentWithoutScreenshots(expected));
}

function contentWithActualScreenshots(sourceContent, cmsContent) {
  assertRecord(sourceContent, "new source content");
  const next = structuredClone(sourceContent);
  if (cmsContent && typeof cmsContent === "object" && !Array.isArray(cmsContent) && Object.hasOwn(cmsContent, "screenshots")) {
    next.screenshots = structuredClone(cmsContent.screenshots);
  }
  return next;
}

function validateManifest(manifest) {
  assertRecord(manifest, "manifest");
  if (manifest.schemaVersion !== 1 || typeof manifest.baselineCommit !== "string" || !/^[a-f0-9]{40}$/i.test(manifest.baselineCommit)) {
    throw new Error("Unsupported or invalid manifest provenance; regenerate it from built-in sources and Git");
  }
  for (const field of ["updates", "unpublish", "insertMissing"]) {
    if (!Array.isArray(manifest[field])) throw new Error(`Manifest ${field} must be an array`);
  }
  const seen = new Set();
  for (const item of manifest.updates) {
    validateArticleIdentity(item, "update", updateAllowlist);
    assertRecord(item.expectedOldContent, `expected old content for ${articleKey(item)}`);
    assertRecord(item.nextArticle, `next article for ${articleKey(item)}`);
    if (item.nextArticle.audience !== item.audience || item.nextArticle.slug !== item.slug) throw new Error(`Update identity mismatch for ${articleKey(item)}`);
    if (seen.has(articleKey(item))) throw new Error(`Duplicate manifest action for ${articleKey(item)}`);
    seen.add(articleKey(item));
  }
  for (const item of manifest.unpublish) {
    validateArticleIdentity(item, "unpublish", unpublishAllowlist);
    assertRecord(item.expectedOldContent, `expected old content for ${articleKey(item)}`);
    if (seen.has(articleKey(item))) throw new Error(`Duplicate manifest action for ${articleKey(item)}`);
    seen.add(articleKey(item));
  }
  for (const article of manifest.insertMissing) {
    validateArticleIdentity(article, "insert", insertAllowlist);
    assertRecord(article.content, `content for ${articleKey(article)}`);
    if (article.status !== "PUBLISHED" || !Number.isInteger(article.sortOrder) || article.sortOrder < 0) throw new Error(`Invalid inserted article metadata for ${articleKey(article)}`);
    if (article.imageData !== null) throw new Error(`New guide ${articleKey(article)} must not import a screenshot/image payload`);
    if (seen.has(articleKey(article))) throw new Error(`Duplicate manifest action for ${articleKey(article)}`);
    seen.add(articleKey(article));
  }
}

function planOperations(manifest, rows) {
  const rowMap = new Map(rows.map((row) => [`${row.audience}:${row.slug}`, row]));
  const plan = { update: [], unpublish: [], insert: [], skipped: [] };
  for (const item of manifest.updates) {
    const key = articleKey(item);
    const row = rowMap.get(key);
    if (!row) {
      plan.skipped.push({ action: "update", key, reason: "CMS article missing; updates never create existing slugs" });
      continue;
    }
    if (!sameDefaultContent(row.content, item.expectedOldContent)) {
      plan.skipped.push({ action: "update", key, reason: "CMS text differs from exact Git baseline; preserved as potentially user-edited" });
      continue;
    }
    const content = contentWithActualScreenshots(item.nextArticle.content, row.content);
    if (stableStringify(content) === stableStringify(row.content)) {
      plan.skipped.push({ action: "update", key, reason: "already matches current built-in text" });
      continue;
    }
    plan.update.push({ row, expectedOldContent: item.expectedOldContent, sourceContent: item.nextArticle.content, content });
  }
  for (const item of manifest.unpublish) {
    const key = articleKey(item);
    const row = rowMap.get(key);
    if (!row) {
      plan.skipped.push({ action: "unpublish", key, reason: "CMS article missing" });
      continue;
    }
    if (!sameDefaultContent(row.content, item.expectedOldContent)) {
      plan.skipped.push({ action: "unpublish", key, reason: "CMS text differs from exact Git baseline; preserved as potentially user-edited" });
      continue;
    }
    if (row.status === "DRAFT") {
      plan.skipped.push({ action: "unpublish", key, reason: "already unpublished" });
      continue;
    }
    plan.unpublish.push({ row, expectedOldContent: item.expectedOldContent });
  }
  for (const article of manifest.insertMissing) {
    const key = articleKey(article);
    if (rowMap.has(key)) {
      plan.skipped.push({ action: "insert", key, reason: "slug already exists; user/CMS version is never overwritten" });
      continue;
    }
    plan.insert.push({ article });
  }
  return plan;
}

function canonicalAuditJson(value) {
  const normalize = (input) => {
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)]));
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

async function appendAudit(tx, programId, entityId, diff) {
  const lockKey = `audit:${programId}`;
  await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS locked", lockKey);
  const previous = await tx.auditLog.findFirst({
    where: { programId, hashVersion: 2, recordHash: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { recordHash: true, createdAt: true },
  });
  const now = new Date();
  const createdAt = previous && previous.createdAt.getTime() >= now.getTime()
    ? new Date(previous.createdAt.getTime() + 1)
    : now;
  const record = {
    programId,
    actorType: "SYSTEM",
    actorId: "documentation-cms-maintenance",
    adminUserId: null,
    action: "CONFIG_CHANGE",
    entityType: "documentation_article",
    entityId,
    diff,
    reason: "Refresh exact built-in documentation defaults from a reviewed Git baseline",
    ipAddress: null,
    previousHash: previous?.recordHash ?? null,
    hashVersion: 2,
    createdAt,
  };
  const recordHash = createHash("sha256").update(canonicalAuditJson(record)).digest("hex");
  await tx.auditLog.create({ data: { ...record, diff, recordHash } });
}

async function lockAndRecheckArticle(tx, programId, snapshot, expectedOldContent) {
  const locked = await tx.$queryRawUnsafe(
    'SELECT "id" FROM "DocumentationArticle" WHERE "id" = $1 AND "programId" = $2 FOR UPDATE',
    snapshot.id,
    programId,
  );
  if (!Array.isArray(locked) || locked.length !== 1) throw new Error(`CMS article disappeared during refresh: ${snapshot.audience}:${snapshot.slug}; transaction rolled back`);
  const latest = await tx.documentationArticle.findFirst({
    where: { id: snapshot.id, programId },
    select: { id: true, audience: true, slug: true, status: true, content: true },
  });
  if (!latest || !sameDefaultContent(latest.content, expectedOldContent)) {
    throw new Error(`CMS article changed after planning: ${snapshot.audience}:${snapshot.slug}; transaction rolled back`);
  }
  return latest;
}

function contentDigest(content) {
  return createHash("sha256").update(stableStringify(contentWithoutScreenshots(content))).digest("hex");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(resolve(options.manifest), "utf8"));
  validateManifest(manifest);
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    const identities = [
      ...manifest.updates,
      ...manifest.unpublish,
      ...manifest.insertMissing,
    ].map(({ audience, slug }) => ({ audience, slug }));
    const rows = identities.length
      ? await prisma.documentationArticle.findMany({
        where: { programId: options.programId, OR: identities },
        select: { id: true, audience: true, slug: true, status: true, content: true, imageKey: true, imageData: true, updatedAt: true },
      })
      : [];
    const plan = planOperations(manifest, rows);
    const summary = {
      mode: options.apply ? "APPLY" : "DRY_RUN",
      programId: options.programId,
      baselineCommit: manifest.baselineCommit,
      updates: plan.update.map(({ row, content }) => ({ audience: row.audience, slug: row.slug, contentSha256: contentDigest(content), preservesImage: true, preservesScreenshots: true })),
      unpublish: plan.unpublish.map(({ row }) => ({ audience: row.audience, slug: row.slug, status: row.status, action: "set DRAFT; retain row and all media/content" })),
      insertMissing: plan.insert.map(({ article }) => ({ audience: article.audience, slug: article.slug, status: article.status, imageKey: article.imageKey ?? null })),
      skipped: plan.skipped,
      note: options.apply ? "Applying reviewed CMS changes." : "No database writes. Add --apply only after reviewing this plan.",
    };
    if (!options.apply) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const applied = { updated: 0, unpublished: 0, inserted: 0 };
      const existingActions = [
        ...plan.update.map((item) => ({ ...item, action: "update" })),
        ...plan.unpublish.map((item) => ({ ...item, action: "unpublish" })),
      ].sort((left, right) => left.row.id.localeCompare(right.row.id));
      const lockedArticles = new Map();
      for (const { row, expectedOldContent } of existingActions) {
        lockedArticles.set(row.id, await lockAndRecheckArticle(tx, options.programId, row, expectedOldContent));
      }
      for (const { row, sourceContent } of plan.update) {
        const latest = lockedArticles.get(row.id);
        const content = contentWithActualScreenshots(sourceContent, latest.content);
        await tx.documentationArticle.update({ where: { id: row.id }, data: { content } });
        await appendAudit(tx, options.programId, row.id, { action: "refresh_default_content", audience: row.audience, slug: row.slug, baselineCommit: manifest.baselineCommit });
        applied.updated += 1;
      }
      for (const { row } of plan.unpublish) {
        const latest = lockedArticles.get(row.id);
        if (latest.status === "DRAFT") throw new Error(`CMS article status changed after planning: ${row.audience}:${row.slug}; transaction rolled back`);
        await tx.documentationArticle.update({ where: { id: row.id }, data: { status: "DRAFT", publishedAt: null } });
        await appendAudit(tx, options.programId, row.id, { action: "unpublish_retired_default", audience: row.audience, slug: row.slug, baselineCommit: manifest.baselineCommit });
        applied.unpublished += 1;
      }
      for (const { article } of plan.insert) {
        const created = await tx.documentationArticle.create({
          data: {
            programId: options.programId,
            audience: article.audience,
            slug: article.slug,
            status: article.status,
            sortOrder: article.sortOrder,
            imageKey: article.imageKey ?? null,
            imageData: null,
            content: article.content,
          },
          select: { id: true },
        });
        await appendAudit(tx, options.programId, created.id, { action: "insert_missing_default", audience: article.audience, slug: article.slug, baselineCommit: manifest.baselineCommit });
        applied.inserted += 1;
      }
      return applied;
    });
    process.stdout.write(`${JSON.stringify({ ...summary, result, note: "CMS updates committed in one transaction; uploaded image data and CMS screenshots were not changed." }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
