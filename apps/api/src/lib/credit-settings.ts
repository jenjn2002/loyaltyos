import type { AdminRole, Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../db.js";
import { LoyaltyError } from "./errors.js";

export const CREDIT_SETTING_DEFINITIONS = [
  { key: "p_credit_value_minor", label: "P-credit value (minor units)", type: "integer", description: "Official reporting/exchange value for one P-credit." },
  { key: "r_credit_value_minor", label: "R-credit value (minor units)", type: "integer", description: "Reference value for one R-credit; R-credit remains non-cash." },
  { key: "payout_currency", label: "Payout currency", type: "currency", description: "Three-letter currency used by exchange rates." },
  { key: "p_exchange_min_credits", label: "P-credit exchange minimum", type: "integer", description: "Minimum P-credit amount per exchange request." },
  { key: "p_exchange_max_credits", label: "P-credit exchange maximum", type: "nullable_integer", description: "Maximum P-credit amount; zero means no maximum." },
  { key: "r_exchange_min_credits", label: "R-credit exchange minimum", type: "integer", description: "Minimum non-cash R-credit exchange amount." },
  { key: "r_exchange_max_credits", label: "R-credit exchange maximum", type: "nullable_integer", description: "Maximum non-cash R-credit amount; zero means no maximum." },
  { key: "payout_mechanism", label: "Payout mechanism", type: "text", description: "Configured settlement route, for example manual bank transfer." },
  { key: "payout_enabled", label: "Cash payout enabled", type: "boolean", description: "Enables cash payout only for P-credit." },
  { key: "reconciliation_adapter", label: "Reconciliation adapter", type: "text", description: "Adapter or operating process used to reconcile settlement." },
  { key: "reconciliation_export_format", label: "Reconciliation export format", type: "format", description: "Format used by finance reconciliation exports." },
  { key: "reconciliation_cycle_days", label: "Reconciliation cycle (days)", type: "integer", description: "Rolling bank reconciliation cycle length." },
  { key: "budget_minor_units", label: "Approved budget (minor units)", type: "nullable_integer", description: "Approved budget; zero means not specified." },
  { key: "default_r_issuance_policy", label: "Default R-credit issuance policy", type: "issuance_policy", description: "Controls how recognition-credit issuance is governed." },
  { key: "standing_occasion_approval", label: "Standing occasion approval", type: "approval_policy", description: "Controls whether standing-occasion grants require approval." },
  { key: "employee_fulfillment_visibility", label: "Employee fulfillment visibility", type: "visibility", description: "Controls whether employees can see their reward fulfillment status." },
] as const;

export type CreditSettingKey = (typeof CREDIT_SETTING_DEFINITIONS)[number]["key"];

export const CREDIT_SETTING_DEFAULTS: Record<CreditSettingKey, unknown> = {
  p_credit_value_minor: 100,
  r_credit_value_minor: 0,
  payout_currency: "USD",
  p_exchange_min_credits: 1,
  p_exchange_max_credits: 0,
  r_exchange_min_credits: 1,
  r_exchange_max_credits: 0,
  payout_mechanism: "manual_bank_transfer",
  payout_enabled: false,
  reconciliation_adapter: "manual_csv",
  reconciliation_export_format: "csv",
  reconciliation_cycle_days: 30,
  budget_minor_units: 0,
  default_r_issuance_policy: "ADMIN_ONLY",
  standing_occasion_approval: "REASON_REQUIRED",
  employee_fulfillment_visibility: "ADMIN_ONLY",
};

const OPERATOR_EDITABLE_KEYS = new Set<CreditSettingKey>([
  "reconciliation_export_format",
  "reconciliation_cycle_days",
  "default_r_issuance_policy",
  "standing_occasion_approval",
  "employee_fulfillment_visibility",
]);

export const CREDIT_SETTING_ROLES: AdminRole[] = ["SUPER_ADMIN", "OPERATOR", "ANALYST"];

export function defaultCreditSettingPermission(key: CreditSettingKey, role: AdminRole): { canView: boolean; canEdit: boolean } {
  if (role === "SUPER_ADMIN") return { canView: true, canEdit: true };
  if (role === "OPERATOR") return { canView: true, canEdit: OPERATOR_EDITABLE_KEYS.has(key) };
  return { canView: true, canEdit: false };
}

function definitionFor(key: string) {
  return CREDIT_SETTING_DEFINITIONS.find((definition) => definition.key === key);
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function normalizeCreditSettingValues(values: Record<string, unknown>): Record<CreditSettingKey, unknown> {
  const normalized: Partial<Record<CreditSettingKey, unknown>> = {};
  for (const [key, rawValue] of Object.entries(values)) {
    const definition = definitionFor(key);
    if (!definition) throw new LoyaltyError("CREDIT_SETTING_UNKNOWN", 400, { key });
    if (definition.type === "integer" || definition.type === "nullable_integer") {
      if (definition.type === "nullable_integer" && (rawValue === null || rawValue === "" || rawValue === 0)) {
        normalized[definition.key] = null;
        continue;
      }
      if (typeof rawValue !== "number" || !Number.isInteger(rawValue) || rawValue < 0) {
        throw new LoyaltyError("CREDIT_SETTING_INVALID_VALUE", 400, { key });
      }
      normalized[definition.key] = rawValue;
      continue;
    }
    if (definition.type === "boolean") {
      if (typeof rawValue !== "boolean") throw new LoyaltyError("CREDIT_SETTING_INVALID_VALUE", 400, { key });
      normalized[definition.key] = rawValue;
      continue;
    }
    if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
      throw new LoyaltyError("CREDIT_SETTING_INVALID_VALUE", 400, { key });
    }
    const value = rawValue.trim();
    if (definition.type === "currency" && !/^[A-Z]{3}$/.test(value.toUpperCase())) {
      throw new LoyaltyError("CREDIT_SETTING_INVALID_VALUE", 400, { key });
    }
    if (definition.type === "format" && !["csv", "json"].includes(value)) {
      throw new LoyaltyError("CREDIT_SETTING_INVALID_VALUE", 400, { key });
    }
    if (definition.type === "issuance_policy" && !["ADMIN_ONLY", "BANK_CYCLE"].includes(value)) {
      throw new LoyaltyError("CREDIT_SETTING_INVALID_VALUE", 400, { key });
    }
    if (definition.type === "approval_policy" && !["REASON_REQUIRED", "APPROVAL_REQUIRED"].includes(value)) {
      throw new LoyaltyError("CREDIT_SETTING_INVALID_VALUE", 400, { key });
    }
    if (definition.type === "visibility" && !["ADMIN_ONLY", "MEMBER_READ_ONLY"].includes(value)) {
      throw new LoyaltyError("CREDIT_SETTING_INVALID_VALUE", 400, { key });
    }
    normalized[definition.key] = definition.type === "currency" ? value.toUpperCase() : value;
  }
  return normalized as Record<CreditSettingKey, unknown>;
}

export async function ensureCreditSettings(programId: string, db: PrismaClient = prisma) {
  const activeRates = await db.creditExchangeRate.findMany({
    where: { programId, isActive: true },
    orderBy: { version: "desc" },
  });
  const defaults: Record<CreditSettingKey, unknown> = { ...CREDIT_SETTING_DEFAULTS };
  const pRate = activeRates.find((rate) => rate.creditType === "P");
  const rRate = activeRates.find((rate) => rate.creditType === "R");
  if (pRate) {
    defaults.p_credit_value_minor = pRate.valueMinorPerCredit;
    defaults.payout_currency = pRate.currency;
    defaults.payout_mechanism = pRate.payoutMechanism;
    defaults.payout_enabled = pRate.cashEligible;
    defaults.p_exchange_min_credits = pRate.minCredits;
    defaults.p_exchange_max_credits = pRate.maxCredits ?? 0;
  }
  if (rRate) {
    defaults.r_credit_value_minor = rRate.valueMinorPerCredit;
    defaults.r_exchange_min_credits = rRate.minCredits;
    defaults.r_exchange_max_credits = rRate.maxCredits ?? 0;
  }
  await Promise.all(
    CREDIT_SETTING_DEFINITIONS.map((definition) =>
      db.creditSetting.upsert({
        where: { programId_key: { programId, key: definition.key } },
        create: { programId, key: definition.key, value: defaults[definition.key] as Prisma.InputJsonValue },
        update: {},
      }),
    ),
  );
  await Promise.all(
    CREDIT_SETTING_DEFINITIONS.flatMap((definition) =>
      CREDIT_SETTING_ROLES.map((role) => {
        const permission = defaultCreditSettingPermission(definition.key, role);
        return db.creditSettingPermission.upsert({
          where: { programId_settingKey_role: { programId, settingKey: definition.key, role } },
          create: { programId, settingKey: definition.key, role, ...permission },
          update: {},
        });
      }),
    ),
  );
  return getCreditSettings(programId, db);
}

export async function getCreditSettings(programId: string, db: PrismaClient = prisma) {
  const [rows, permissions] = await Promise.all([
    db.creditSetting.findMany({ where: { programId } }),
    db.creditSettingPermission.findMany({ where: { programId }, orderBy: [{ settingKey: "asc" }, { role: "asc" }] }),
  ]);
  const values: Record<string, unknown> = { ...CREDIT_SETTING_DEFAULTS };
  for (const row of rows) values[row.key] = row.value;
  return {
    values,
    definitions: CREDIT_SETTING_DEFINITIONS,
    permissions,
  };
}

export async function requireCreditSettingPermission(
  programId: string,
  adminId: string | null,
  apiKeyScope: string,
  key: string,
  action: "VIEW" | "EDIT",
  db: PrismaClient = prisma,
): Promise<AdminRole | "SERVER"> {
  const definition = definitionFor(key);
  if (!definition) throw new LoyaltyError("CREDIT_SETTING_UNKNOWN", 400, { key });
  if (apiKeyScope === "SERVER") return "SERVER";
  if (!adminId) throw new LoyaltyError("FORBIDDEN", 403);
  const admin = await db.adminUser.findUnique({ where: { id: adminId }, select: { role: true, programId: true } });
  if (!admin || admin.programId !== programId) throw new LoyaltyError("FORBIDDEN", 403);
  const permission = await db.creditSettingPermission.findUnique({ where: { programId_settingKey_role: { programId, settingKey: key, role: admin.role } } });
  const allowed = permission?.[action === "VIEW" ? "canView" : "canEdit"] ?? defaultCreditSettingPermission(definition.key, admin.role)[action === "VIEW" ? "canView" : "canEdit"];
  if (!allowed) throw new LoyaltyError("FORBIDDEN", 403);
  return admin.role;
}

export async function requireSuperAdmin(
  programId: string,
  adminId: string | null,
  apiKeyScope: string,
  db: PrismaClient = prisma,
): Promise<AdminRole | "SERVER"> {
  if (apiKeyScope === "SERVER") return "SERVER";
  if (!adminId) throw new LoyaltyError("FORBIDDEN", 403);
  const admin = await db.adminUser.findUnique({ where: { id: adminId }, select: { role: true, programId: true } });
  if (!admin || admin.programId !== programId || admin.role !== "SUPER_ADMIN") throw new LoyaltyError("FORBIDDEN", 403);
  return admin.role;
}

export function settingValuesAsRecord(value: unknown): Record<string, unknown> {
  return asObject(value);
}

export async function syncExchangeRatesFromSettings(programId: string, values: Record<string, unknown>, db: PrismaClient = prisma): Promise<void> {
  const currency = String(values.payout_currency ?? CREDIT_SETTING_DEFAULTS.payout_currency);
  const payoutMechanism = String(values.payout_mechanism ?? CREDIT_SETTING_DEFAULTS.payout_mechanism);
  const payoutEnabled = values.payout_enabled === true;
  const definitions: Array<{ creditType: "P" | "R"; valueKey: CreditSettingKey; minKey: CreditSettingKey; maxKey: CreditSettingKey }> = [
    { creditType: "P", valueKey: "p_credit_value_minor", minKey: "p_exchange_min_credits", maxKey: "p_exchange_max_credits" },
    { creditType: "R", valueKey: "r_credit_value_minor", minKey: "r_exchange_min_credits", maxKey: "r_exchange_max_credits" },
  ];
  for (const definition of definitions) {
    const valueMinorPerCredit = Number(values[definition.valueKey] ?? 0);
    if (!Number.isInteger(valueMinorPerCredit) || valueMinorPerCredit <= 0) continue;
    const minCredits = Number(values[definition.minKey] ?? 1);
    const maxRaw = Number(values[definition.maxKey] ?? 0);
    const maxCredits = maxRaw > 0 ? maxRaw : null;
    const active = await db.creditExchangeRate.findFirst({ where: { programId, creditType: definition.creditType, isActive: true }, orderBy: { version: "desc" } });
    const unchanged = active && active.valueMinorPerCredit === valueMinorPerCredit && active.currency === currency && active.payoutMechanism === payoutMechanism && active.cashEligible === (definition.creditType === "P" && payoutEnabled) && active.minCredits === minCredits && active.maxCredits === maxCredits;
    if (unchanged) continue;
    await db.$transaction(async (tx) => {
      await tx.creditExchangeRate.updateMany({ where: { programId, creditType: definition.creditType, isActive: true }, data: { isActive: false } });
      const latest = await tx.creditExchangeRate.findFirst({ where: { programId, creditType: definition.creditType }, orderBy: { version: "desc" }, select: { version: true } });
      await tx.creditExchangeRate.create({
        data: {
          programId,
          creditType: definition.creditType,
          version: (latest?.version ?? 0) + 1,
          valueMinorPerCredit,
          currency,
          payoutMechanism,
          cashEligible: definition.creditType === "P" && payoutEnabled,
          minCredits,
          maxCredits,
        },
      });
    });
  }
}
