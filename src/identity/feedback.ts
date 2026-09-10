/**
 * On-chain ERC-8004 reputation feedback (Sepolia Reputation Registry).
 * Buyer wallet rates the seller / Shopify agent after a purchase.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config, scan8004AgentUrl } from "../config/index.js";

const REPUTATION_REGISTRY = (process.env.ERC8004_REPUTATION_REGISTRY?.trim() ||
  "0x8004B663056A597Dffe9eCcC1965A193B7388713") as Address;

const reputationAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

const MIN_OPERABLE_ETH = 800_000_000_000_000n;
const FUNDER_RESERVE_ETH = 400_000_000_000_000n;
const DUST_ETH = 50_000_000_000_000n;

function pk(raw: string): Hex {
  const t = raw.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as Hex;
}

function clients() {
  const transport = http(config.rpc.sepolia);
  return {
    publicClient: createPublicClient({ chain: sepolia, transport }),
    transport,
  };
}

async function ethBalance(address: Address): Promise<bigint> {
  const { publicClient } = clients();
  return publicClient.getBalance({ address });
}

async function ensureBuyerGas() {
  const buyerPk = config.buyer.privateKey;
  const buyerAddr = config.buyer.walletAddress as Address;
  if (!buyerPk || !buyerAddr) throw new Error("BUYER_WALLET missing");

  const bal = await ethBalance(buyerAddr);
  if (bal >= MIN_OPERABLE_ETH) return null;

  const funders = [
    {
      name: "merchant1",
      privateKey: config.merchants.m1.privateKey,
      address: config.merchants.m1.address as Address,
    },
    {
      name: "shopify",
      privateKey: config.shopify.privateKey,
      address: config.shopify.walletAddress as Address,
    },
  ].filter((f) => f.privateKey && f.address);

  const need = MIN_OPERABLE_ETH - bal + 200_000_000_000_000n;
  for (const f of funders) {
    const fBal = await ethBalance(f.address);
    const available = fBal > FUNDER_RESERVE_ETH ? fBal - FUNDER_RESERVE_ETH : 0n;
    if (available < DUST_ETH) continue;
    const valueWei = available < need ? available : need;
    const account = privateKeyToAccount(pk(f.privateKey!));
    const { publicClient, transport } = clients();
    const wallet = createWalletClient({ account, chain: sepolia, transport });
    const hash = await wallet.sendTransaction({ to: buyerAddr, value: valueWei });
    await publicClient.waitForTransactionReceipt({ hash });
    return { from: f.name, hash, valueEth: formatEther(valueWei) };
  }

  throw new Error(
    `Buyer needs Sepolia ETH for ERC-8004 feedback (have ${formatEther(bal)}). Top up buyer or merchant1.`,
  );
}

export type FeedbackInput = {
  /** 1–5 stars */
  stars: number;
  title?: string;
  ensName?: string | null;
  /** Agent receiving feedback — defaults to seller / Shopify agent */
  agentId?: number;
};

export async function submitPurchaseFeedback(input: FeedbackInput) {
  const stars = Math.round(Number(input.stars));
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
    throw new Error("stars must be 1–5");
  }

  const buyerPk = config.buyer.privateKey;
  const buyerAddr = config.buyer.walletAddress as Address;
  if (!buyerPk || !buyerAddr) {
    throw new Error("BUYER_WALLET_PRIVATE_KEY / ADDRESS missing");
  }

  const agentId = BigInt(input.agentId ?? config.seller.agentId);
  const gas = await ensureBuyerGas();

  const account = privateKeyToAccount(pk(buyerPk));
  const { publicClient, transport } = clients();
  const wallet = createWalletClient({ account, chain: sepolia, transport });

  const tag1 = "stars";
  const tag2 = "worldcommerce";
  const endpoint = input.ensName || config.ens.shopifyAgentName || "agent.shopify.eth";
  const feedbackURI = "";
  const value = BigInt(stars); // int128 1–5
  const valueDecimals = 0;

  const hash = await wallet.writeContract({
    address: REPUTATION_REGISTRY,
    abi: reputationAbi,
    functionName: "giveFeedback",
    args: [
      agentId,
      value,
      valueDecimals,
      tag1,
      tag2,
      endpoint,
      feedbackURI,
      ZERO_HASH,
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  let summary: {
    count: string;
    summaryValue: string;
    summaryValueDecimals: number;
  } | null = null;
  try {
    const s = await publicClient.readContract({
      address: REPUTATION_REGISTRY,
      abi: reputationAbi,
      functionName: "getSummary",
      args: [agentId, [], tag1, tag2],
    });
    summary = {
      count: s[0].toString(),
      summaryValue: s[1].toString(),
      summaryValueDecimals: Number(s[2]),
    };
  } catch {
    /* indexer / view may lag */
  }

  return {
    ok: true,
    onChain: true,
    stars,
    agentId: Number(agentId),
    agentRole: "seller",
    agentName: config.seller.name,
    clientAddress: account.address,
    reputationRegistry: REPUTATION_REGISTRY,
    tag1,
    tag2,
    endpoint,
    title: input.title || null,
    ensName: input.ensName || null,
    hash,
    status: receipt.status,
    explorer: `${config.explorers.sepolia}/tx/${hash}`,
    scanUrl: scan8004AgentUrl(config.seller.chainId, Number(agentId)),
    gasBootstrap: gas,
    summary,
  };
}
