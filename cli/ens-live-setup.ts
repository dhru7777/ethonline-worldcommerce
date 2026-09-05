/**
 * Live ENSv2 setup: nested agent trees (buyer + seller) + EAC allow/deny.
 *
 *   npm run ens:live
 *
 * Requires registries already deployed (see cli/ens-deploy-trees.ts) and env:
 *   ENS_SHOPIFY_USER_REGISTRY, ENS_AGENT_SHOPIFY_REGISTRY,
 *   ENS_LINDT_COMMISSION_REGISTRY (optional), ENS_PERMISSIONED_RESOLVER,
 *   ENS_BUYER_USER_REGISTRY, ENS_AGENT_DHEERAJ_REGISTRY,
 *   ENS_BUYER_PERMISSIONED_RESOLVER
 */
import type { Address } from "viem";
import { config } from "../src/config/index.js";
import {
  buyerDeployerKey,
  demoEacAllowDeny,
  ensureDheerajResolver,
  ensureDheerajSubregistry,
  ensureShopifyResolver,
  ensureShopifySubregistry,
  liveAddresses,
  readEthResolver,
  readLabelResolver,
  readShopifySubregistry,
  registerLabelLive,
  setTextLive,
  shopifyDeployerKey,
  ZERO,
} from "../src/ens/liveRegistry.js";

const DEMO_MERCHANTS: { label: string; ownerEnv: "m1" | "m2" | "m3" }[] = [
  { label: "lindt", ownerEnv: "m1" },
  { label: "cocoa-house", ownerEnv: "m2" },
  { label: "sweet-factory", ownerEnv: "m3" },
];

const BUYER_AGENTS = ["intent", "guardrail", "payment", "feedback"] as const;

function merchantOwner(slot: "m1" | "m2" | "m3"): Address | null {
  const a = config.merchants[slot].address;
  return a ? (a as Address) : null;
}

