export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type TokenRange = {
  start: number;
  end: number;
};

export function findTokenRanges(text: string, tokens: string[]): TokenRange[] {
  const hay = text.toLowerCase();
  const found: TokenRange[] = [];

  for (const token of tokens) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}(?=[^a-z0-9]|$)`, "gi");
    for (const match of hay.matchAll(pattern)) {
      const prefix = match[1] || "";
      const start = (match.index || 0) + prefix.length;
      found.push({ start, end: start + token.length });
    }
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

export function haystackHasAllTokens(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return true;
  }

  const hay = haystack.toLowerCase();
  return tokens.every((token) => {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}([^a-z0-9]|$)`);
    return pattern.test(hay);
  });
}

export function listingMatchesQuery(
  title: string,
  description: string,
  query: string
): boolean {
  return haystackHasAllTokens(`${title} ${description}`, tokenize(query));
}
