/**
 * Live ENSv2 writes: nested ShopifyUserRegistry + PermissionedCommerceResolver.
 * Hackathon UserRegistryImpl has no initialize — we use ens-contracts instead.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  stringToBytes,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config/index.js";
import { hackathonSepolia } from "./client.js";

export const SHOPIFY_TOKEN_ID =
  "0x7130dc788d54626f0aeedd77d1a5c4e65f76f26aaffe6661d167d5f200000000" as Hex;
export const DHEERAJ_TOKEN_ID =
  "0xcd5fae7676938db416d19dc360e966cebc4d90aa9cfe2c938122510800000000" as Hex;

const ethRegistryAbi = parseAbi([
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function setSubregistry(uint256 tokenId, address registry)",
  "function setResolver(uint256 tokenId, address resolver)",
]);

const userRegistryAbi = parseAbi([
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function getOwner(string label) view returns (address)",
  "function getParent() view returns (address parent, string label)",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "event LabelRegistered(string label, address owner, address resolver)",
]);

const resolverAbi = parseAbi([
  "function setText(bytes dnsName, string key, string value)",
  "function authorizeTextRoles(bytes dnsName, string key, address account, bool grant)",
  "function authorizeNameRoles(bytes dnsName, address account, bool grant)",
  "function text(bytes32 node, string key) view returns (string)",
  "function dnsNamehash(bytes name) view returns (bytes32)",
  "error EACUnauthorized(address account, string key)",
]);

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

function pk(raw: string): Hex {
  const t = raw.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as Hex;
}

/** DNS wire-encode a dotted name (e.g. lindt.agent.shopify.eth). */
export function encodeDnsName(name: string): Hex {
  const labels = name.replace(/\.$/, "").split(".").filter(Boolean);
  const parts: number[] = [];
  for (const lab of labels) {
    const b = stringToBytes(lab);
    if (b.length > 63) throw new Error(`DNS label too long: ${lab}`);
    parts.push(b.length, ...b);
  }
  parts.push(0);
  return `0x${Buffer.from(parts).toString("hex")}` as Hex;
}

export function liveAddresses() {
  return {
    ethRegistry: config.ens.ethRegistry as Address,
    shopifyUserRegistry: (config.ens.shopifyUserRegistry || "") as Address,
    agentShopifyRegistry: (config.ens.agentShopifyRegistry || "") as Address,
    lindtCommissionRegistry: (config.ens.lindtCommissionRegistry || "") as Address,
    permissionedResolver: (config.ens.permissionedResolver || "") as Address,
    buyerUserRegistry: (config.ens.buyerUserRegistry || "") as Address,
    agentDheerajRegistry: (config.ens.agentDheerajRegistry || "") as Address,
    buyerPermissionedResolver: (config.ens.buyerPermissionedResolver ||
      config.ens.permissionedResolver ||
      "") as Address,
    shopifyTokenId: SHOPIFY_TOKEN_ID,
    dheerajTokenId: DHEERAJ_TOKEN_ID,
  };
}

function requireShopifyStack() {
  const a = liveAddresses();
  if (!a.shopifyUserRegistry || a.shopifyUserRegistry === ZERO) {
    throw new Error("ENS_SHOPIFY_USER_REGISTRY not configured");
  }
  if (!a.permissionedResolver || a.permissionedResolver === ZERO) {
    throw new Error("ENS_PERMISSIONED_RESOLVER not configured");
  }
  return a;
}

export function shopifyDeployerKey(): string {
  return (
    config.ens.deployerPrivateKey ||
    config.shopify.privateKey ||
    config.seller.privateKey ||
    ""
  );
}

export function buyerDeployerKey(): string {
  return config.buyer.privateKey || "";
}

function clients(privateKey: string) {
  const account = privateKeyToAccount(pk(privateKey));
  const transport = http(config.ens.rpc);
  const publicClient = createPublicClient({
    chain: hackathonSepolia,
    transport,
  });
  const walletClient = createWalletClient({
    account,
    chain: hackathonSepolia,
    transport,
  });
  return { account, publicClient, walletClient };
}

