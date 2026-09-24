import { z } from "zod";

export const automationSchema = z.object({
  mode: z.enum(["EXTERNAL", "MANUAL", "ONBOARDING", "MEMBER_DATE_ANNUAL", "ANNIVERSARY", "ANNUAL_DATE", "ONCE"]).default("EXTERNAL"),
  timezone: z.string().default("Asia/Ho_Chi_Minh").refine((value) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Invalid timezone"),
  dateField: z.string().regex(/^(joinedAt|metadata\.[a-z][a-z0-9_]*)$/).default("joinedAt"),
  date: z.string().optional(),
  monthDay: z.string().optional(),
  offsetDays: z.number().int().min(0).max(3650).default(0),
  leapDayPolicy: z.enum(["ONLY_LEAP_YEAR", "FEB_28", "MAR_01"]).default("ONLY_LEAP_YEAR"),
}).superRefine((config, ctx) => {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if (config.mode === "ONCE" && !validDate(config.date ?? "")) ctx.addIssue({ code: "custom", message: "A valid date is required", path: ["date"] });
  if (config.mode === "ANNUAL_DATE" && !validDate(`2000-${config.monthDay ?? ""}`)) ctx.addIssue({ code: "custom", message: "A valid month/day is required", path: ["monthDay"] });
});
export type OccasionSchedule = z.infer<typeof automationSchema>;

export const ANNUAL_MEMBER_DATE_MODES = ["MEMBER_DATE_ANNUAL", "ANNIVERSARY"] as const;
export const STANDING_OCCASION_MODES = ["ONBOARDING", ...ANNUAL_MEMBER_DATE_MODES, "ANNUAL_DATE"] as const;

export function isStandingOccasionMode(mode: string | undefined): boolean {
  return STANDING_OCCASION_MODES.includes(mode as (typeof STANDING_OCCASION_MODES)[number]);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function matchesMonthDay(monthDay: string, today: string, policy: OccasionSchedule["leapDayPolicy"]): boolean {
  if (monthDay === today.slice(5)) return true;
  if (monthDay !== "02-29" || isLeapYear(Number(today.slice(0, 4)))) return false;
  if (policy === "FEB_28") return today.slice(5) === "02-28";
  if (policy === "MAR_01") return today.slice(5) === "03-01";
  return false;
}
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
/** Returns a stable occurrence key; onboarding never backfills older accounts. */
export function occasionKey(config: OccasionSchedule, member: { joinedAt: Date; metadata: unknown }, now: Date, enabledSince: Date): string | null {
  const today = localDate(now, config.timezone);
  // Manual and external definitions are only event keys for campaign
  // configuration. Neither one is emitted by the occasion scheduler.
  if (config.mode === "EXTERNAL" || config.mode === "MANUAL") return null;
  if (config.mode === "ONCE") return config.date === today ? today : null;
  if (config.mode === "ANNUAL_DATE") return config.monthDay && matchesMonthDay(config.monthDay, today, config.leapDayPolicy) ? today : null;
  const metadata = member.metadata as Record<string, unknown> | null;
  const raw = config.dateField === "joinedAt" ? member.joinedAt : metadata?.[config.dateField.slice(9)];
  if (!(raw instanceof Date) && typeof raw !== "string") return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const day = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : localDate(date, config.timezone);
  if (ANNUAL_MEMBER_DATE_MODES.includes(config.mode as (typeof ANNUAL_MEMBER_DATE_MODES)[number])) {
    return matchesMonthDay(day.slice(5), today, config.leapDayPolicy) ? today : null;
  }
  const due = new Date(`${day}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + config.offsetDays);
  return member.joinedAt >= enabledSince && due.toISOString().slice(0,10) <= today ? "onboarding" : null;
}
