import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config } from "../config/index.js";

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
]);

function pk(raw: string): Hex {
  const t = raw.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as Hex;
}

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function getMerchantAddresses() {
  return [
    config.merchants.m1.address,
    config.merchants.m2.address,
    config.merchants.m3.address,
  ].filter(Boolean) as Address[];
}

/** Map any selected offer index → merchant wallet (cycle). Commission always from m1. */
export function merchantPayToForOffer(appearOrder: number): Address {
  const list = getMerchantAddresses();
  if (!list.length) {
    throw new Error("No merchant addresses configured");
  }
  return list[appearOrder % list.length]!;
}

function clients() {
  const transport = http(config.rpc.sepolia);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  return { publicClient, transport };
}

async function sendUsdc(opts: {
  privateKey: string;
  to: Address;
  amountRaw: bigint;
  label: string;
}) {
  const account = privateKeyToAccount(pk(opts.privateKey));
  const { publicClient, transport } = clients();
  const wallet = createWalletClient({
    account,
    chain: sepolia,
    transport,
  });
  const usdc = config.payment.usdc as Address;
  const hash = await wallet.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "transfer",
    args: [opts.to, opts.amountRaw],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return {
    label: opts.label,
    hash,
    from: account.address,
    to: opts.to,
    amountRaw: opts.amountRaw.toString(),
    amountFormatted: formatUnits(opts.amountRaw, 6),
    status: receipt.status,
    explorer: `${config.explorers.sepolia}/tx/${hash}`,
  };
}

async function sendEth(opts: { privateKey: string; to: Address; valueWei: bigint }) {
  const account = privateKeyToAccount(pk(opts.privateKey));
  const { publicClient, transport } = clients();
  const wallet = createWalletClient({ account, chain: sepolia, transport });
  const hash = await wallet.sendTransaction({ to: opts.to, value: opts.valueWei });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function usdcBalance(address: Address): Promise<bigint> {
  const { publicClient } = clients();
  return publicClient.readContract({
    address: config.payment.usdc as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

async function ethBalance(address: Address): Promise<bigint> {
  const { publicClient } = clients();
  return publicClient.getBalance({ address });
}

export type SettleInput = {
  priceCents: number;
  merchantPayTo: Address;
  title: string;
  ensName?: string | null;
  humanBacked: boolean;
};

/**
 * Buyer pays full price USDC → selected merchant.
 * Commission always Merchant1 → buyer (demo mapping).
 * Gas bootstrap from Shopify wallet when needed.
 */
export async function settlePurchase(input: SettleInput) {
  const buyerPk = config.buyer.privateKey;
  const shopifyPk = config.shopify.privateKey;
  const m1Pk = config.merchants.m1.privateKey;
  const buyerAddr = config.buyer.walletAddress as Address;
  const m1Addr = config.merchants.m1.address as Address;
  const shopifyAddr = config.shopify.walletAddress as Address;

  if (!buyerPk || !buyerAddr) throw new Error("BUYER_WALLET_PRIVATE_KEY / ADDRESS missing");
  if (!m1Pk || !m1Addr) throw new Error("MERCHANT_1_PRIVATE_KEY / ADDRESS missing");
  if (!shopifyPk || !shopifyAddr) throw new Error("SHOPIFY_WALLET_PRIVATE_KEY / ADDRESS missing");

  const priceRaw = BigInt(Math.round(input.priceCents)) * 10_000n; // cents → 6 decimals USDC
  const commissionBps = BigInt(config.payment.commissionBps);
  const commissionRaw = (priceRaw * commissionBps) / 10_000n;
  const nhcRaw = priceRaw - commissionRaw;

  const steps: Array<Record<string, unknown>> = [];
  const MIN_GAS = 5_000_000_000_000_000n; // 0.005 ETH

  // Bootstrap gas for buyer + merchant1 from Shopify if needed
  if ((await ethBalance(buyerAddr)) < MIN_GAS) {
    const h = await sendEth({
      privateKey: shopifyPk,
      to: buyerAddr,
      valueWei: 10_000_000_000_000_000n, // 0.01
    });
    steps.push({ kind: "gas-bootstrap", to: "buyer", hash: h });
  }
  if ((await ethBalance(m1Addr)) < MIN_GAS) {
    const h = await sendEth({
      privateKey: shopifyPk,
      to: m1Addr,
      valueWei: 10_000_000_000_000_000n,
    });
    steps.push({ kind: "gas-bootstrap", to: "merchant1", hash: h });
  }

  // Ensure merchant1 can pay commission: top up from Shopify if short
  const m1Usdc = await usdcBalance(m1Addr);
  if (m1Usdc < commissionRaw) {
    const need = commissionRaw - m1Usdc;
    const fund = await sendUsdc({
      privateKey: shopifyPk,
      to: m1Addr,
      amountRaw: need,
      label: "shopify→merchant1 commission float",
    });
    steps.push(fund);
  }

  const buyerUsdc = await usdcBalance(buyerAddr);
  if (buyerUsdc < priceRaw) {
    throw new Error(
      `Buyer MockUSDC too low: have ${formatUnits(buyerUsdc, 6)}, need ${formatUnits(priceRaw, 6)}`,
    );
  }

  const pay = await sendUsdc({
    privateKey: buyerPk,
    to: input.merchantPayTo,
    amountRaw: priceRaw,
    label: "buyer→merchant purchase",
  });
  steps.push(pay);

  let commissionTx: Record<string, unknown> | null = null;
  let commissionAction: "release" | "hold" = "release";
  if (!input.humanBacked) {
    commissionAction = "hold";
    steps.push({
      kind: "commission-hold",
      reason: "AgentKit: buyer not human-backed",
    });
  } else if (commissionRaw > 0n) {
    commissionTx = await sendUsdc({
      privateKey: m1Pk,
      to: buyerAddr,
      amountRaw: commissionRaw,
      label: "merchant1→buyer commission",
    });
    steps.push(commissionTx);
  }

  return {
    chain: "sepolia",
    usdc: config.payment.usdc,
    title: input.title,
    ensName: input.ensName || null,
    priceFormatted: formatUnits(priceRaw, 6),
    commissionFormatted: formatUnits(commissionRaw, 6),
    nhcFormatted: formatUnits(nhcRaw, 6),
    commissionBps: Number(commissionBps),
    commissionAction,
    merchantPayTo: input.merchantPayTo,
    merchantPayToShort: short(input.merchantPayTo),
    buyer: buyerAddr,
    buyerShort: short(buyerAddr),
    merchant1: m1Addr,
    purchaseTx: pay,
    commissionTx,
    steps,
    explorers: {
      purchase: pay.explorer,
      commission: commissionTx?.explorer ?? null,
    },
  };
}
