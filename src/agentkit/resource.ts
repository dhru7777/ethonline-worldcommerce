/**
 * World AgentKit Steps 4–5 on our Node HTTP server (Hono is the docs sample, not required).
 *
 * Protected resource: GET /api/agentkit/data
 *   1. No `agentkit` header → 402 + declareAgentkitExtension challenge
 *   2. Signed header → createAgentkitHooks.requestHook
 *      - AgentBook lookupHuman
 *      - free-trial counter in InMemoryAgentKitStorage (3 uses / human)
 *   3. grantAccess → merchant-bid catalog JSON
 *   4. Else stay on 402 (not registered, trial exhausted, or bad signature)
 *
 * Shopping (/api/turn) stays public. Commission still uses lookup on /api/settle.
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
  AGENTKIT,
  createAgentBookVerifier,
  createAgentkitClient,
  createAgentkitHooks,
  declareAgentkitExtension,
  InMemoryAgentKitStorage,
  type AgentkitHookEvent,
} from "@worldcoin/agentkit";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config/index.js";
import { AGENTBOOK, demoHumanId } from "./verify.js";

const WORLD_CHAIN = "eip155:480";
const BASE = "eip155:8453";
const SEPOLIA = "eip155:11155111";
const NETWORKS = [WORLD_CHAIN, BASE, SEPOLIA] as const;

export const AGENTKIT_DATA_PATH = "/api/agentkit/data";
export const AGENTKIT_MODE = {
  type: "free-trial" as const,
  uses: config.agentkit.freeTrialUses,
};

const storage = new InMemoryAgentKitStorage();
const liveAgentBook = createAgentBookVerifier();

/** Live lookup first; labeled mock if AgentBook is empty (Sandbox cannot write). */
const agentBook = {
  async lookupHuman(address: string) {
    const id = await liveAgentBook.lookupHuman(address);
    if (id) return id;
    if (config.agentkit.assumeHumanBacked) return demoHumanId();
    return null;
  },
};

const recentEvents: AgentkitHookEvent[] = [];

const hooks = createAgentkitHooks({
  agentBook,
  storage,
  mode: AGENTKIT_MODE,
  onEvent: (event) => {
    recentEvents.push(event);
    if (recentEvents.length > 24) recentEvents.shift();
  },
});

function pk(raw: string) {
  const t = raw.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as `0x${string}`;
}

export function resourceUrlFromRequest(req: IncomingMessage, path = AGENTKIT_DATA_PATH) {
  const xfProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0]?.trim();
  const proto = xfProto || "http";
  const xfHost = String(req.headers["x-forwarded-host"] || "").split(",")[0]?.trim();
  const host = xfHost || String(req.headers.host || "localhost");
  return `${proto}://${host}${path}`;
}

function challengeExtension(resourceUri: string) {
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const declaration = declareAgentkitExtension({
    resourceUri,
    domain: new URL(resourceUri).hostname,
    statement: "Verify your agent is backed by a real human before reading merchant bids",
    network: [...NETWORKS],
    mode: AGENTKIT_MODE,
    version: "1",
  });
  const declared = declaration[AGENTKIT];
  return {
    info: {
      ...declared.info,
      domain: new URL(resourceUri).hostname,
      uri: resourceUri,
      resources: [resourceUri],
      version: declared.info.version || "1",
      nonce,
      issuedAt,
    },
    supportedChains: declared.supportedChains.length
      ? declared.supportedChains
      : NETWORKS.flatMap((network) => [
          { chainId: network, type: "eip191" as const },
          { chainId: network, type: "eip1271" as const },
        ]),
    schema: declared.schema,
    mode: AGENTKIT_MODE,
  };
}

export function paymentRequiredBody(resourceUri: string) {
  const payTo = config.agentkit.x402PayTo || "0x0000000000000000000000000000000000000000";
  return {
    x402Version: 1,
    error: "Payment required — or present a human-backed AgentKit header (free-trial)",
    accepts: [
      {
        scheme: "exact",
        price: "$0.01",
        network: WORLD_CHAIN,
        payTo,
        asset: config.agentkit.worldUsdc,
      },
      {
        scheme: "exact",
        price: "$0.01",
        network: BASE,
        payTo,
      },
    ],
    extensions: {
      [AGENTKIT]: challengeExtension(resourceUri),
    },
  };
}

