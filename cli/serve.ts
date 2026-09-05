import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { config, ROOT } from "../src/config/index.js";
import { getIdentities } from "../src/identity/agents.js";
import { buildAgentProfile } from "../src/identity/scan8004.js";
import { buildWalletView } from "../src/payments/wallet.js";
import {
  ensureMerchantNamespaces,
  getNamespaceTree,
} from "../src/ens/agentNamespace.js";
import { discoverProducts, parseSimpleIntent, type ParsedIntent } from "../src/ucp/discover.js";
import { captureTurn } from "../src/intent/capture.js";
import { verifyAgentHumanBacked } from "../src/agentkit/verify.js";
import { merchantPayToForOffer, settlePurchase } from "../src/payments/settle.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

async function readJson(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
  type = "application/json",
) {
  let payload: string | Buffer;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    payload = Buffer.from(body);
  } else if (typeof body === "string") {
    payload = body;
  } else {
    payload = JSON.stringify(body, null, 2);
  }
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    if (path === "/api/health") {
      send(res, 200, {
        ok: true,
        ens: {
          root: `${config.ens.rootLabel}.eth`,
          writeMode: config.ens.writeMode,
          lazyCreate: config.ens.lazyCreate,
          deployment: "ethonline-sepolia-hackathon",
          ethRegistry: config.ens.ethRegistry,
          universalResolverProxy: config.ens.universalResolverProxy,
          docs: config.ens.docs,
        },
        identities: getIdentities(),
        payment: {
          chain: config.payment.chain,
          usdc: config.payment.usdc,
          commissionBps: config.payment.commissionBps,
        },
        agentkit: {
          assumeHumanBacked: config.agentkit.assumeHumanBacked,
        },
      });
      return;
    }

    if (path === "/api/identities") {
      send(res, 200, getIdentities());
      return;
    }

    const agentMatch = path.match(/^\/api\/agent\/(buyer|seller)$/);
    if (agentMatch && req.method === "GET") {
      const role = agentMatch[1] as "buyer" | "seller";
      send(res, 200, await buildAgentProfile(role));
      return;
    }

    const walletMatch = path.match(/^\/api\/wallet\/(buyer|seller)$/);
    if (walletMatch && req.method === "GET") {
      const role = walletMatch[1] as "buyer" | "seller";
      send(res, 200, await buildWalletView(role));
      return;
    }

    if (path === "/api/agentkit/verify" && req.method === "GET") {
      send(res, 200, await verifyAgentHumanBacked(url.searchParams.get("wallet")));
      return;
    }

    if (path === "/api/settle" && req.method === "POST") {
      const body = (await readJson(req)) as {
        priceCents?: number;
        title?: string;
        ensName?: string;
        merchantPayTo?: string;
        appearOrder?: number;
      };
      const priceCents = Number(body.priceCents);
      if (!Number.isFinite(priceCents) || priceCents <= 0) {
        send(res, 400, { error: "priceCents required" });
        return;
      }
      const verification = await verifyAgentHumanBacked(config.buyer.walletAddress);
      let merchantPayTo = body.merchantPayTo as `0x${string}` | undefined;
      if (!merchantPayTo) {
        merchantPayTo = merchantPayToForOffer(Number(body.appearOrder) || 0);
      }
      try {
        const result = await settlePurchase({
          priceCents,
          merchantPayTo,
          title: body.title || "Purchase",
          ensName: body.ensName,
          humanBacked: verification.isHumanBacked,
        });
        send(res, 200, { ok: true, verification, settlement: result });
      } catch (err) {
        send(res, 500, {
          error: err instanceof Error ? err.message : String(err),
          verification,
        });
      }
      return;
    }

    if (path === "/api/ens/tree") {
      send(res, 200, getNamespaceTree());
      return;
    }

    async function attachEnsOffers(parsed: ParsedIntent, sequentialLabels = false) {
      const { products, source } = await discoverProducts(parsed, 8);
      const merchantNames = [
        ...new Set(products.map((p) => p.merchantName).filter(Boolean)),
      ];
      const namespaces = config.ens.lazyCreate
        ? await ensureMerchantNamespaces({
            merchants: merchantNames.map((merchantName) => ({ merchantName })),
            sequentialLabels,
          })
        : [];
      const byMerchant = new Map(
        namespaces.map((n) => [n.merchantName.toLowerCase(), n]),
      );
      const offers = products.map((p, i) => {
        const ns = byMerchant.get(p.merchantName.toLowerCase());
        let merchantPayTo: string | null = null;
        try {
          merchantPayTo = merchantPayToForOffer(i);
        } catch {
          merchantPayTo = config.merchants.m1.address || null;
        }
        return {
          ...p,
          appearOrder: i,
          merchantPayTo,
          ens: ns
            ? {
                ensName: ns.ensName,
                label: ns.label,
                parentName: ns.parentName,
                writeMode: ns.writeMode,
                permissionsNote: ns.permissionsNote,
                textRecords: ns.textRecords,
              }
            : null,
        };
      });
      return {
        source,
        rootNamespace: `${config.ens.rootLabel}.eth`,
        merchants: namespaces,
        offers,
      };
    }

    if (path === "/api/turn" && req.method === "POST") {
      const body = (await readJson(req)) as {
        prompt?: string;
        sessionId?: string;
        sequentialLabels?: boolean;
        limit?: number;
      };
      const prompt = (body.prompt || "").trim();
      if (!prompt) {
        send(res, 400, { error: "prompt required" });
        return;
      }

      const turn = await captureTurn({
        sessionId: body.sessionId,
        prompt,
      });

      if (!turn.ready) {
        send(res, 200, {
          ...turn,
          offers: [],
          merchants: [],
          buyer: getIdentities().buyer,
          seller: getIdentities().seller,
        });
        return;
      }

      const parsed: ParsedIntent = {
        query: turn.parsed.query,
        intent: turn.parsed.intent,
        maxPriceCents: turn.parsed.maxPriceCents,
        shipTo: turn.parsed.shipTo,
      };
      const discovery = await attachEnsOffers(parsed, Boolean(body.sequentialLabels));
      send(res, 200, {
        ...turn,
        ...discovery,
        buyer: getIdentities().buyer,
        seller: getIdentities().seller,
      });
      return;
    }

    if (path === "/api/discover" && req.method === "POST") {
      const body = (await readJson(req)) as {
        text?: string;
        sequentialLabels?: boolean;
      };
      const text = (body.text || "").trim();
      if (!text) {
        send(res, 400, { error: "text required" });
        return;
      }

      const parsed = parseSimpleIntent(text);
      const discovery = await attachEnsOffers(parsed, Boolean(body.sequentialLabels));
      send(res, 200, {
        query: parsed,
        ...discovery,
        buyer: getIdentities().buyer,
        seller: getIdentities().seller,
      });
      return;
    }

    // Static UI
    let filePath = path === "/" ? "/index.html" : path;
    const abs = join(ROOT, "ui", filePath);
    if (!abs.startsWith(join(ROOT, "ui")) || !existsSync(abs)) {
      send(res, 404, { error: "not found" });
      return;
    }
    const ext = extname(abs);
    send(res, 200, readFileSync(abs), MIME[ext] || "application/octet-stream");
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(config.port, () => {
  console.log(`worldCommerce demo http://localhost:${config.port}`);
  console.log(`  ENS root: ${config.ens.rootLabel}.eth (${config.ens.writeMode})`);
  console.log(`  Buyer #${config.buyer.agentId} · Seller #${config.seller.agentId}`);
});
