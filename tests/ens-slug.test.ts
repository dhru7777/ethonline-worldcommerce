import { describe, expect, it } from "vitest";
import {
  ensureUniqueLabel,
  fullMerchantName,
  sequentialMerchantLabel,
  slugifyMerchantName,
} from "../src/ens/slug.js";
import { encodeErc7930EvmAddress, ensip25KeyForAgent } from "../src/ens/erc7930.js";
import { ensureMerchantNamespaces } from "../src/ens/agentNamespace.js";
import { parseSimpleIntent, searchFallback } from "../src/ucp/discover.js";

describe("merchant slugs", () => {
  it("slugifies shop names without hard-coding brands", () => {
    expect(slugifyMerchantName("Cocoa House")).toBe("cocoa-house");
    expect(slugifyMerchantName("Sweet Factory")).toBe("sweet-factory");
    expect(slugifyMerchantName("Nike Official Store")).toBe("nike");
  });

  it("dedupes colliding labels", () => {
    const taken = new Set(["cocoa-house"]);
    expect(ensureUniqueLabel("cocoa-house", taken)).toBe("cocoa-house-2");
  });

  it("supports sequential prod-style labels", () => {
    expect(sequentialMerchantLabel(1)).toBe("merchant1");
    expect(fullMerchantName("merchant1")).toBe("merchant1.shopify.eth");
  });
});

describe("ENSIP-25 / ERC-7930", () => {
  it("encodes chain into interoperable address so chains cannot collide", () => {
    const mainnet = encodeErc7930EvmAddress(
      1,
      "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    );
    const base = encodeErc7930EvmAddress(
      84532,
      "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    );
    expect(mainnet).not.toEqual(base);
    expect(
      ensip25KeyForAgent(1, "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", 167),
    ).toContain(mainnet);
  });
});

describe("search-driven namespaces", () => {
  it("only namespaces merchants from the chocolate search results", async () => {
    const parsed = parseSimpleIntent("chocolates under $10");
    const products = searchFallback(parsed, 8);
    const merchants = [...new Set(products.map((p) => p.merchantName))];
    expect(merchants.some((m) => /cocoa|sweet|bean/i.test(m))).toBe(true);
    expect(merchants.some((m) => /nike|adidas/i.test(m))).toBe(false);

    const namespaces = await ensureMerchantNamespaces({
      merchants: merchants.map((merchantName) => ({ merchantName })),
    });
    expect(namespaces.every((n) => n.ensName.endsWith(".shopify.eth"))).toBe(true);
    expect(namespaces.every((n) => n.textRecords["agent-context"])).toBe(true);
  });
});
