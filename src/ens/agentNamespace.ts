import { config } from "../config/index.js";
import { ensip25KeyForAgent } from "./erc7930.js";
import {
  buildMerchantAgentContext,
  ENSIP26,
  ensip25RegistrationKey,
} from "./records.js";
import {
  ensureUniqueLabel,
  fullMerchantName,
  sequentialMerchantLabel,
  slugifyMerchantName,
} from "./slug.js";

export type MerchantNamespace = {
  merchantName: string;
  label: string;
  ensName: string;
  parentName: string;
  created: boolean;
  mode: "lazy-demo" | "sequential-prod-style";
  writeMode: "dry-run" | "live";
  txHash: string | null;
  textRecords: Record<string, string>;
  permissionsNote: string;
};

export type EnsureMerchantsInput = {
  merchants: { merchantName: string }[];
  /** When true, use merchant1, merchant2… instead of brand slugs (prod-style). */
  sequentialLabels?: boolean;
};

/** In-memory namespace ledger for the demo process. */
const takenLabels = new Set<string>();
const byMerchantKey = new Map<string, MerchantNamespace>();

function merchantKey(name: string): string {
  return name.trim().toLowerCase();
}

function sellerChainLabel(chainId: number): string {
  if (chainId === 84532) return "Base Sepolia";
  if (chainId === 11155111) return "Ethereum Sepolia";
  return `chain ${chainId}`;
}

function buildTextRecords(ensName: string, merchantName: string): Record<string, string> {
  const sellerKey = ensip25KeyForAgent(
    config.seller.chainId,
    config.seller.identityRegistry,
    config.seller.agentId,
  );
  const buyerKey = ensip25KeyForAgent(
    config.buyer.chainId,
    config.buyer.identityRegistry,
    config.buyer.agentId,
  );

  return {
    [ENSIP26.agentContext]: buildMerchantAgentContext({
      merchantName,
      ensName,
      sellerAgentId: config.seller.agentId,
      sellerChainLabel: sellerChainLabel(config.seller.chainId),
    }),
    [ENSIP26.agentEndpoint("web")]: config.seller.serviceUrl || "https://catalog.shopify.com",
    [sellerKey]: "1",
    // Buyer binding is platform-level; still set for demo visibility on merchant leaf if desired
    [buyerKey]: "1",
    "com.worldcommerce.payment": "x402",
    "com.worldcommerce.chain": `eip155:${config.seller.chainId}`,
    "com.worldcommerce.ucp": "shopify",
    "com.worldcommerce.version": "1",
  };
}

/**
 * Lazy ENS ensure for merchants discovered in a UCP search.
 * Demo: shows creation + Permissioned Resolver text records + EAC note.
 * Live chain writes only when ENS_WRITE_MODE=live and a deployer key is set.
 */
export async function ensureMerchantNamespaces(
  input: EnsureMerchantsInput,
): Promise<MerchantNamespace[]> {
  const root = `${config.ens.rootLabel}.eth`;
  const out: MerchantNamespace[] = [];
  let seq = takenLabels.size + 1;

  for (const m of input.merchants) {
    const key = merchantKey(m.merchantName);
    const existing = byMerchantKey.get(key);
    if (existing) {
      out.push(existing);
      continue;
    }

    let label: string;
    if (input.sequentialLabels) {
      label = sequentialMerchantLabel(seq++);
      while (takenLabels.has(label)) {
        label = sequentialMerchantLabel(seq++);
      }
    } else {
      label = ensureUniqueLabel(slugifyMerchantName(m.merchantName), takenLabels);
    }

    takenLabels.add(label);
    const ensName = fullMerchantName(label, config.ens.rootLabel);
    const textRecords = buildTextRecords(ensName, m.merchantName);

    let txHash: string | null = null;
    let created = true;

    if (config.ens.writeMode === "live" && config.ens.deployerPrivateKey) {
      // Live Permissioned Registry register + resolver writes land in a follow-up module.
      // For now we mark as pending live path without silently faking a hash.
      txHash = null;
      created = false;
    }

    const entry: MerchantNamespace = {
      merchantName: m.merchantName,
      label,
      ensName,
      parentName: root,
      created,
      mode: input.sequentialLabels ? "sequential-prod-style" : "lazy-demo",
      writeMode: config.ens.writeMode,
      txHash,
      textRecords,
      permissionsNote:
        "EAC: Shopify admin full control under shopify.eth; merchant operator may edit agent-endpoint[*] and com.worldcommerce.* only — not ENSIP-25 registration keys.",
    };

    byMerchantKey.set(key, entry);
    out.push(entry);
  }

  return out;
}

export function getNamespaceTree() {
  return {
    root: `${config.ens.rootLabel}.eth`,
    subregistry: "shopify-user-registry (ENSv2 Permissioned Registry)",
    merchants: [...byMerchantKey.values()],
  };
}

// Re-export for callers that only need key helpers
export { ensip25RegistrationKey, ensip25KeyForAgent };