async function waitTx(publicClient: PublicClient, hash: Hex) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Tx reverted: ${hash}`);
  }
  return receipt;
}

export async function ensureShopifySubregistry(opts?: {
  privateKey?: string;
}): Promise<{
  registry: Address;
  alreadyWired: boolean;
  txHash: Hex | null;
}> {
  const addrs = requireShopifyStack();
  const { publicClient, walletClient } = clients(
    opts?.privateKey || shopifyDeployerKey(),
  );

  const current = (await publicClient.readContract({
    address: addrs.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "getSubregistry",
    args: [config.ens.rootLabel],
  })) as Address;

  if (current.toLowerCase() === addrs.shopifyUserRegistry.toLowerCase()) {
    return { registry: current, alreadyWired: true, txHash: null };
  }

  // Allow re-pointing when we redeploy an explorer-compatible registry.
  const hash = await walletClient.writeContract({
    address: addrs.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "setSubregistry",
    args: [BigInt(addrs.shopifyTokenId), addrs.shopifyUserRegistry],
  });
  await waitTx(publicClient, hash);
  return {
    registry: addrs.shopifyUserRegistry,
    alreadyWired: false,
    txHash: hash,
  };
}

export async function ensureDheerajSubregistry(opts?: {
  privateKey?: string;
}): Promise<{
  registry: Address;
  alreadyWired: boolean;
  txHash: Hex | null;
}> {
  const addrs = liveAddresses();
  if (!addrs.buyerUserRegistry || addrs.buyerUserRegistry === ZERO) {
    throw new Error("ENS_BUYER_USER_REGISTRY not configured");
  }
  const { publicClient, walletClient } = clients(
    opts?.privateKey || buyerDeployerKey(),
  );

  const current = (await publicClient.readContract({
    address: addrs.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "getSubregistry",
    args: ["dheeraj"],
  })) as Address;

  if (current.toLowerCase() === addrs.buyerUserRegistry.toLowerCase()) {
    return { registry: current, alreadyWired: true, txHash: null };
  }

  const hash = await walletClient.writeContract({
    address: addrs.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "setSubregistry",
    args: [BigInt(addrs.dheerajTokenId), addrs.buyerUserRegistry],
  });
  await waitTx(publicClient, hash);
  return { registry: addrs.buyerUserRegistry, alreadyWired: false, txHash: hash };
}

/** Register a label on any ShopifyUserRegistry instance. */

export async function ensureDheerajResolver(opts?: {
  privateKey?: string;
}): Promise<{
  resolver: Address;
  alreadyWired: boolean;
  txHash: Hex | null;
}> {
  const addrs = liveAddresses();
  if (!addrs.buyerPermissionedResolver || addrs.buyerPermissionedResolver === ZERO) {
    throw new Error("ENS_BUYER_PERMISSIONED_RESOLVER not configured");
  }
  const { publicClient, walletClient } = clients(
    opts?.privateKey || buyerDeployerKey(),
  );

  const current = (await publicClient.readContract({
    address: addrs.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "getResolver",
    args: ["dheeraj"],
  })) as Address;

  if (current.toLowerCase() === addrs.buyerPermissionedResolver.toLowerCase()) {
    return { resolver: current, alreadyWired: true, txHash: null };
  }

  const hash = await walletClient.writeContract({
    address: addrs.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "setResolver",
    args: [BigInt(addrs.dheerajTokenId), addrs.buyerPermissionedResolver],
  });
  await waitTx(publicClient, hash);
  return {
    resolver: addrs.buyerPermissionedResolver,
    alreadyWired: false,
    txHash: hash,
  };
}

export async function ensureShopifyResolver(opts?: {
  privateKey?: string;
}): Promise<{
  resolver: Address;
  alreadyWired: boolean;
  txHash: Hex | null;
}> {
  const addrs = requireShopifyStack();
  const { publicClient, walletClient } = clients(
    opts?.privateKey || shopifyDeployerKey(),
  );

  const current = (await publicClient.readContract({
    address: addrs.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "getResolver",
    args: [config.ens.rootLabel],
  })) as Address;

  if (current.toLowerCase() === addrs.permissionedResolver.toLowerCase()) {
    return { resolver: current, alreadyWired: true, txHash: null };
  }

  const hash = await walletClient.writeContract({
    address: addrs.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "setResolver",
    args: [BigInt(addrs.shopifyTokenId), addrs.permissionedResolver],
  });
  await waitTx(publicClient, hash);
  return {
    resolver: addrs.permissionedResolver,
    alreadyWired: false,
    txHash: hash,
  };
}

export async function readEthResolver(label: string): Promise<Address> {
  const client = createPublicClient({
    chain: hackathonSepolia,
    transport: http(config.ens.rpc),
  });
  return (await client.readContract({
    address: config.ens.ethRegistry as Address,
    abi: ethRegistryAbi,
    functionName: "getResolver",
    args: [label],
  })) as Address;
}

export async function registerLabelLive(input: {
  registry: Address;
  label: string;
  owner: Address;
  subregistry?: Address;
  resolver?: Address;
  privateKey?: string;
}): Promise<{ txHash: Hex }> {
  const addrs = requireShopifyStack();
  const { publicClient, walletClient } = clients(
    input.privateKey || shopifyDeployerKey(),
  );
  const resolver = input.resolver || addrs.permissionedResolver;
  const sub = input.subregistry || ZERO;
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 3600);

  const hash = await walletClient.writeContract({
    address: input.registry,
    abi: userRegistryAbi,
    functionName: "register",
    args: [input.label, input.owner, sub, resolver, 0n, expiry],
  });
  await waitTx(publicClient, hash);
  return { txHash: hash };
}

/** @deprecated use registerLabelLive on agent hub registry */
export async function registerMerchantLive(input: {
  label: string;
  owner: Address;
  resolver?: Address;
  privateKey?: string;
}): Promise<{ txHash: Hex; tokenId: bigint }> {
  const addrs = liveAddresses();
  const registry =
    addrs.agentShopifyRegistry && addrs.agentShopifyRegistry !== ZERO
      ? addrs.agentShopifyRegistry
      : addrs.shopifyUserRegistry;
  if (!registry || registry === ZERO) {
    throw new Error("No agent/shopify registry configured");
  }
  const { txHash } = await registerLabelLive({
    registry,
    label: input.label,
    owner: input.owner,
    resolver: input.resolver,
    privateKey: input.privateKey,
  });
  return { txHash, tokenId: 0n };
}

export async function setTextLive(input: {
  ensName: string;
  key: string;
  value: string;
  privateKey: string;
  resolver?: Address;
}): Promise<{ txHash: Hex }> {
  const addrs = requireShopifyStack();
  const { publicClient, walletClient } = clients(input.privateKey);
  const resolver = input.resolver || addrs.permissionedResolver;
  const dnsName = encodeDnsName(input.ensName);
  const hash = await walletClient.writeContract({
    address: resolver,
    abi: resolverAbi,
    functionName: "setText",
    args: [dnsName, input.key, input.value],
  });
  await waitTx(publicClient, hash);
  return { txHash: hash };
}

export async function authorizeTextRolesLive(input: {
  ensName: string;
  key: string;
  account: Address;
  grant: boolean;
  privateKey?: string;
  resolver?: Address;
}): Promise<{ txHash: Hex }> {
  const addrs = requireShopifyStack();
  const { publicClient, walletClient } = clients(
    input.privateKey || shopifyDeployerKey(),
  );
  const resolver = input.resolver || addrs.permissionedResolver;
  const dnsName = encodeDnsName(input.ensName);
  const hash = await walletClient.writeContract({
    address: resolver,
    abi: resolverAbi,
    functionName: "authorizeTextRoles",
    args: [dnsName, input.key, input.account, input.grant],
  });
  await waitTx(publicClient, hash);
  return { txHash: hash };
}

export async function authorizeNameRolesLive(input: {
  ensName: string;
  account: Address;
  grant: boolean;
  privateKey?: string;
  resolver?: Address;
}): Promise<{ txHash: Hex }> {
  const addrs = requireShopifyStack();
  const { publicClient, walletClient } = clients(
    input.privateKey || shopifyDeployerKey(),
  );
  const resolver = input.resolver || addrs.permissionedResolver;
  const dnsName = encodeDnsName(input.ensName);
  const hash = await walletClient.writeContract({
    address: resolver,
    abi: resolverAbi,
    functionName: "authorizeNameRoles",
    args: [dnsName, input.account, input.grant],
  });
  await waitTx(publicClient, hash);
  return { txHash: hash };
}

export type EacDemoResult = {
  ensName: string;
  allow: { ok: true; txHash: Hex; key: string; value: string };
  deny: {
    ok: false;
    key: string;
    revertReason: string;
    txHash: Hex | null;
  };
};

/** Shopify authorizes merchant on agent-endpoint[web]; allow then deny. */
export async function demoEacAllowDeny(opts?: {
  ensName?: string;
  merchantPrivateKey?: string;
  merchantAddress?: Address;
  allowKey?: string;
  denyKey?: string;
}): Promise<EacDemoResult> {
  const ensName = opts?.ensName || "lindt.agent.shopify.eth";
  const merchantPk =
    opts?.merchantPrivateKey || config.merchants.m1.privateKey || "";
  const merchantAddress = (opts?.merchantAddress ||
    config.merchants.m1.address) as Address;
  if (!merchantPk || !merchantAddress) {
    throw new Error("Merchant private key / address required for EAC demo");
  }

  const allowKey = opts?.allowKey || "agent-endpoint[web]";
  const denyKey = opts?.denyKey || "ensip25-registration";
  const shopifyPk = shopifyDeployerKey();
  if (!shopifyPk) throw new Error("Shopify / ENS deployer key missing");

  await authorizeTextRolesLive({
    ensName,
    key: allowKey,
    account: merchantAddress,
    grant: true,
    privateKey: shopifyPk,
  });

  const allowValue = `https://lindt.example/agent`;
  const allow = await setTextLive({
    ensName,
    key: allowKey,
    value: allowValue,
    privateKey: merchantPk,
  });

  let denyTx: Hex | null = null;
  let revertReason = "unknown";
  try {
    const { publicClient, walletClient } = clients(merchantPk);
    const addrs = requireShopifyStack();
    const dnsName = encodeDnsName(ensName);
    const hash = await walletClient.writeContract({
      address: addrs.permissionedResolver,
      abi: resolverAbi,
      functionName: "setText",
      args: [dnsName, denyKey, "1"],
      gas: 120_000n,
    });
    denyTx = hash;
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      revertReason = `EACUnauthorized(${merchantAddress}, "${denyKey}")`;
    } else {
      revertReason = "expected revert but tx succeeded";
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    revertReason = msg.includes("EACUnauthorized")
      ? `EACUnauthorized(${merchantAddress}, "${denyKey}")`
      : msg.slice(0, 500);
  }

  return {
    ensName,
    allow: { ok: true, txHash: allow.txHash, key: allowKey, value: allowValue },
    deny: { ok: false, key: denyKey, revertReason, txHash: denyTx },
  };
}

export async function readShopifySubregistry(
  publicClient?: PublicClient,
): Promise<Address> {
  const client =
    publicClient ||
    createPublicClient({
      chain: hackathonSepolia,
      transport: http(config.ens.rpc),
    });
  return (await client.readContract({
    address: config.ens.ethRegistry as Address,
    abi: ethRegistryAbi,
    functionName: "getSubregistry",
    args: [config.ens.rootLabel],
  })) as Address;
}

export async function readLabelResolver(
  registry: Address,
  label: string,
): Promise<Address> {
  const client = createPublicClient({
    chain: hackathonSepolia,
    transport: http(config.ens.rpc),
  });
  return (await client.readContract({
    address: registry,
    abi: userRegistryAbi,
    functionName: "getResolver",
    args: [label],
  })) as Address;
}

export async function readMerchantResolver(label: string): Promise<Address> {
  const addrs = liveAddresses();
  const registry =
    addrs.agentShopifyRegistry && addrs.agentShopifyRegistry !== ZERO
      ? addrs.agentShopifyRegistry
      : addrs.shopifyUserRegistry;
  return readLabelResolver(registry, label);
}

export { userRegistryAbi, resolverAbi, ethRegistryAbi, ZERO };
