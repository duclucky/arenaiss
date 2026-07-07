export interface CreditRefillInput {
  credits: number;
  lastRefillAt: string | null;
  now: Date;
}

export interface CreditRefillResult {
  credits: number;
  lastRefillAt: string;
  refilled: boolean;
}

const REFILL_THRESHOLD = 100;
const REFILL_TARGET = 200;

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function applyDailyCreditRefill(input: CreditRefillInput): CreditRefillResult {
  const todayBoundary = utcMidnight(input.now);
  const last = parseDate(input.lastRefillAt);
  const lastBoundary = last ? utcMidnight(last) : null;

  if (!lastBoundary) {
    return {
      credits: input.credits,
      lastRefillAt: todayBoundary.toISOString(),
      refilled: false,
    };
  }

  if (todayBoundary.getTime() <= lastBoundary.getTime()) {
    return {
      credits: input.credits,
      lastRefillAt: input.lastRefillAt ?? todayBoundary.toISOString(),
      refilled: false,
    };
  }

  const shouldRefill = input.credits < REFILL_THRESHOLD;
  return {
    credits: shouldRefill ? REFILL_TARGET : input.credits,
    lastRefillAt: todayBoundary.toISOString(),
    refilled: shouldRefill,
  };
}
