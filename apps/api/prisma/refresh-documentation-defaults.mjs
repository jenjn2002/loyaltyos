// Audited, idempotent repair of exact legacy default dashboard/member guide copy.
// Run from /app after deployment with EXPECTED_LOYALTYOS_ENVIRONMENT set.
const expected = process.env.EXPECTED_LOYALTYOS_ENVIRONMENT;
if (!["production", "sandbox"].includes(expected) || process.env.LOYALTYOS_ENVIRONMENT !== expected) throw new Error("Environment guard failed");
const { prisma } = await import("../dist/src/db.js");
const { audit } = await import("../dist/src/lib/audit.js");
const { refreshKnownDocumentationDefaults } = await import("../dist/src/lib/documentation-default-refresh.js");
try {
  const records = await prisma.documentationArticle.findMany({ where: { audience: "ADMIN", slug: { in: ["dashboard", "how-member-profile-admin", "how-member-import-points"] } }, select: { id: true, slug: true, programId: true, content: true } });
  let updated = 0;
  for (const record of records) {
    const next = refreshKnownDocumentationDefaults(record.slug, record.content);
    if (!next?.changed) continue;
    await prisma.$transaction(async tx => {
      // Optimistic condition protects a concurrent user edit between read/write.
      const saved = await tx.documentationArticle.updateMany({ where: { id: record.id, content: { equals: record.content } }, data: { content: next.content } });
      if (!saved.count) return;
      await audit(record.programId, { type: "SYSTEM", id: "documentation-default-refresh" }, "CONFIG_CHANGE", "documentation_article", record.id, { action: "refresh_known_documentation_defaults", slug: record.slug, locales: ["en", "vi"], preservesAuthoredContent: true }, undefined, tx);
      updated += saved.count;
    });
  }
  console.log(JSON.stringify({ environment: expected, checked: records.length, updated }));
} finally { await prisma.$disconnect(); }
