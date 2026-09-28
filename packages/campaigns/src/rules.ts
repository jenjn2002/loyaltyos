interface RuleCondition {
  field: string;
  eq?: unknown;
  neq?: unknown;
  gt?: number;
  lt?: number;
  gte?: number;
  lte?: number;
  in?: unknown[];
  between?: [number, number];
  contains?: string;
}

interface RuleGroup {
  all?: (RuleCondition | RuleGroup)[];
  any?: (RuleCondition | RuleGroup)[];
}

export function evaluateRules(
  rules: Record<string, unknown> | null,
  context: Record<string, unknown>,
): boolean {
  if (!rules || Object.keys(rules).length === 0) {
    return true;
  }
  // PointRule used a legacy flat object such as { department: "Sales" }.
  // Keep those migrated rules working while new campaigns use the rule-group DSL.
  if (!("all" in rules) && !("any" in rules)) {
    return Object.entries(rules).every(([field, expected]) => {
      const actual = resolveField(field, context);
      if (expected && typeof expected === "object" && !Array.isArray(expected)) {
        const operators = expected as Record<string, unknown>;
        if ("$eq" in operators && actual !== operators.$eq) return false;
        if ("$gte" in operators && !matchesNumeric(actual, operators.$gte, (value, threshold) => value >= threshold)) return false;
        if ("$lte" in operators && !matchesNumeric(actual, operators.$lte, (value, threshold) => value <= threshold)) return false;
        return true;
      }
      return actual === expected;
    });
  }
  return matchesGroup(rules as unknown as RuleGroup, context);
}

function matchesGroup(group: RuleGroup, context: Record<string, unknown>): boolean {
  let result = true;

  if (group.all && group.all.length > 0) {
    result = group.all.every((item) => matchesItem(item, context));
    if (!result) return false;
  }

  if (group.any && group.any.length > 0) {
    result = group.any.some((item) => matchesItem(item, context));
    if (!result) return false;
  }

  return result;
}

function matchesItem(item: RuleCondition | RuleGroup, context: Record<string, unknown>): boolean {
  if ("all" in item || "any" in item) {
    return matchesGroup(item, context);
  }
  return matchesCondition(item as RuleCondition, context);
}

function matchesCondition(condition: RuleCondition, context: Record<string, unknown>): boolean {
  const actual = resolveField(condition.field, context);

  if (condition.eq !== undefined && actual !== condition.eq) return false;
  if (condition.neq !== undefined && actual === condition.neq) return false;
  if (condition.gt !== undefined && !matchesNumeric(actual, condition.gt, (value, threshold) => value > threshold)) return false;
  if (condition.lt !== undefined && !matchesNumeric(actual, condition.lt, (value, threshold) => value < threshold)) return false;
  if (condition.gte !== undefined && !matchesNumeric(actual, condition.gte, (value, threshold) => value >= threshold)) return false;
  if (condition.lte !== undefined && !matchesNumeric(actual, condition.lte, (value, threshold) => value <= threshold)) return false;

  if (condition.in !== undefined) {
    if (!Array.isArray(condition.in) || !condition.in.some((v) => v === actual)) {
      return false;
    }
  }

  if (condition.between !== undefined) {
    const num = toFiniteNumber(actual);
    const lower = toFiniteNumber(condition.between[0]);
    const upper = toFiniteNumber(condition.between[1]);
    if (num === undefined || lower === undefined || upper === undefined || num < lower || num > upper) return false;
  }

  if (condition.contains !== undefined) {
    if (typeof actual !== "string" || !actual.includes(condition.contains)) {
      return false;
    }
  }

  return true;
}

function resolveField(field: string, context: Record<string, unknown>): unknown {
  return context[field];
}

function matchesNumeric(
  value: unknown,
  threshold: unknown,
  predicate: (value: number, threshold: number) => boolean,
): boolean {
  const numericValue = toFiniteNumber(value);
  const numericThreshold = toFiniteNumber(threshold);
  return numericValue !== undefined && numericThreshold !== undefined && predicate(numericValue, numericThreshold);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return undefined;
  if (typeof value !== "number" && typeof value !== "string" && !(value instanceof Date)) return undefined;
  const numericValue = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}
