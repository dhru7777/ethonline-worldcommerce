/**
 * Merchant label helpers for ENSv2 subnames under shopify.eth.
 *
 * Demo: labels come from live UCP merchant names (search-driven), never a fixed Nike/Adidas list.
 * Production-style fallback: merchant1, merchant2, … when a display name is missing.
 */

const STOP = new Set(["the", "inc", "llc", "ltd", "co", "company", "store", "shop", "official"]);

export function slugifyMerchantName(raw: string): string {
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const parts = cleaned.split("-").filter((p) => p && !STOP.has(p));
  const base = (parts.length ? parts.join("-") : cleaned || "merchant").slice(0, 48);
  return base.replace(/^-+|-+$/g, "") || "merchant";
}

export function ensureUniqueLabel(label: string, taken: Set<string>): string {
  if (!taken.has(label)) return label;
  let i = 2;
  while (taken.has(`${label}-${i}`)) i += 1;
  return `${label}-${i}`;
}

/** Production-style sequential label when you do not want brand slugs. */
export function sequentialMerchantLabel(index: number): string {
  return `merchant${index}`;
}

/** Merchant leaf under agent hub: lindt.agent.shopify.eth */
export function fullMerchantName(label: string, rootLabel = "shopify"): string {
  return `${label}.agent.${rootLabel}.eth`;
}

export function agentHubName(rootLabel = "shopify"): string {
  return `agent.${rootLabel}.eth`;
}

export function commissionName(merchantLabel: string, rootLabel = "shopify"): string {
  return `commission.${merchantLabel}.agent.${rootLabel}.eth`;
}
