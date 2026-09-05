import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function loadDotenv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (val.startsWith("$") && process.env[val.slice(1)] !== undefined) {
      val = process.env[val.slice(1)]!;
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotenv(join(ROOT, ".env"));
loadDotenv(join(ROOT, "local.env"));

function env(name: string, fallback = ""): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: envInt("PORT", 5190),
  buyer: {
    agentId: envInt("BUYER_AGENT_ID", 9638),
    name: env("BUYER_AGENT_NAME", "craidt-buyer-agent"),
    chainId: envInt("BUYER_CHAIN_ID", 11155111),
    identityRegistry: env(
      "BUYER_IDENTITY_REGISTRY",
      "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    ),
    walletAddress: env("BUYER_WALLET_ADDRESS"),
    privateKey: env("BUYER_WALLET_PRIVATE_KEY"),
  },
  seller: {
    agentId: envInt("SELLER_AGENT_ID", 6832),
    name: env("SELLER_AGENT_NAME", "shopify-commerce-agent"),
    chainId: envInt("SELLER_CHAIN_ID", 84532),
    identityRegistry: env(
      "SELLER_IDENTITY_REGISTRY",
      "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    ),
    payTo: env("SELLER_PAYTO_ADDRESS", env("SHOPIFY_WALLET_ADDRESS")),
    serviceUrl: env("SELLER_SERVICE_URL"),
    privateKey: env("SELLER_WALLET_PRIVATE_KEY", env("SHOPIFY_WALLET_PRIVATE_KEY")),
  },
  shopify: {
    walletAddress: env("SHOPIFY_WALLET_ADDRESS", env("SELLER_PAYTO_ADDRESS")),
    privateKey: env("SHOPIFY_WALLET_PRIVATE_KEY", env("SELLER_WALLET_PRIVATE_KEY")),
  },
  merchants: {
    m1: {
      address: env("MERCHANT_1_ADDRESS"),
      privateKey: env("MERCHANT_1_PRIVATE_KEY"),
    },
    m2: {
      address: env("MERCHANT_2_ADDRESS"),
      privateKey: env("MERCHANT_2_PRIVATE_KEY"),
    },
    m3: {
      address: env("MERCHANT_3_ADDRESS"),
      privateKey: env("MERCHANT_3_PRIVATE_KEY"),
    },
  },
  payment: {
    chain: env("PAYMENT_CHAIN", "sepolia"),
    usdc: env(
      "PAYMENT_USDC",
      env("USDC_SEPOLIA", "0xcbfd80f74375c54e545af34788ff465f96f66f05"),
    ),
    commissionBps: envInt("COMMISSION_BPS", 170),
  },
  agentkit: {
    assumeHumanBacked: env("AGENTKIT_ASSUME_HUMAN_BACKED", "true").toLowerCase() !== "false",
    rpcUrl: env("WORLD_AGENTKIT_RPC"),
  },
  explorers: {
    sepolia: env("EXPLORER_SEPOLIA_URL", "https://sepolia.etherscan.io"),
    base: env("EXPLORER_BASE_URL", "https://sepolia.basescan.org"),
  },
  rpc: {
    sepolia: env("SEPOLIA_RPC", "https://ethereum-sepolia-rpc.publicnode.com"),
    baseSepolia: env("BASE_SEPOLIA_RPC", "https://sepolia.base.org"),
  },
  usdcBaseSepolia: env(
    "USDC_BASE_SEPOLIA",
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  ),
  x402: {
    network: env("X402_NETWORK", "eip155:84532"),
    facilitatorUrl: env("X402_FACILITATOR_URL", "https://x402.org/facilitator"),
  },
  scan8004: {
    apiBase: env("SCAN8004_API_BASE", "https://testnet.8004scan.io/api/v1"),
    webBase: env("SCAN8004_WEB_BASE", "https://testnet.8004scan.io"),
    apiKey: env("SCAN8004_API_KEY"),
  },
  etherscanApiKey: env("ETHERSCAN_API_KEY"),
  ens: {
    chainId: envInt("ENS_CHAIN_ID", 11155111),
    rpc: env("ENS_RPC", env("SEPOLIA_RPC", "https://ethereum-sepolia-rpc.publicnode.com")),
    /** ETHOnline ENSv2 Sepolia hackathon deployment — NOT production docs addresses. */
    ethRegistry: env(
      "ENS_ETH_REGISTRY",
      "0x1d78834d97c1d7b1a38c1dedbd1a287cfed3971e",
    ),
    ethRegistrar: env(
      "ENS_ETH_REGISTRAR",
      "0x7d1b7f586a62ac3f54b9a396849757814283270b",
    ),
    rootRegistry: env(
      "ENS_ROOT_REGISTRY",
      "0xe7f0d5724f8337e3aa9a9910540341ff4273fed9",
    ),
    verifiableFactory: env(
      "ENS_VERIFIABLE_FACTORY",
      "0x894bc9cc8ff1ad96b8a288c86a8c71d662c07780",
    ),
    userRegistryImpl: env(
      "ENS_USER_REGISTRY_IMPL",
      "0x47b442d0cf617c41cabaff5f02f44dd1e5f72546",
    ),
    permissionedResolverImpl: env(
      "ENS_PERMISSIONED_RESOLVER_IMPL",
      "0xa9d3814ab151bf6e37a427432795371a8361614e",
    ),
    universalResolverV2: env(
      "ENS_UNIVERSAL_RESOLVER_V2",
      "0xfea8d4b7fcce0b8765c793d6695eac384aaa458f",
    ),
    /** Override viem/ethers built-in UR with this proxy or resolution hits the wrong deployment. */
    universalResolverProxy: env(
      "ENS_UNIVERSAL_RESOLVER_PROXY",
      "0xd26f2040d083af1cd2962ba303f4bea0c4faf142",
    ),
    deployerPrivateKey: env("ENS_DEPLOYER_PRIVATE_KEY"),
    rootLabel: env("ENS_ROOT_LABEL", "shopify"),
    lazyCreate: env("ENS_LAZY_CREATE", "true").toLowerCase() !== "false",
    writeMode: (env("ENS_WRITE_MODE", "dry-run") === "live" ? "live" : "dry-run") as
      | "live"
      | "dry-run",
    docs: {
      deployments:
        "https://feature-permres-inode-refact.docs-bao.pages.dev/learn/deployments#sepolia-ensv2-beta",
      overview: "https://feature-permres-inode-refact.docs-bao.pages.dev/ensv2/overview",
      explorer: "https://hackathon-deployment-portal-app.ens-cf.workers.dev/",
      app: "https://hackathon-deployment-manager-app-v4.ens-cf.workers.dev/",
    },
  },
  openai: {
    apiKey: env("OPENAI_API_KEY"),
    model: env("OPENAI_MODEL", "gpt-4o-mini"),
  },
};

export function agentRegistryCaip(chainId: number, registry: string): string {
  const reg = registry.toLowerCase().startsWith("0x")
    ? registry.toLowerCase()
    : `0x${registry.toLowerCase()}`;
  return `eip155:${chainId}:${reg}`;
}

export function scan8004ChainSlug(chainId: number): string {
  const slugs: Record<number, string> = {
    84532: "base-sepolia",
    8453: "base",
    11155111: "sepolia",
    1: "ethereum",
  };
  return slugs[chainId] ?? String(chainId);
}

export function scan8004AgentUrl(chainId: number, agentId: number): string {
  return `${config.scan8004.webBase}/agents/${scan8004ChainSlug(chainId)}/${agentId}`;
}
