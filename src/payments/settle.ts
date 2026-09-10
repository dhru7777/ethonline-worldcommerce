import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  formatEther,
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

/** Enough Sepolia ETH for a couple of ERC-20 transfers. */
const MIN_OPERABLE_ETH = 800_000_000_000_000n; // 0.0008 ETH
/** Leave this on the funder so it can still send its own txs. */
const FUNDER_RESERVE_ETH = 400_000_000_000_000n; // 0.0004 ETH
const DUST_ETH = 50_000_000_000_000n; // 0.00005 ETH

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

type GasFunder = { name: string; privateKey: string; address: Address };

/**
 * Top up `to` with only what funders can spare (never a fixed 0.01 ETH).
 * Prefer merchant1 (usually has more Sepolia ETH) then Shopify.
 */
async function bootstrapGas(
  to: Address,
  label: string,
  funders: GasFunder[],
): Promise<Record<string, unknown> | null> {
  const bal = await ethBalance(to);
  if (bal >= MIN_OPERABLE_ETH) return null;

  const need = MIN_OPERABLE_ETH - bal + 200_000_000_000_000n;
  for (const f of funders) {
    if (f.address.toLowerCase() === to.toLowerCase()) continue;
    const fBal = await ethBalance(f.address);
    const available = fBal > FUNDER_RESERVE_ETH ? fBal - FUNDER_RESERVE_ETH : 0n;
    if (available < DUST_ETH) continue;
    const valueWei = available < need ? available : need;
    const hash = await sendEth({
      privateKey: f.privateKey,
      to,
      valueWei,
    });
    return {
      kind: "gas-bootstrap",
      to: label,
      from: f.name,
      hash,
      valueEth: formatEther(valueWei),
    };
  }

  throw new Error(
    `Settlement gas: ${label} has ${formatEther(bal)} ETH (need ~${formatEther(MIN_OPERABLE_ETH)}). ` +
      `Funder wallets are too low on Sepolia ETH to top up — add a little Sepolia ETH to Shopify or Merchant1.`,
  );
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
 * Gas bootstrap from Merchant1 / Shopify when needed (affordable amounts only).
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
  const funders: GasFunder[] = [
    { name: "merchant1", privateKey: m1Pk, address: m1Addr },
    { name: "shopify", privateKey: shopifyPk, address: shopifyAddr },
  ];

  const buyerGas = await bootstrapGas(buyerAddr, "buyer", funders);
  if (buyerGas) steps.push(buyerGas);
  const m1Gas = await bootstrapGas(m1Addr, "merchant1", funders);
  if (m1Gas) steps.push(m1Gas);

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
