// server/utils/contentGuard.ts
// ------------------------------------------
// Social media domain blocklist using hagezi dns-blocklists
// ------------------------------------------

// ============================================================
// CONFIG: hagezi social blocklist via jsDelivr CDN
// ============================================================
export const SOCIAL_BLOCKLIST_URL =
  'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/social.txt';

// ============================================================
// DOMAIN PARSING & STORAGE
// ============================================================
const blockedDomains = new Set<string>(); // O(1) lookups
let isInitialized = false;
let initPromise: Promise<void> | null = null;

function parseSocialListLine(line: string): string | null {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return null;

  // Strip AdBlock syntax: ||example.com^
  if (trimmed.startsWith('||')) {
    trimmed = trimmed.slice(2);
  }
  if (trimmed.endsWith('^')) {
    trimmed = trimmed.slice(0, -1);
  }

  // Hosts format: "0.0.0.0 domain.com" or "127.0.0.1 domain.com"
  const hostsMatch = trimmed.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+(\S+)/);
  if (hostsMatch?.[1]) {
    trimmed = hostsMatch[1];
  }

  // Strip protocol if present
  trimmed = trimmed.replace(/^https?:\/\//, '');

  // Extract hostname (strip paths, ports, query params)
  const domainPart = trimmed.split('/')[0]?.split(':')[0]?.split('?')[0]?.trim();
  if (!domainPart || /^\d+\.\d+\.\d+\.\d+$/.test(domainPart) || !domainPart.includes('.')) {
    return null;
  }

  return domainPart.toLowerCase().replace(/^www\./, '');
}

// ============================================================
// INIT: download social list + compile to RAM
// Uses global fetch. Caches in RAM once loaded.
// ============================================================
export async function initBlocklists(): Promise<void> {
  if (isInitialized && blockedDomains.size > 0) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const res = await fetch(SOCIAL_BLOCKLIST_URL, {
        headers: { 'Cache-Control': 'max-age: 86400' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const lines = text.split('\n');
      for (const line of lines) {
        const domain = parseSocialListLine(line);
        if (domain) {
          blockedDomains.add(domain);
        }
      }
      isInitialized = true;
      console.log(`[Guard] Loaded ${blockedDomains.size} social domains into memory.`);
    } catch (e) {
      console.warn('[Guard] Error fetching social blocklist:', e);
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

// ============================================================
// IS BLOCKED: check if a URL's hostname or any parent domain is blocked
// ============================================================
export function isBlocked(url: string): boolean {
  try {
    let hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (!hostname) return false;

    // Check exact hostname and parent domain suffixes (e.g. m.facebook.com -> facebook.com)
    while (hostname.includes('.')) {
      if (blockedDomains.has(hostname)) {
        return true;
      }
      const nextDot = hostname.indexOf('.');
      if (nextDot === -1) break;
      hostname = hostname.slice(nextDot + 1);
    }
    return false;
  } catch {
    return false;
  }
}

// ============================================================
// TEXT SAFETY CLASSIFICATION
// Uses heuristic analysis (not a keyword list) to detect
// likely NSFW/adult content in search result titles/snippets.
// Can be replaced with a real AI model integration later.
// ============================================================

// Heuristic patterns that indicate likely adult content.
// These are structural patterns, not a simple word list,
// so they filter "thong bikini" in sexual contexts but allow
// fashion/beach contexts depending on overall text structure.
const ADULT_INDICATORS = {
  // Title heavily focused on revealing clothing without context
  revealingTitle: /^(bikini|lingerie|swimsuit|underwear)\s+(gallery|collection|photos|pics?|album)/i,
  // Snippet contains multiple revealing terms (3+)
  multipleRevealingTerms: /(bikini|thong|lingerie|swimsuit|underwear).*(bikini|thong|lingerie|swimsuit|underwear)/i,
  // "hot" or "sexy" as the primary descriptor of a person
  sexualizedDescription: /(hot|sexy|sexy\s+girl|sexy\s+woman|babe|cutie).*(bikini|lingerie|thong)/i,
  // Explicit pose/act descriptions
  explicitPose: /\b(bikini|lingerie)\s+(photos?|pics?|model|gallery)\s+(posing|wearing|showing)/i,
}

// Text safety classification result
export interface TextSafetyResult {
  isLikelyAdult: boolean
  confidence: 'low' | 'medium' | 'high'
  reason: string
}

/**
 * Classify if text is likely NSFW/adult content using heuristics.
 * @param text The combined title + snippet text to analyze
 * @returns Safety classification result
 */
export function classifyTextSafety(text: string): TextSafetyResult {
  const lower = text.toLowerCase()
  const results: { match: RegExp; label: string }[] = []

  // Check each indicator pattern
  if (ADULT_INDICATORS.revealingTitle.test(lower)) {
    results.push({ match: ADULT_INDICATORS.revealingTitle, label: 'revealingTitle' })
  }
  if (ADULT_INDICATORS.multipleRevealingTerms.test(lower)) {
    results.push({ match: ADULT_INDICATORS.multipleRevealingTerms, label: 'multipleTerms' })
  }
  if (ADULT_INDICATORS.sexualizedDescription.test(lower)) {
    results.push({ match: ADULT_INDICATORS.sexualizedDescription, label: 'sexualizedDescription' })
  }
  if (ADULT_INDICATORS.explicitPose.test(lower)) {
    results.push({ match: ADULT_INDICATORS.explicitPose, label: 'explicitPose' })
  }

  // Determine safety level based on number of matching indicators
  let isLikelyAdult = false
  let confidence: 'low' | 'medium' | 'high' = 'low'
  let reason = 'No adult indicators detected'

  switch (results.length) {
    case 0:
      isLikelyAdult = false
      confidence = 'low'
      reason = 'No adult indicators detected'
      break
    case 1:
      isLikelyAdult = true
      confidence = 'medium'
      reason = `${results[0].label} pattern detected`
      break
    case 2:
    case 3:
      isLikelyAdult = true
      confidence = 'high'
      reason = `${results.length} adult indicators detected`
      break
    default:
      isLikelyAdult = true
      confidence = 'high'
      reason = `${results.length} adult indicators detected`
  }

  return { isLikelyAdult, confidence, reason }
}

/**
 * Check if a search result likely contains adult content.
 * @param result The search result with title and optionally snippet
 * @returns True if the result is likely adult content
 */
export function isResultLikelyAdult(result: { title: string; snippet?: string }): TextSafetyResult {
  const combined = (result.title + ' ' + (result.snippet || '')).trim()
  if (!combined) return { isLikelyAdult: false, confidence: 'low', reason: 'Empty text' }
  return classifyTextSafety(combined)
}

/**
 * Filter results to remove those likely containing adult content.
 * @param results Search results to filter
 * @returns Filtered results with adult content removed
 */
export function filterAdultResults<T extends { title: string; snippet?: string }>(
  results: T[],
): T[] {
  return results.filter((r) => !isResultLikelyAdult(r as any).isLikelyAdult)
}

// ============================================================
// FILTER RESULTS: remove results from blocked social domains
// ============================================================
export function filterResults<T extends { url: string }>(results: T[]): T[] {
  return results.filter((r) => !isBlocked(r.url))
}