async function main() {
  console.log("=== ENSv2 live setup (agent trees) ===\n");

  const addrs = liveAddresses();
  console.log("Shopify registry:       ", addrs.shopifyUserRegistry || "(missing)");
  console.log("Agent.shopify registry: ", addrs.agentShopifyRegistry || "(missing)");
  console.log("Lindt commission reg:   ", addrs.lindtCommissionRegistry || "(optional)");
  console.log("Seller resolver:        ", addrs.permissionedResolver || "(missing)");
  console.log("Buyer registry:         ", addrs.buyerUserRegistry || "(missing)");
  console.log("Agent.dheeraj registry: ", addrs.agentDheerajRegistry || "(missing)");
  console.log("Buyer resolver:         ", addrs.buyerPermissionedResolver || "(missing)");
  console.log("Write mode:             ", config.ens.writeMode);
  console.log("");

  if (!addrs.shopifyUserRegistry || !addrs.permissionedResolver) {
    throw new Error("Set ENS_SHOPIFY_USER_REGISTRY + ENS_PERMISSIONED_RESOLVER");
  }
  if (!shopifyDeployerKey()) {
    throw new Error("Missing SHOPIFY / ENS deployer key");
  }

  // —— Seller tree ——
  console.log("1) ensureShopifySubregistry…");
  const wire = await ensureShopifySubregistry();
  console.log(
    wire.alreadyWired
      ? `   already wired → ${wire.registry}`
      : `   setSubregistry tx ${wire.txHash}`,
  );
  console.log(`   getSubregistry("shopify") = ${await readShopifySubregistry()}`);

  console.log("1b) ensureShopifyResolver…");
  const shopRes = await ensureShopifyResolver();
  console.log(
    shopRes.alreadyWired
      ? `   already wired → ${shopRes.resolver}`
      : `   setResolver tx ${shopRes.txHash}`,
  );
  console.log(`   getResolver("shopify") = ${await readEthResolver("shopify")}\n`);

  console.log("1c) parent text records on shopify.eth…");
  try {
    for (const [key, value] of [
      ["url", "https://worldcommerce.local/shopify"],
      ["agent-context", "worldCommerce shopify merchant platform"],
      ["com.worldcommerce.version", "1"],
    ] as const) {
      const { txHash } = await setTextLive({
        ensName: "shopify.eth",
        key,
        value,
        privateKey: shopifyDeployerKey(),
        resolver: addrs.permissionedResolver,
      });
      console.log(`   shopify.eth ${key} tx ${txHash}`);
    }
  } catch (e) {
    console.log(`   shopify.eth texts: ${(e as Error).message?.slice(0, 160)}`);
  }

  if (addrs.agentShopifyRegistry && addrs.agentShopifyRegistry !== ZERO) {
    console.log("2) register agent.shopify.eth hub…");
    try {
      const { txHash } = await registerLabelLive({
        registry: addrs.shopifyUserRegistry,
        label: "agent",
        owner: (config.shopify.walletAddress || config.seller.payTo) as Address,
        subregistry: addrs.agentShopifyRegistry,
        resolver: addrs.permissionedResolver,
      });
      console.log(`   agent → subregistry ${addrs.agentShopifyRegistry}`);
      console.log(`   tx ${txHash}`);
    } catch (e) {
      console.log(`   agent hub: ${(e as Error).message?.slice(0, 160)}`);
    }
    try {
      for (const [key, value] of [
        ["url", "https://worldcommerce.local/shopify/agent"],
        ["agent-context", "worldCommerce shopify agent hub"],
        ["com.worldcommerce.version", "1"],
      ] as const) {
        const { txHash } = await setTextLive({
          ensName: "agent.shopify.eth",
          key,
          value,
          privateKey: shopifyDeployerKey(),
          resolver: addrs.permissionedResolver,
        });
        console.log(`   agent.shopify.eth ${key} tx ${txHash}`);
      }
    } catch (e) {
      console.log(`   agent.shopify texts: ${(e as Error).message?.slice(0, 160)}`);
    }

    console.log("\n3) register merchants under agent.shopify.eth…");
    for (const m of DEMO_MERCHANTS) {
      const owner = merchantOwner(m.ownerEnv);
      if (!owner) {
        console.log(`   skip ${m.label}`);
        continue;
      }
      const sub =
        m.label === "lindt" &&
        addrs.lindtCommissionRegistry &&
        addrs.lindtCommissionRegistry !== ZERO
          ? addrs.lindtCommissionRegistry
          : ZERO;
      try {
        const { txHash } = await registerLabelLive({
          registry: addrs.agentShopifyRegistry,
          label: m.label,
          owner,
          subregistry: sub,
          resolver: addrs.permissionedResolver,
        });
        console.log(`   ${m.label}.agent.shopify.eth → ${owner}`);
        console.log(`     tx ${txHash}`);
        await setTextLive({
          ensName: `${m.label}.agent.shopify.eth`,
          key: "com.worldcommerce.version",
          value: "1",
          privateKey: shopifyDeployerKey(),
        });
      } catch (e) {
        console.log(`   ${m.label}: ${(e as Error).message?.slice(0, 160)}`);
      }
    }

    if (addrs.lindtCommissionRegistry && addrs.lindtCommissionRegistry !== ZERO) {
      console.log("\n4) register commission.lindt.agent.shopify.eth…");
      try {
        const { txHash } = await registerLabelLive({
          registry: addrs.lindtCommissionRegistry,
          label: "commission",
          owner: (config.shopify.walletAddress || config.seller.payTo) as Address,
          resolver: addrs.permissionedResolver,
        });
        console.log(`   commission tx ${txHash}`);
        await setTextLive({
          ensName: "commission.lindt.agent.shopify.eth",
          key: "com.worldcommerce.commission",
          value: String(config.payment.commissionBps),
          privateKey: shopifyDeployerKey(),
        });
      } catch (e) {
        console.log(`   commission: ${(e as Error).message?.slice(0, 160)}`);
      }
    }

    const r = await readLabelResolver(addrs.agentShopifyRegistry, "lindt");
    console.log(`\n   getResolver(lindt) = ${r}`);
  } else {
    console.log("2–4) skip agent hub (ENS_AGENT_SHOPIFY_REGISTRY unset)\n");
  }

  console.log("\n5) EAC allow + deny (lindt.agent.shopify.eth)…");
  try {
    const eac = await demoEacAllowDeny({ ensName: "lindt.agent.shopify.eth" });
    console.log(`   ALLOW ${eac.allow.key} tx ${eac.allow.txHash}`);
    console.log(`   DENY  ${eac.deny.key} → ${eac.deny.revertReason}`);
  } catch (e) {
    console.log(`   EAC: ${(e as Error).message?.slice(0, 200)}`);
  }

  // —— Buyer tree ——
  if (
    addrs.buyerUserRegistry &&
    addrs.buyerUserRegistry !== ZERO &&
    buyerDeployerKey()
  ) {
    console.log("\n6) ensureDheerajSubregistry…");
    try {
      const w = await ensureDheerajSubregistry();
      console.log(
        w.alreadyWired
          ? `   already wired → ${w.registry}`
          : `   setSubregistry tx ${w.txHash}`,
      );
    } catch (e) {
      console.log(`   dheeraj wire: ${(e as Error).message?.slice(0, 200)}`);
    }

    console.log("\n6b) ensureDheerajResolver…");
    try {
      const wr = await ensureDheerajResolver();
      console.log(
        wr.alreadyWired
          ? `   already wired → ${wr.resolver}`
          : `   setResolver tx ${wr.txHash}`,
      );
      console.log(`   getResolver("dheeraj") = ${await readEthResolver("dheeraj")}`);
    } catch (e) {
      console.log(`   dheeraj resolver: ${(e as Error).message?.slice(0, 200)}`);
    }

    const buyerOwner = (config.buyer.walletAddress ||
      liveAddresses().buyerUserRegistry) as Address;
    const buyerResolver =
      addrs.buyerPermissionedResolver || addrs.permissionedResolver;

    console.log("\n6c) parent text records on dheeraj.eth…");
    try {
      const parentTexts: [string, string][] = [
        ["url", "https://worldcommerce.local/buyer"],
        ["description", "worldCommerce buyer ENS root (dheeraj.eth)"],
        ["agent-context", "worldCommerce buyer agent namespace"],
        ["com.worldcommerce.agents", "intent,guardrail,payment,feedback"],
        ["com.worldcommerce.agent.intent", "intent.agent.dheeraj.eth"],
        ["com.worldcommerce.agent.guardrail", "guardrail.agent.dheeraj.eth"],
        ["com.worldcommerce.agent.payment", "payment.agent.dheeraj.eth"],
        ["com.worldcommerce.agent.feedback", "feedback.agent.dheeraj.eth"],
      ];
      for (const [key, value] of parentTexts) {
        const { txHash } = await setTextLive({
          ensName: "dheeraj.eth",
          key,
          value,
          privateKey: buyerDeployerKey(),
          resolver: buyerResolver,
        });
        console.log(`   dheeraj.eth ${key} tx ${txHash}`);
      }
    } catch (e) {
      console.log(`   dheeraj.eth texts: ${(e as Error).message?.slice(0, 200)}`);
    }

    if (addrs.agentDheerajRegistry && addrs.agentDheerajRegistry !== ZERO) {
      console.log("\n7) register agent.dheeraj.eth + role agents…");
      try {
        await registerLabelLive({
          registry: addrs.buyerUserRegistry,
          label: "agent",
          owner: buyerOwner,
          subregistry: addrs.agentDheerajRegistry,
          resolver: buyerResolver,
          privateKey: buyerDeployerKey(),
        });
        console.log(`   agent.dheeraj.eth → ${addrs.agentDheerajRegistry}`);
      } catch (e) {
        console.log(`   agent hub: ${(e as Error).message?.slice(0, 160)}`);
      }
      try {
        await setTextLive({
          ensName: "agent.dheeraj.eth",
          key: "agent-context",
          value: "worldCommerce buyer agent hub",
          privateKey: buyerDeployerKey(),
          resolver: buyerResolver,
        });
      } catch (e) {
        console.log(`   agent.dheeraj text: ${(e as Error).message?.slice(0, 160)}`);
      }

      for (const role of BUYER_AGENTS) {
        try {
          const { txHash } = await registerLabelLive({
            registry: addrs.agentDheerajRegistry,
            label: role,
            owner: buyerOwner,
            resolver: buyerResolver,
            privateKey: buyerDeployerKey(),
          });
          console.log(`   ${role}.agent.dheeraj.eth tx ${txHash}`);
          await setTextLive({
            ensName: `${role}.agent.dheeraj.eth`,
            key: "agent-context",
            value: `worldCommerce buyer ${role} agent`,
            privateKey: buyerDeployerKey(),
            resolver: buyerResolver,
          });
          await setTextLive({
            ensName: `${role}.agent.dheeraj.eth`,
            key: "com.worldcommerce.role",
            value: role,
            privateKey: buyerDeployerKey(),
            resolver: buyerResolver,
          });
        } catch (e) {
          console.log(`   ${role}: ${(e as Error).message?.slice(0, 160)}`);
        }
      }
    }
  } else {
    console.log("\n6–7) skip buyer tree (buyer registry / key missing)");
  }

  console.log("\n=== done ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
