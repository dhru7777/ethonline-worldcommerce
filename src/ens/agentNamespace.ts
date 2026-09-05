import type { Address } from "viem";
import { config } from "../config/index.js";
import { ensip25KeyForAgent } from "./erc7930.js";
import {
  authorizeTextRolesLive,
  registerLabelLive,
  setTextLive,
  shopifyDeployerKey,
} from "./liveRegistry.js";
import {
  buildMerchantAgentContext,
  ENSIP26,
  ensip25RegistrationKey,
} from "./records.js";
import {
  agentHubName,
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
    [buyerKey]: "1",
    "com.worldcommerce.payment": "x402",
    "com.worldcommerce.chain": `eip155:${config.seller.chainId}`,
    "com.worldcommerce.ucp": "shopify",
    "com.worldcommerce.version": "1",
  };
}

/**
 * Lazy ENS ensure for merchants discovered in a UCP search.
 * Live: register under agent.shopify.eth hub when ENS_WRITE_MODE=live.
 */
export async function ensureMerchantNamespaces(
  input: EnsureMerchantsInput,
): Promise<MerchantNamespace[]> {
  const hub = agentHubName(config.ens.rootLabel);
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

    const deployerKey = shopifyDeployerKey();
    const agentRegistry = config.ens.agentShopifyRegistry;
    if (config.ens.writeMode === "live" && deployerKey && agentRegistry) {
      try {
        const owner =
          (config.merchants.m1.address as Address | undefined) ||
          (config.shopify.walletAddress as Address | undefined);
        if (!owner) throw new Error("No merchant/shopify owner address for live register");

        const reg = await registerLabelLive({
          registry: agentRegistry as Address,
          label,
          owner,
          privateKey: deployerKey,
        });
        txHash = reg.txHash;

        await setTextLive({
          ensName,
          key: "com.worldcommerce.version",
          value: textRecords["com.worldcommerce.version"] || "1",
          privateKey: deployerKey,
        });
        if (config.merchants.m1.address) {
          await authorizeTextRolesLive({
            ensName,
            key: ENSIP26.agentEndpoint("web"),
            account: config.merchants.m1.address as Address,
            grant: true,
            privateKey: deployerKey,
          });
        }
        created = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[ens live] register ${ensName} failed: ${msg}`);
        txHash = null;
        created = false;
      }
    }

    const entry: MerchantNamespace = {
      merchantName: m.merchantName,
      label,
      ensName,
      parentName: hub,
      created,
      mode: input.sequentialLabels ? "sequential-prod-style" : "lazy-demo",
      writeMode: config.ens.writeMode,
      txHash,
      textRecords,
      permissionsNote:
        "EAC: Shopify admin full control; merchant may edit agent-endpoint[web] — not ENSIP-25 or commission.*",
    };

    byMerchantKey.set(key, entry);
    out.push(entry);
  }

  return out;
}

export function getNamespaceTree() {
  return {
    root: `${config.ens.rootLabel}.eth`,
    agentHub: agentHubName(config.ens.rootLabel),
    subregistry: config.ens.agentShopifyRegistry
      ? `agent.shopify registry ${config.ens.agentShopifyRegistry}`
      : config.ens.shopifyUserRegistry
        ? `ShopifyUserRegistry ${config.ens.shopifyUserRegistry}`
        : "shopify-user-registry (ENSv2)",
    merchants: [...byMerchantKey.values()],
  };
}

// Re-export for callers that only need key helpers
export { ensip25RegistrationKey, ensip25KeyForAgent };
