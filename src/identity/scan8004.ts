import { config, scan8004ChainSlug, scan8004AgentUrl } from "../config/index.js";
import type { AgentIdentityView } from "./agents.js";
import { getBuyerIdentity, getSellerIdentity } from "./agents.js";

export type AgentProfilePayload = {
  role: "buyer" | "seller";
  configured: boolean;
  name: string;
  agentId: number;
  chainId: number;
  chainLabel: string;
  globalId: string;
  scanUrl: string;
  ensip25Key: string;
  source: "scan8004" | "env";
  sections: {
    identity: {
      agentId: number;
      chainLabel: string;
      globalId: string;
      owner: string | null;
      ownerShort: string | null;
      agentWallet: string | null;
      agentWalletShort: string | null;
      x402Support: boolean;
      trust: string[];
      ensip25Key: string;
    };
    ranking: {
      rank: number | null;
      networkRank: number | null;
      healthScore: number | null;
      popularity: number | null;
      freshness: number | null;
      metadataCompleteness: number | null;
      quality: number | null;
      activity: number | null;
    };
    feedback: {
      totalFeedbacks: number;
      averageScore: number | null;
      isVerified: boolean;
      starCount: number;
      watchCount: number;
      ownerUsername: string | null;
    };
    verify: {
      links: Array<{ label: string; url: string }>;
    };
  };
  warnings: string[];
};

function shortAddr(addr: string | null | undefined) {
  if (!addr) return null;
  const a = addr.trim();
  if (a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function explorerNftUrl(chainId: number, registry: string, agentId: number) {
  if (chainId === 84532) return `https://sepolia.basescan.org/nft/${registry}/${agentId}`;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/nft/${registry}/${agentId}`;
  return scan8004AgentUrl(chainId, agentId);
}

function explorerAddressUrl(chainId: number, address: string) {
  if (chainId === 84532) return `https://sepolia.basescan.org/address/${address}`;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/address/${address}`;
  return `https://sepolia.etherscan.io/address/${address}`;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchScanAgent(chainId: number, agentId: number): Promise<Record<string, unknown> | null> {
  const slug = scan8004ChainSlug(chainId);
  const bases = [
    `${config.scan8004.apiBase.replace(/\/$/, "")}/public`,
    config.scan8004.apiBase.replace(/\/$/, ""),
    "https://testnet.8004scan.io/api/v1/public",
  ];
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.scan8004.apiKey) headers["X-API-Key"] = config.scan8004.apiKey;

  for (const base of bases) {
    const urls = [
      `${base}/agents/${slug}/${agentId}`,
      `${base}/agents/${chainId}/${agentId}`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: url.includes("/public") ? { Accept: "application/json" } : headers,
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const body = (await res.json()) as Record<string, unknown>;
        if (body?.success === true && body.data && typeof body.data === "object") {
          return body.data as Record<string, unknown>;
        }
        if (body?.token_id != null || body?.agent_id != null || body?.name) return body;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

export async function buildAgentProfile(role: "buyer" | "seller"): Promise<AgentProfilePayload> {
  const base: AgentIdentityView = role === "buyer" ? getBuyerIdentity() : getSellerIdentity();
  const warnings: string[] = [];
  const scan = await fetchScanAgent(base.chainId, base.agentId);
  if (!scan) warnings.push("8004scan unreachable — showing env identity only");

  const scoresRaw = (scan?.scores as Record<string, unknown> | undefined) || {};
  const owner =
    (typeof scan?.owner_address === "string" && scan.owner_address) ||
    (typeof scan?.creator_address === "string" && scan.creator_address) ||
    null;
  // Prefer env commerce wallet (x402 payFrom / payTo) over indexer agent_wallet when set.
  const agentWallet =
    base.walletAddress ||
    (typeof scan?.agent_wallet === "string" && scan.agent_wallet) ||
    null;

  const links = [
    { label: "8004scan profile", url: base.scanUrl },
    {
      label: `${base.chainId === 84532 ? "Basescan" : "Etherscan"} NFT (on-chain ID)`,
      url: explorerNftUrl(base.chainId, base.identityRegistry, base.agentId),
    },
    {
      label: "Identity Registry contract",
      url: explorerAddressUrl(base.chainId, base.identityRegistry),
    },
  ];
  if (agentWallet) {
    links.push({
      label: "Agent wallet",
      url: explorerAddressUrl(
        role === "seller" ? config.seller.chainId : base.chainId,
        agentWallet,
      ),
    });
  }

  return {
    role,
    configured: true,
    name: (typeof scan?.name === "string" && scan.name) || base.name,
    agentId: base.agentId,
    chainId: base.chainId,
    chainLabel: base.chainLabel,
    globalId: base.globalId,
    scanUrl: base.scanUrl,
    ensip25Key: base.ensip25Key,
    source: scan ? "scan8004" : "env",
    sections: {
      identity: {
        agentId: base.agentId,
        chainLabel: base.chainLabel,
        globalId: base.globalId,
        owner,
        ownerShort: shortAddr(owner),
        agentWallet,
        agentWalletShort: shortAddr(agentWallet),
        x402Support: base.x402,
        trust: base.trust,
        ensip25Key: base.ensip25Key,
      },
      ranking: {
        rank: num(scan?.rank),
        networkRank: num(scan?.network_rank),
        healthScore: num(scan?.total_score) ?? num(scoresRaw.final_score) ?? num(scoresRaw.health_score),
        popularity: num(scoresRaw.popularity),
        freshness: num(scoresRaw.freshness),
        metadataCompleteness: num(scoresRaw.metadata_completeness),
        quality: num(scoresRaw.quality),
        activity: num(scoresRaw.activity),
      },
      feedback: {
        totalFeedbacks: num(scan?.total_feedbacks) ?? 0,
        averageScore: num(scan?.average_score),
        isVerified: Boolean(scan?.is_verified ?? scan?.is_endpoint_verified),
        starCount: num(scan?.star_count) ?? 0,
        watchCount: num(scan?.watch_count) ?? 0,
        ownerUsername:
          (typeof scan?.owner_username === "string" && scan.owner_username) ||
          (typeof scan?.publisher === "string" && scan.publisher) ||
          null,
      },
      verify: { links },
    },
    warnings,
  };
}
