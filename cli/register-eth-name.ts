/**
 * Register a .eth label on the ETHOnline ENSv2 Sepolia deployment
 * via ETHRegistrar commit–reveal (skip the broken App/HCA quoter).
 *
 * Usage:
 *   npx tsx cli/register-eth-name.ts shopify
 *   npx tsx cli/register-eth-name.ts dheeraj --key buyer
 *   npx tsx cli/register-eth-name.ts shopify --key shopify --dry-run
 */
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config } from "../src/config/index.js";
import { hackathonSepolia } from "../src/ens/client.js";

const REGISTRAR = (config.ens.ethRegistrar ||
  "0x7d1b7f586a62ac3f54b9a396849757814283270b") as Address;
const MOCK_USDC = (config.payment.usdc ||
  "0xcbfd80f74375c54e545af34788ff465f96f66f05") as Address;
/** PublicResolverV2 — hackathon deployments table */
const PUBLIC_RESOLVER_V2 =
  "0xf9de4979ddb290baf5b760d0e788125017bc33f6" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ZERO32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

const registrarAbi = parseAbi([
  "function isAvailable(string label) view returns (bool)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
  "function MIN_COMMITMENT_AGE() view returns (uint256)",
  "function MIN_REGISTER_DURATION() view returns (uint64)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256 tokenId)",
  "function commitmentAt(bytes32 commitment) view returns (uint256)",
]);

const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);

function pk(raw: string): Hex {
  const t = raw.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as Hex;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv: string[]) {
  const label = (argv[2] || "").trim().toLowerCase().replace(/\.eth$/, "");
  const keyRole =
    argv.includes("--key") && argv[argv.indexOf("--key") + 1]
      ? argv[argv.indexOf("--key") + 1]
      : label === "dheeraj"
        ? "buyer"
        : "shopify";
  const dryRun = argv.includes("--dry-run");
  const years = Number(argv[argv.indexOf("--years") + 1] || 1);
  return { label, keyRole, dryRun, years: Number.isFinite(years) ? years : 1 };
}

function keyForRole(role: string) {
  if (role === "buyer") {
    return {
      privateKey: config.buyer.privateKey,
      address: config.buyer.walletAddress as Address,
    };
  }
  return {
    privateKey: config.shopify.privateKey || config.seller.privateKey,
    address: (config.shopify.walletAddress || config.seller.payTo) as Address,
  };
}

async function main() {
  const { label, keyRole, dryRun, years } = parseArgs(process.argv);
  if (!label || !/^[a-z0-9-]+$/.test(label)) {
    console.error("Usage: npx tsx cli/register-eth-name.ts <label> [--key buyer|shopify] [--years 1] [--dry-run]");
    process.exit(1);
  }

  const { privateKey, address: owner } = keyForRole(keyRole);
  if (!privateKey || !owner) {
    throw new Error(`Missing private key / address for role=${keyRole}`);
  }

  const account = privateKeyToAccount(pk(privateKey));
  if (account.address.toLowerCase() !== owner.toLowerCase()) {
    console.warn(
      `WARN: derived ${account.address} != configured ${owner} — using derived`,
    );
  }

  const transport = http(config.ens.rpc);
  const publicClient = createPublicClient({ chain: hackathonSepolia, transport });
  const wallet = createWalletClient({
    account,
    chain: hackathonSepolia,
    transport,
  });

  const duration = BigInt(Math.max(1, years)) * 31_536_000n; // seconds / year
  const secret = keccak256(toHex(`worldcommerce-${label}-${Date.now()}-${Math.random()}`));
  const subregistry = ZERO;
  const resolver = PUBLIC_RESOLVER_V2;
  const referrer = ZERO32;

  console.log(`ENSv2 direct register · ${label}.eth`);
  console.log(`  owner     ${account.address}`);
  console.log(`  registrar ${REGISTRAR}`);
  console.log(`  payment   MockUSDC ${MOCK_USDC}`);
  console.log(`  resolver  ${resolver}`);
  console.log(`  duration  ${years}y (${duration}s)`);
  console.log(`  mode      ${dryRun ? "dry-run" : "live"}`);

  const available = await publicClient.readContract({
    address: REGISTRAR,
    abi: registrarAbi,
    functionName: "isAvailable",
    args: [label],
  });
  if (!available) throw new Error(`${label}.eth is not available`);

  const [base, premium] = await publicClient.readContract({
    address: REGISTRAR,
    abi: registrarAbi,
    functionName: "getRegisterPrice",
    args: [label, duration, MOCK_USDC],
  });
  const total = base + premium;
  console.log(`  price     ${formatUnits(total, 6)} MockUSDC (base ${formatUnits(base, 6)} + premium ${formatUnits(premium, 6)})`);

  const minAge = await publicClient.readContract({
    address: REGISTRAR,
    abi: registrarAbi,
    functionName: "MIN_COMMITMENT_AGE",
  });

  const ethBal = await publicClient.getBalance({ address: account.address });
  let usdcBal = await publicClient.readContract({
    address: MOCK_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`  bal ETH   ${formatUnits(ethBal, 18)}`);
  console.log(`  bal USDC  ${formatUnits(usdcBal, 6)}`);

  if (dryRun) {
    console.log("dry-run complete — would mint/approve/commit/wait/register");
    return;
  }

  if (usdcBal < total) {
    const need = total - usdcBal + 10_000_000n; // +10 buffer
    console.log(`minting ${formatUnits(need, 6)} MockUSDC…`);
    const mintHash = await wallet.writeContract({
      address: MOCK_USDC,
      abi: mintAbi,
      functionName: "mint",
      args: [account.address, need],
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });
    console.log(`  mint tx ${mintHash}`);
    usdcBal = await publicClient.readContract({
      address: MOCK_USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });
  }

  console.log("approve MockUSDC → ETHRegistrar…");
  const approveHash = await wallet.writeContract({
    address: MOCK_USDC,
    abi: erc20Abi,
    functionName: "approve",
    args: [REGISTRAR, total],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log(`  approve tx ${approveHash}`);

  const commitment = await publicClient.readContract({
    address: REGISTRAR,
    abi: registrarAbi,
    functionName: "makeCommitment",
    args: [label, account.address, secret, subregistry, resolver, duration, referrer],
  });
  console.log(`commitment ${commitment}`);

  const commitHash = await wallet.writeContract({
    address: REGISTRAR,
    abi: registrarAbi,
    functionName: "commit",
    args: [commitment],
  });
  await publicClient.waitForTransactionReceipt({ hash: commitHash });
  console.log(`  commit tx ${commitHash}`);

  const waitMs = Number(minAge) * 1000 + 3000;
  console.log(`waiting MIN_COMMITMENT_AGE ${minAge}s…`);
  await sleep(waitMs);

  console.log("register…");
  const regHash = await wallet.writeContract({
    address: REGISTRAR,
    abi: registrarAbi,
    functionName: "register",
    args: [
      label,
      account.address,
      secret,
      subregistry,
      resolver,
      duration,
      MOCK_USDC,
      referrer,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: regHash });
  console.log(`  register tx ${regHash}`);
  console.log(`  status ${receipt.status}`);
  console.log(`✓ ${label}.eth registered to ${account.address}`);
  console.log(`  explorer https://sepolia.etherscan.io/tx/${regHash}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
