const PRICE_NOISE = /(?:php|usd|eur|gbp|cad|aud|[$₱€£¥])\s?[\d,.]+/gi;
const DISTANCE_NOISE = /\b\d+(\.\d+)?\s?(km|mi|miles)\b/gi;
const SIZE_UNITS = new Set(["kb", "mb", "gb", "tb"]);

type SizeToken = {
  num: string;
  unit: string;
};

export function stripSearchNoise(text: string): string {
  return text.replace(PRICE_NOISE, " ").replace(DISTANCE_NOISE, " ");
}

export function tokenize(query: string): string[] {
  const raw = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const tokens: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const next = raw[i + 1];
    if (/^\d+$/.test(raw[i]) && next && SIZE_UNITS.has(next)) {
      tokens.push(`${raw[i]}${next}`);
      i += 1;
      continue;
    }
    tokens.push(raw[i]);
  }
  return tokens;
}

function parseSizeToken(token: string): SizeToken | null {
  const match = token.match(/^(\d+)(kb|mb|gb|tb)$/);
  if (!match) {
    return null;
  }
  return { num: match[1], unit: match[2] };
}

function sizePattern(token: SizeToken): RegExp {
  return new RegExp(`(^|[^a-z0-9])${token.num}\\s*-?\\s*${token.unit}(?=[^a-z0-9]|$)`, "gi");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type TokenRange = {
  start: number;
  end: number;
};

function collectExactRanges(hay: string, token: string): TokenRange[] {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}(?=[^a-z0-9]|$)`, "gi");
  const found: TokenRange[] = [];
  for (const match of hay.matchAll(pattern)) {
    const prefix = match[1] || "";
    const start = (match.index || 0) + prefix.length;
    found.push({ start, end: start + token.length });
  }
  return found;
}

function collectSubstringRanges(hay: string, token: string): TokenRange[] {
  const found: TokenRange[] = [];
  let from = 0;
  while (from <= hay.length - token.length) {
    const start = hay.indexOf(token, from);
    if (start < 0) {
      break;
    }
    found.push({ start, end: start + token.length });
    from = start + token.length;
  }
  return found;
}

function collectSizeRanges(hay: string, token: SizeToken): TokenRange[] {
  const found: TokenRange[] = [];
  for (const match of hay.matchAll(sizePattern(token))) {
    const prefix = match[1] || "";
    const start = (match.index || 0) + prefix.length;
    found.push({ start, end: start + match[0].length - prefix.length });
  }
  return found;
}

function tokenRanges(hay: string, token: string, substring: boolean): TokenRange[] {
  const size = parseSizeToken(token);
  if (size) {
    return collectSizeRanges(hay, size);
  }
  return substring ? collectSubstringRanges(hay, token) : collectExactRanges(hay, token);
}

export function findTokenRanges(text: string, tokens: string[], substring = true): TokenRange[] {
  const hay = text.toLowerCase();
  const found: TokenRange[] = [];

  for (const token of tokens) {
    found.push(...tokenRanges(hay, token, substring));
  }

  found.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: TokenRange[] = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function haystackHasAllTokens(
  haystack: string,
  tokens: string[],
  substring = true
): boolean {
  if (tokens.length === 0) {
    return true;
  }

  const hay = haystack.toLowerCase();
  return tokens.every((token) => {
    const size = parseSizeToken(token);
    if (size) {
      return sizePattern(size).test(hay);
    }
    if (substring) {
      return hay.includes(token);
    }
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}([^a-z0-9]|$)`);
    return pattern.test(hay);
  });
}

export function listingMatchesQuery(
  title: string,
  description: string,
  query: string,
  substring = true
): boolean {
  return haystackHasAllTokens(
    stripSearchNoise(`${title} ${description}`),
    tokenize(query),
    substring
  );
}
