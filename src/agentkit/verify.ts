import { config } from "../config/index.js";

export type AgentVerification = {
  agentWallet: string;
  isHumanBacked: boolean;
  humanId: string | null;
  checkedAt: string;
  checkedVia: "agentkit-fetch" | "agentbook-direct-lookup" | "demo-assume" | "pending";
  chain: "world-chain";
  failureReason: string | null;
  capacityTier: "$100" | "$250" | "$500" | "manual-approval-required";
};

/**
 * World AgentKit / AgentBook human-backing check.
 * Live AgentBook when WORLD_AGENTKIT_RPC is set; otherwise demo assume from env
 * so capacity + payout gates still change real decisions.
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
    };
  }

  // Optional live lookup hook (World Chain) — soft-fail to demo assume.
  if (config.agentkit.rpcUrl) {
    try {
      // Placeholder for @worldcoin/agentkit AgentBook resolve when Sandbox wired.
      // Structure is intentional so swapping in the SDK is a one-file change.
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
        const body = (await res.json()) as { result?: boolean };
        if (typeof body.result === "boolean") {
          const ok = body.result;
          return {
            agentWallet: wallet,
            isHumanBacked: ok,
            humanId: ok ? "sandbox-human" : null,
            checkedAt,
            checkedVia: "agentbook-direct-lookup",
            chain: "world-chain",
            failureReason: ok ? null : "Not registered in AgentBook",
            capacityTier: ok ? "$250" : "manual-approval-required",
          };
        }
      }
    } catch {
      /* fall through to assume */
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
      : "AGENTKIT_ASSUME_HUMAN_BACKED=false — treat as bot / require HITL",
    capacityTier: assume ? "$250" : "manual-approval-required",
  };
}
