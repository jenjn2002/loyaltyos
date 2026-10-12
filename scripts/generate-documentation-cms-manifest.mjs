#!/usr/bin/env node

// Generate a narrow CMS refresh manifest from built-in guide sources and a
// Git baseline. This is read-only; the output can be reviewed before the
// standalone Prisma maintenance script is run.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRequire = createRequire(resolve(ROOT, "apps/api/package.json"));
const ts = apiRequire("typescript");

const sourcePaths = {
  adminVi: "apps/admin/src/content/document-guide.ts",
  adminEn: "apps/admin/src/content/document-guide.en.ts",
  adminExpanded: "apps/admin/src/content/document-guide-expanded.ts",
  customerVi: "apps/portal/src/content/document-guide.ts",
  customerEn: "apps/portal/src/content/document-guide.en.ts",
  customerExpanded: "apps/portal/src/content/document-guide-expanded.ts",
};

const projectUpdates = {
  ADMIN: ["projects", "how-project-plan-approval", "how-project-invite-members", "how-project-complete-distribute"],
  CUSTOMER: ["projects", "how-project-invitation"],
};
const retiredTaskArticles = [
  { audience: "ADMIN", slug: "how-project-tasks" },
  { audience: "CUSTOMER", slug: "how-project-tasks-completion" },
];
const newBuiltInArticles = [
  { audience: "CUSTOMER", slug: "how-project-team" },
  { audience: "ADMIN", slug: "how-custom-forms-workflows" },
];

function argumentsFrom(argv) {
  const options = { baseline: "HEAD", output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--baseline" || option === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
      options[option.slice(2)] = value;
      index += 1;
    } else if (option === "--help") {
      process.stdout.write("Usage: node scripts/generate-documentation-cms-manifest.mjs --output /tmp/guide-refresh.json [--baseline HEAD|<commit>]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }
  if (!options.output) throw new Error("--output is required");
  if (!/^(HEAD|[a-f0-9]{7,40})$/i.test(options.baseline)) throw new Error("--baseline must be HEAD or a commit hash");
  return options;
}

function gitOutput(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function sourceAt(relativePath, baseline) {
  return baseline === null
    ? readFileSync(resolve(ROOT, relativePath), "utf8")
    : gitOutput(["show", `${baseline}:${relativePath}`]);
}

async function evaluateTypeScript(source, label) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: label,
  }).outputText;
  if (/^\s*import\s/m.test(compiled)) throw new Error(`${label} contains a runtime import; refusing to evaluate a source with external dependencies`);
  const url = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
  return import(url);
}

async function loadModules(baseline) {
  const entries = await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => {
    const module = await evaluateTypeScript(sourceAt(path, baseline), `${baseline ?? "worktree"}:${path}`);
    return [key, module];
  }));
  return Object.fromEntries(entries);
}

function makeAdminArticle(topic, index, englishById) {
  const english = englishById[topic.id] ?? {
    title: topic.title,
    group: topic.group,
    purpose: topic.purpose,
    prerequisites: topic.prerequisites,
    steps: topic.steps,
    result: topic.result,
    notes: topic.notes,
  };
  return {
    id: `admin-${topic.id}`,
    audience: "ADMIN",
    slug: topic.id,
    status: "PUBLISHED",
    sortOrder: index * 10,
    imageKey: topic.image,
    imageData: null,
    content: {
      vi: {
        title: topic.title,
        section: topic.group,
        route: topic.route,
        purpose: topic.purpose,
        prerequisites: topic.prerequisites,
        steps: topic.steps,
        result: topic.result,
        notes: topic.notes ?? [],
        scenarios: [],
        imageAlt: `Hướng dẫn ${topic.title}`,
      },
      en: {
        title: english.title,
        section: english.group,
        route: topic.route,
        purpose: english.purpose,
        prerequisites: english.prerequisites,
        steps: english.steps,
        result: english.result,
        notes: english.notes ?? [],
        scenarios: [],
        imageAlt: `Guide: ${english.title}`,
      },
      screenshots: [],
    },
  };
}

