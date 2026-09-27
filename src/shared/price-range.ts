export type PriceRange = {
  min: number;
  max: number;
};

export type PriceRangeFilter = {
  raw: string;
  ranges: PriceRange[];
  error: string;
};

export function parsePriceAmount(price: string): number | null {
  const clean = price.trim().toLowerCase().replace(/,/g, "");
  if (!clean) {
    return null;
  }
  const withSuffix = clean.match(/(\d+(?:\.\d+)?)\s*([km])\b/);
  if (withSuffix) {
    const amount = Number(withSuffix[1]);
    if (!Number.isFinite(amount)) {
      return null;
    }
    return Math.round(amount * (withSuffix[2] === "m" ? 1_000_000 : 1_000));
  }
  const digits = clean.match(/(\d+(?:\.\d+)?)/);
  if (!digits) {
    return null;
  }
  const amount = Number(digits[1]);
  return Number.isFinite(amount) ? amount : null;
}

function parseOneRange(part: string): PriceRange | null {
  const text = part.trim().toLowerCase();
  if (!text) {
    return null;
  }
  const match = text.match(/^(\d+(?:\.\d+)?\s*[km]?)\s*(?:-|to)\s*(\d+(?:\.\d+)?\s*[km]?)$/i);
  if (!match) {
    return null;
  }
  const min = parsePriceAmount(match[1]);
  const max = parsePriceAmount(match[2]);
  if (min === null || max === null) {
    return null;
  }
  return min <= max ? { min, max } : { min: max, max: min };
}

export function compilePriceRanges(raw: string): PriceRangeFilter {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { raw: "", ranges: [], error: "" };
  }
  const parts = trimmed
    .split(/\s*(?:,|;|\band\b|\|)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { raw: trimmed, ranges: [], error: "" };
  }
  const ranges: PriceRange[] = [];
  for (const part of parts) {
    const range = parseOneRange(part);
    if (!range) {
      return {
        raw: trimmed,
        ranges: [],
        error: `Bad price range "${part}". Use min-max like 5000-10000.`
      };
    }
    ranges.push(range);
  }
  return { raw: trimmed, ranges, error: "" };
}

export function listingMatchesPriceRanges(price: string, filter: PriceRangeFilter): boolean {
  if (!filter.raw.trim()) {
    return true;
  }
  if (filter.error || filter.ranges.length === 0) {
    return false;
  }
  const amount = parsePriceAmount(price);
  if (amount === null) {
    return false;
  }
  return filter.ranges.some((range) => amount >= range.min && amount <= range.max);
}
