/**
 * Redeploy explorer-compatible registries + resolvers for agent trees.
 *
 *   npm run ens:deploy
 *
 * Deploys a fresh ShopifyUserRegistry root for shopify.eth and dheeraj.eth
 * (with ownerOf/getStatus + official LabelRegistered events), then nested hubs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config, ROOT } from "../src/config/index.js";
import { hackathonSepolia } from "../src/ens/client.js";

function loadArtifact(name: string) {
  const path = join(ROOT, "ens-contracts/out", `${name}.sol`, `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as {
    abi: unknown[];
    bytecode: { object: Hex };
  };
}

function pk(raw: string): Hex {
  const t = raw.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as Hex;
}

async function deploy(
  name: string,
  args: unknown[],
  privateKey: string,
): Promise<`0x${string}`> {
  const art = loadArtifact(name);
  const account = privateKeyToAccount(pk(privateKey));
  const transport = http(config.ens.rpc);
  const publicClient = createPublicClient({
    chain: hackathonSepolia,
    transport,
  });
  const wallet = createWalletClient({
    account,
    chain: hackathonSepolia,
    transport,
  });
  const hash = await wallet.deployContract({
    abi: art.abi as never,
    bytecode: art.bytecode.object,
    args: args as never,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error(`${name} deploy failed ${hash}`);
  }
  console.log(`${name} → ${receipt.contractAddress}  tx ${hash}`);
  return receipt.contractAddress;
}

async function main() {
  const shopifyPk = config.shopify.privateKey || config.ens.deployerPrivateKey;
  const buyerPk = config.buyer.privateKey;
  if (!shopifyPk) throw new Error("SHOPIFY_WALLET_PRIVATE_KEY required");
  if (!buyerPk) throw new Error("BUYER_WALLET_PRIVATE_KEY required");

  const shopify = (config.shopify.walletAddress ||
    privateKeyToAccount(pk(shopifyPk)).address) as `0x${string}`;
  const buyer = (config.buyer.walletAddress ||
    privateKeyToAccount(pk(buyerPk)).address) as `0x${string}`;
  const eth = config.ens.ethRegistry as `0x${string}`;

  console.log("=== redeploy explorer-compatible registries ===\n");
  console.log("shopify admin", shopify);
  console.log("buyer admin  ", buyer);
  console.log("");

  // Seller stack
  const sellerResolver = await deploy(
    "PermissionedCommerceResolver",
    [shopify],
    shopifyPk,
  );
  const shopifyRoot = await deploy(
    "ShopifyUserRegistry",
    [shopify, eth, "shopify"],
    shopifyPk,
  );
  const agentShopify = await deploy(
    "ShopifyUserRegistry",
    [shopify, shopifyRoot, "agent"],
    shopifyPk,
  );
  const lindtCommission = await deploy(
    "ShopifyUserRegistry",
    [shopify, agentShopify, "lindt"],
    shopifyPk,
  );

  // Buyer stack
  const buyerResolver = await deploy(
    "PermissionedCommerceResolver",
    [buyer],
    buyerPk,
  );
  const buyerRoot = await deploy(
    "ShopifyUserRegistry",
    [buyer, eth, "dheeraj"],
    buyerPk,
  );
  const agentDheeraj = await deploy(
    "ShopifyUserRegistry",
    [buyer, buyerRoot, "agent"],
    buyerPk,
  );

  console.log("\n=== paste into .env ===\n");
  console.log(`ENS_SHOPIFY_USER_REGISTRY=${shopifyRoot}`);
  console.log(`ENS_PERMISSIONED_RESOLVER=${sellerResolver}`);
  console.log(`ENS_AGENT_SHOPIFY_REGISTRY=${agentShopify}`);
  console.log(`ENS_LINDT_COMMISSION_REGISTRY=${lindtCommission}`);
  console.log(`ENS_BUYER_USER_REGISTRY=${buyerRoot}`);
  console.log(`ENS_AGENT_DHEERAJ_REGISTRY=${agentDheeraj}`);
  console.log(`ENS_BUYER_PERMISSIONED_RESOLVER=${buyerResolver}`);
  console.log(`ENS_BUYER_NAME=agent.dheeraj.eth`);
  console.log(`ENS_SHOPIFY_AGENT_NAME=agent.shopify.eth`);
  console.log("\nThen: npm run ens:live");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