function makeCustomerArticle(topic, index, englishById) {
  const english = englishById[topic.id] ?? {
    title: topic.title,
    area: topic.area,
    purpose: topic.purpose,
    steps: topic.steps,
    result: topic.result,
    notes: topic.notes,
  };
  return {
    id: `customer-${topic.id}`,
    audience: "CUSTOMER",
    slug: topic.id,
    status: "PUBLISHED",
    sortOrder: index * 10,
    imageKey: topic.image,
    imageData: null,
    content: {
      vi: {
        title: topic.title,
        section: topic.area,
        route: "/",
        purpose: topic.purpose,
        steps: topic.steps,
        result: topic.result,
        notes: topic.notes ?? [],
        scenarios: [],
        imageAlt: `Hướng dẫn ${topic.title}`,
      },
      en: {
        title: english.title,
        section: english.area,
        route: "/",
        purpose: english.purpose,
        steps: english.steps,
        result: english.result,
        notes: english.notes ?? [],
        scenarios: [],
        imageAlt: `Guide: ${english.title}`,
      },
      screenshots: [],
    },
  };
}

async function allBuiltInArticles(baseline) {
  const modules = await loadModules(baseline);
  const admin = modules.adminVi.adminGuide.map((topic, index) => makeAdminArticle(topic, index, modules.adminEn.adminGuideEnglish));
  const customer = modules.customerVi.customerGuide.map((topic, index) => makeCustomerArticle(topic, index, modules.customerEn.customerGuideEnglish));
  return [
    ...admin,
    ...modules.adminExpanded.expandedAdminGuideArticles,
    ...customer,
    ...modules.customerExpanded.customerGuideExpanded,
  ];
}

function keyOf(article) {
  return `${article.audience}:${article.slug}`;
}

function contentWithoutScreenshots(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) return content;
  const { screenshots: _screenshots, ...copy } = content;
  return copy;
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

function indexArticles(articles, label) {
  const indexed = new Map();
  for (const article of articles) {
    const key = keyOf(article);
    if (indexed.has(key)) throw new Error(`${label} has duplicate built-in article ${key}`);
    indexed.set(key, article);
  }
  return indexed;
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const baselineCommit = gitOutput(["rev-parse", `${options.baseline}^{commit}`]);
  const [baselineArticles, currentArticles] = await Promise.all([
    allBuiltInArticles(options.baseline),
    allBuiltInArticles(null),
  ]);
  const baseline = indexArticles(baselineArticles, "Git baseline");
  const current = indexArticles(currentArticles, "Current worktree");

  const updates = [];
  for (const [audience, slugs] of Object.entries(projectUpdates)) {
    for (const slug of slugs) {
      const key = `${audience}:${slug}`;
      const oldArticle = baseline.get(key);
      const nextArticle = current.get(key);
      if (!oldArticle || !nextArticle) throw new Error(`Required project guide is missing from baseline/current source: ${key}`);
      if (stableStringify(contentWithoutScreenshots(oldArticle.content)) !== stableStringify(contentWithoutScreenshots(nextArticle.content))) {
        updates.push({ audience, slug, expectedOldContent: oldArticle.content, nextArticle });
      }
    }
  }

  const unpublish = retiredTaskArticles.flatMap(({ audience, slug }) => {
    const key = `${audience}:${slug}`;
    const oldArticle = baseline.get(key);
    if (!oldArticle) throw new Error(`Retired task guide is missing from Git baseline: ${key}`);
    if (current.has(key)) throw new Error(`Retired task guide still exists in current source; refusing to unpublish automatically: ${key}`);
    return [{ audience, slug, expectedOldContent: oldArticle.content }];
  });

  const insertMissing = newBuiltInArticles.map(({ audience, slug }) => {
    const key = `${audience}:${slug}`;
    const nextArticle = current.get(key);
    if (!nextArticle) throw new Error(`New built-in guide is missing from current source: ${key}`);
    if (baseline.has(key)) throw new Error(`New built-in guide already existed in Git baseline: ${key}`);
    return nextArticle;
  });

  const manifest = {
    schemaVersion: 1,
    baselineCommit,
    generatedAt: new Date().toISOString(),
    updates,
    unpublish,
    insertMissing,
  };
  const output = resolve(options.output);
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(JSON.stringify({ output, baselineCommit, updates: updates.length, unpublish: unpublish.length, insertMissing: insertMissing.length }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
