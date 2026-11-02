import { prisma } from "../db.js";
import { closeExpiredBankCycles } from "./wallets.js";

const MAX_RECHECK_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let reportError: (error: unknown) => void = (error) => {
  console.error("[Bank cycles] Expiry scheduler failed:", error);
};

function arm(delayMs: number, currentGeneration: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void refresh(currentGeneration);
  }, Math.max(0, delayMs));
}

async function refresh(currentGeneration: number): Promise<void> {
  if (currentGeneration !== generation) return;

  try {
    await closeExpiredBankCycles();
    const nextCycle = await prisma.pointBankCycle.findFirst({
      where: { status: "OPEN", clearBankOnClose: true },
      orderBy: { endsAt: "asc" },
      select: { endsAt: true },
    });
    if (currentGeneration !== generation) return;

    const now = Date.now();
    const dueInMs = nextCycle ? nextCycle.endsAt.getTime() - now : MAX_RECHECK_MS;
    const delay = dueInMs <= 0 ? MAX_RECHECK_MS : Math.min(dueInMs, MAX_RECHECK_MS);
    arm(delay, currentGeneration);
  } catch (error) {
    if (currentGeneration !== generation) return;
    reportError(error);
    arm(MAX_RECHECK_MS, currentGeneration);
  }
}

/** Start or re-arm the expiry timer after a bank cycle is created or changed. */
export function scheduleBankCycleExpiry(onError?: (error: unknown) => void): void {
  if (onError) reportError = onError;
  generation += 1;
  if (timer) clearTimeout(timer);
  timer = undefined;
  arm(0, generation);
}

export function stopBankCycleExpiryScheduler(): void {
  generation += 1;
  if (timer) clearTimeout(timer);
  timer = undefined;
}
