/**
 * World AgentKit / AgentBook human-backing check.
 *
 * Live path: `@worldcoin/agentkit` → `createAgentBookVerifier().lookupHuman(wallet)`
 * on World Chain AgentBook (no Sandbox required for *lookup*).
 *
 * Registration still needs a verified World ID human:
 *   npx @worldcoin/agentkit-cli register <BUYER_WALLET>
 *
 * Until the buyer wallet is registered, set AGENTKIT_ASSUME_HUMAN_BACKED=true
 * for demo allow, or false to exercise the deny / hold-commission path.
 */
import { createAgentBookVerifier } from "@worldcoin/agentkit";
import { config } from "../config/index.js";

export type AgentVerification = {
  agentWallet: string;
  isHumanBacked: boolean;
  humanId: string | null;
  checkedAt: string;
  checkedVia:
    | "agentbook-live"
    | "agentkit-fetch"
    | "demo-assume"
    | "pending";
  chain: "world-chain";
  failureReason: string | null;
  capacityTier: "$100" | "$250" | "$500" | "manual-approval-required";
  agentBookContract: string;
  network: string;
};

const AGENTBOOK = {
  contract: "0xA23aB2712eA7BBa896930544C7d6636a96b944dA",
  network: "eip155:480",
} as const;

function tierForHuman(ok: boolean): AgentVerification["capacityTier"] {
  if (!ok) return "manual-approval-required";
  const configured = config.agentkit.capacityTier;
  if (configured === "$100" || configured === "$250" || configured === "$500") {
    return configured;
  }
  return "$250";
}

/**
 * Resolve whether `agentWallet` is registered in AgentBook as human-backed.
 */
export async function verifyAgentHumanBacked(
  agentWallet?: string | null,
): Promise<AgentVerification> {
  const wallet = (agentWallet || config.buyer.walletAddress || "").trim();
  const checkedAt = new Date().toISOString();

  if (!wallet) {
    return {
      agentWallet: "",
      isHumanBacked: false,
      humanId: null,
      checkedAt,
      checkedVia: "pending",
      chain: "world-chain",
      failureReason: "No buyer wallet configured",
      capacityTier: "manual-approval-required",
      agentBookContract: AGENTBOOK.contract,
      network: AGENTBOOK.network,
    };
  }

  // Prefer live AgentBook (public World Chain) unless forced to demo-only.
  if (!config.agentkit.forceAssume) {
    try {
      const agentBook = createAgentBookVerifier();
      const humanId = await agentBook.lookupHuman(wallet as `0x${string}`);
      if (humanId) {
        return {
          agentWallet: wallet,
          isHumanBacked: true,
          humanId: String(humanId),
          checkedAt,
          checkedVia: "agentbook-live",
          chain: "world-chain",
          failureReason: null,
          capacityTier: tierForHuman(true),
          agentBookContract: AGENTBOOK.contract,
          network: AGENTBOOK.network,
        };
      }

      // Not registered — fall through to assume only if enabled.
      if (!config.agentkit.assumeHumanBacked) {
        return {
          agentWallet: wallet,
          isHumanBacked: false,
          humanId: null,
          checkedAt,
          checkedVia: "agentbook-live",
          chain: "world-chain",
          failureReason:
            "Wallet not registered in AgentBook — run: npm run agentkit:register",
          capacityTier: "manual-approval-required",
          agentBookContract: AGENTBOOK.contract,
          network: AGENTBOOK.network,
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!config.agentkit.assumeHumanBacked) {
        return {
          agentWallet: wallet,
          isHumanBacked: false,
          humanId: null,
          checkedAt,
          checkedVia: "agentbook-live",
          chain: "world-chain",
          failureReason: `AgentBook lookup failed: ${msg.slice(0, 200)}`,
          capacityTier: "manual-approval-required",
          agentBookContract: AGENTBOOK.contract,
          network: AGENTBOOK.network,
        };
      }
      // else fall through to demo assume
    }
  }

  // Optional custom RPC hook (Sandbox / future).
  if (config.agentkit.rpcUrl) {
    try {
      const res = await fetch(config.agentkit.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "agentbook_isHumanBacked",
          params: [wallet],
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body = (await res.json()) as { result?: boolean; humanId?: string };
        if (typeof body.result === "boolean") {
          const ok = body.result;
          return {
            agentWallet: wallet,
            isHumanBacked: ok,
            humanId: ok ? body.humanId || "sandbox-human" : null,
            checkedAt,
            checkedVia: "agentkit-fetch",
            chain: "world-chain",
            failureReason: ok ? null : "Not registered (sandbox RPC)",
            capacityTier: tierForHuman(ok),
            agentBookContract: AGENTBOOK.contract,
            network: AGENTBOOK.network,
          };
        }
      }
    } catch {
      /* fall through */
    }
  }

  const assume = config.agentkit.assumeHumanBacked;
  return {
    agentWallet: wallet,
    isHumanBacked: assume,
    humanId: assume ? "demo-human" : null,
    checkedAt,
    checkedVia: "demo-assume",
    chain: "world-chain",
    failureReason: assume
      ? null
      : "Not in AgentBook and AGENTKIT_ASSUME_HUMAN_BACKED=false",
    capacityTier: tierForHuman(assume),
    agentBookContract: AGENTBOOK.contract,
    network: AGENTBOOK.network,
  };
}

export { AGENTBOOK };
