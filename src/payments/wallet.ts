import {
  createPublicClient,
  formatEther,
  formatUnits,
  http,
  type Address,
} from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { config } from "../config/index.js";

const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type WalletRole = "buyer" | "seller";

export type WalletView = {
  role: WalletRole;
  network: string;
  caip2: string;
  address: string | null;
  addressShort: string | null;
  explorer: string | null;
  usdcContract: string;
  balances: {
    ETH: { symbol: string; formatted: string; raw: string } | null;
    USDC: { symbol: string; formatted: string; raw: string } | null;
  };
  errors: string[];
};

function shortAddr(addr: string | null) {
  if (!addr) return null;
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function paymentNetwork(): "sepolia" | "base-sepolia" {
  return config.payment.chain === "base-sepolia" ? "base-sepolia" : "sepolia";
}

function explorerFor(network: "base-sepolia" | "sepolia", address: string) {
  if (network === "base-sepolia") return `${config.explorers.base}/address/${address}`;
  return `${config.explorers.sepolia}/address/${address}`;
}

function clientFor(network: "base-sepolia" | "sepolia") {
  if (network === "base-sepolia") {
    return createPublicClient({
      chain: baseSepolia,
      transport: http(config.rpc.baseSepolia),
    });
  }
  return createPublicClient({
    chain: sepolia,
    transport: http(config.rpc.sepolia),
  });
}

async function readBalances(address: Address, network: "base-sepolia" | "sepolia") {
  const client = clientFor(network);
  const usdcAddr = (
    network === "base-sepolia" ? config.usdcBaseSepolia : config.payment.usdc
  ) as Address;
  const errors: string[] = [];
  let eth: WalletView["balances"]["ETH"] = null;
  let usdc: WalletView["balances"]["USDC"] = null;

  try {
    const wei = await client.getBalance({ address });
    eth = { symbol: "ETH", formatted: formatEther(wei), raw: wei.toString() };
  } catch (e) {
    errors.push(`ETH: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const raw = await client.readContract({
      address: usdcAddr,
      abi: erc20BalanceOfAbi,
      functionName: "balanceOf",
      args: [address],
    });
    usdc = {
      symbol: "USDC",
      formatted: formatUnits(raw as bigint, 6),
      raw: (raw as bigint).toString(),
    };
  } catch (e) {
    errors.push(`USDC: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { eth, usdc, errors };
}

export async function buildWalletView(role: WalletRole): Promise<WalletView> {
  const address =
    (role === "buyer" ? config.buyer.walletAddress : config.seller.payTo) || null;
  const network = paymentNetwork();
  const caip2 = network === "sepolia" ? "eip155:11155111" : "eip155:84532";
  const usdcContract =
    network === "base-sepolia" ? config.usdcBaseSepolia : config.payment.usdc;
  const errors: string[] = [];

  if (!address) {
    return {
      role,
      network,
      caip2,
      address: null,
      addressShort: null,
      explorer: null,
      usdcContract,
      balances: { ETH: null, USDC: null },
      errors: [
        role === "buyer"
          ? "BUYER_WALLET_ADDRESS missing in .env"
          : "SELLER_PAYTO_ADDRESS missing in .env",
      ],
    };
  }

  const { eth, usdc, errors: balErrs } = await readBalances(address as Address, network);
  errors.push(...balErrs);

  return {
    role,
    network,
    caip2,
    address,
    addressShort: shortAddr(address),
    explorer: explorerFor(network, address),
    usdcContract,
    balances: { ETH: eth, USDC: usdc },
    errors,
  };
}
