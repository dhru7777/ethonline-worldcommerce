/**
 * World AgentKit / AgentBook human-backing check.
 *
 * Live path: `@worldcoin/agentkit` → `createAgentBookVerifier().lookupHuman(wallet)`
 * on World Chain AgentBook (no Sandbox required for *lookup*).
 *
 * Registration still needs a verified World ID human (Orb + production World App).
 * Sandbox cannot write AgentBook. When lookup returns null,
 * AGENTKIT_ASSUME_HUMAN_BACKED=true overlays a *labeled* mock so the demo can
 * show the commission-release path we built for a human-backed agent.
 */
import { createAgentBookVerifier } from "@worldcoin/agentkit";
import { config } from "../config/index.js";

export const AGENTBOOK_MOCK_HUMAN_ID = "demo-human-agentbook-mock";

export function demoHumanId(): string {
  const raw = (config.agentkit.mockHumanId || AGENTBOOK_MOCK_HUMAN_ID).trim();
  if (!raw) return AGENTBOOK_MOCK_HUMAN_ID;
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

export function demoWorldUsername(): string | null {
  const name = (config.worldId.username || "").trim();
  return name || null;
}

export const AGENTBOOK_MOCK_NOTE =
  "Live lookup ran on World Chain AgentBook; this wallet is unregistered (Sandbox cannot write). Demo mock treats the buyer as human-backed so commission can release — the product we considered here.";

export type AgentVerification = {
  agentWallet: string;
  isHumanBacked: boolean;
  humanId: string | null;
  /** Result of the live `lookupHuman` call, before any demo mock. */
  liveHumanId: string | null;
  mocked: boolean;
  mockNote: string | null;
  checkedAt: string;
  checkedVia:
    | "agentbook-live"
    | "agentbook-mock"
    | "agentkit-fetch"
    | "demo-assume"
    | "pending";
  chain: "world-chain";
  failureReason: string | null;
  capacityTier: "$100" | "$250" | "$500" | "manual-approval-required";
  agentBookContract: string;
  network: string;
  worldUsername?: string | null;
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

function emptyFields() {
  return {
    liveHumanId: null as string | null,
    mocked: false,
    mockNote: null as string | null,
  };
}

function mockOverlay(
  wallet: string,
  checkedAt: string,
  liveHumanId: string | null,
  extraNote?: string,
): AgentVerification {
  return {
    agentWallet: wallet,
    isHumanBacked: true,
    humanId: demoHumanId(),
    liveHumanId,
    mocked: true,
    mockNote: extraNote || AGENTBOOK_MOCK_NOTE,
    checkedAt,
    checkedVia: "agentbook-mock",
    chain: "world-chain",
    failureReason: null,
    capacityTier: tierForHuman(true),
    agentBookContract: AGENTBOOK.contract,
    network: AGENTBOOK.network,
    worldUsername: demoWorldUsername(),
  };
}

/**
 * Resolve whether `agentWallet` is registered in AgentBook as human-backed.
 * Always attempts live lookup unless AGENTKIT_FORCE_ASSUME=true.
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
      ...emptyFields(),
    };
  }

  let liveHumanId: string | null = null;
  let liveError: string | null = null;

  // Prefer live AgentBook (public World Chain) unless forced to demo-only.
  if (!config.agentkit.forceAssume) {
    try {
      const agentBook = createAgentBookVerifier();
      const humanId = await agentBook.lookupHuman(wallet as `0x${string}`);
      liveHumanId = humanId ? String(humanId) : null;
      if (liveHumanId) {
        return {
          agentWallet: wallet,
          isHumanBacked: true,
          humanId: liveHumanId,
          liveHumanId,
          mocked: false,
          mockNote: null,
          checkedAt,
          checkedVia: "agentbook-live",
          chain: "world-chain",
          failureReason: null,
          capacityTier: tierForHuman(true),
          agentBookContract: AGENTBOOK.contract,
          network: AGENTBOOK.network,
        };
      }

      if (!config.agentkit.assumeHumanBacked) {
        return {
          agentWallet: wallet,
          isHumanBacked: false,
          humanId: null,
          liveHumanId: null,
          mocked: false,
          mockNote: null,
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

      return mockOverlay(wallet, checkedAt, null);
    } catch (e) {
      liveError = e instanceof Error ? e.message : String(e);
      if (!config.agentkit.assumeHumanBacked) {
        return {
          agentWallet: wallet,
          isHumanBacked: false,
          humanId: null,
          liveHumanId: null,
          mocked: false,
          mockNote: null,
          checkedAt,
          checkedVia: "agentbook-live",
          chain: "world-chain",
          failureReason: `AgentBook lookup failed: ${liveError.slice(0, 200)}`,
          capacityTier: "manual-approval-required",
          agentBookContract: AGENTBOOK.contract,
          network: AGENTBOOK.network,
        };
      }
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
            liveHumanId,
            mocked: false,
            mockNote: null,
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

  if (config.agentkit.assumeHumanBacked) {
    const note = liveError
      ? `${AGENTBOOK_MOCK_NOTE} Live lookup error: ${liveError.slice(0, 120)}`
      : config.agentkit.forceAssume
        ? "AGENTKIT_FORCE_ASSUME=true skipped live lookup. Demo mock treats the buyer as human-backed."
        : AGENTBOOK_MOCK_NOTE;
    return mockOverlay(wallet, checkedAt, liveHumanId, note);
  }

  return {
    agentWallet: wallet,
    isHumanBacked: false,
    humanId: null,
    liveHumanId,
    mocked: false,
    mockNote: null,
    checkedAt,
    checkedVia: "demo-assume",
    chain: "world-chain",
    failureReason: "Not in AgentBook and AGENTKIT_ASSUME_HUMAN_BACKED=false",
    capacityTier: tierForHuman(false),
    agentBookContract: AGENTBOOK.contract,
    network: AGENTBOOK.network,
  };
}

export { AGENTBOOK };