export async function runRequestHook(opts: {
  agentkitHeader?: string;
  resourceUri: string;
  path?: string;
}) {
  return hooks.requestHook({
    adapter: {
      getHeader: (name: string) => {
        if (name.toLowerCase() === AGENTKIT) return opts.agentkitHeader;
        return undefined;
      },
      getUrl: () => opts.resourceUri,
    },
    path: opts.path || AGENTKIT_DATA_PATH,
  });
}

export function catalogPayload(granted: boolean) {
  return {
    ok: granted,
    message: granted
      ? "Protected merchant-bid catalog (AgentKit free-trial)"
      : "Not granted",
    mode: AGENTKIT_MODE,
    agentBook: AGENTBOOK,
    bids: granted
      ? [
          {
            role: "merchant-commission",
            bps: config.payment.commissionBps,
            note: "Human-backed buyer agents may receive this bid at settle; bots hold.",
          },
        ]
      : [],
  };
}

export async function handleProtectedData(req: IncomingMessage) {
  const resourceUri = resourceUrlFromRequest(req);
  const header =
    (typeof req.headers[AGENTKIT] === "string" ? req.headers[AGENTKIT] : undefined) ||
    (typeof req.headers["agentkit"] === "string" ? req.headers["agentkit"] : undefined);

  if (header) {
    const granted = await runRequestHook({
      agentkitHeader: header,
      resourceUri,
    });
    if (granted?.grantAccess) {
      return { status: 200 as const, body: catalogPayload(true) };
    }
  }

  return { status: 402 as const, body: paymentRequiredBody(resourceUri) };
}

/**
 * Buyer agent (server-side) runs World's Step 3: createAgentkitClient + signed header
 * against the same challenge the 402 resource would issue, then Step 4 requestHook.
 */
export async function probeBuyerAgentAccess(req: IncomingMessage) {
  const resourceUri = resourceUrlFromRequest(req);
  const buyerPk = config.buyer.privateKey;
  const buyerAddr = config.buyer.walletAddress;
  const eventsBefore = recentEvents.length;

  if (!buyerPk || !buyerAddr) {
    return {
      ok: false,
      granted: false,
      reason: "BUYER_WALLET_PRIVATE_KEY / ADDRESS missing — cannot sign AgentKit header",
      mode: AGENTKIT_MODE,
      resourceUri,
      events: [] as AgentkitHookEvent[],
    };
  }

  const account = privateKeyToAccount(pk(buyerPk));
  const client = createAgentkitClient({
    signer: {
      address: account.address,
      chainId: config.agentkit.signerChainId,
      type: "eip191",
      signMessage: (message) => account.signMessage({ message }),
    },
  });

  const extension = challengeExtension(resourceUri);
  let header: string;
  try {
    header = await client.createHeader(extension);
  } catch (err) {
    return {
      ok: false,
      granted: false,
      reason: err instanceof Error ? err.message : String(err),
      mode: AGENTKIT_MODE,
      resourceUri,
      signer: { address: account.address, chainId: config.agentkit.signerChainId },
      events: [] as AgentkitHookEvent[],
    };
  }

  const granted = await runRequestHook({
    agentkitHeader: header,
    resourceUri,
  });
  const events = recentEvents.slice(eventsBefore);

  return {
    ok: Boolean(granted?.grantAccess),
    granted: Boolean(granted?.grantAccess),
    reason: granted?.grantAccess
      ? config.agentkit.assumeHumanBacked
        ? `free-trial grant (${AGENTKIT_MODE.uses} uses / human) · AgentBook mock if live lookup is empty`
        : `free-trial grant (${AGENTKIT_MODE.uses} uses / human)`
      : "AgentBook miss, trial exhausted, or signature/network mismatch — 402 fallback",
    mocked: Boolean(config.agentkit.assumeHumanBacked),
    mode: AGENTKIT_MODE,
    resourceUri,
    signer: { address: account.address, chainId: config.agentkit.signerChainId },
    agentBook: AGENTBOOK,
    catalog: granted?.grantAccess ? catalogPayload(true) : paymentRequiredBody(resourceUri),
    events,
    step: {
      client: "createAgentkitClient.createHeader (Step 3)",
      server: "createAgentkitHooks.requestHook + InMemoryAgentKitStorage (Steps 4–5)",
    },
  };
}

export function agentkitResourceHealth() {
  return {
    resource: AGENTKIT_DATA_PATH,
    mode: AGENTKIT_MODE,
    storage: "InMemoryAgentKitStorage",
    networks: [...NETWORKS],
    facilitator: config.agentkit.x402FacilitatorUrl,
  };
}
