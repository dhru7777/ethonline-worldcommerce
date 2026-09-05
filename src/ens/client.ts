import { createPublicClient, http, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { config } from "../config/index.js";

/**
 * ETHOnline ENSv2 Sepolia hackathon deployment.
 * MUST override viem's built-in Universal Resolver or resolution hits the wrong tree.
 * @see https://feature-permres-inode-refact.docs-bao.pages.dev/learn/deployments#sepolia-ensv2-beta
 */
export const hackathonSepolia = {
  ...sepolia,
  contracts: {
    ...sepolia.contracts,
    ensUniversalResolver: {
      address: config.ens.universalResolverProxy as `0x${string}`,
    },
  },
} as const;

let _client: PublicClient | null = null;

export function getEnsPublicClient(): PublicClient {
  if (_client) return _client;
  _client = createPublicClient({
    chain: hackathonSepolia,
    transport: http(config.ens.rpc),
  });
  return _client;
}
