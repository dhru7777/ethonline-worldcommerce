/**
 * Application + ENSIP text records for agent / merchant names.
 * ENSIP-25/26 are the standards path; commerce keys are project-specific extras.
 */

export const ENSIP26 = {
  agentContext: "agent-context",
  agentEndpoint: (protocol: "mcp" | "a2a" | "web") => `agent-endpoint[${protocol}]`,
} as const;

/** ENSIP-25 parameterized key — registry must be ERC-7930 interoperable address. */
export function ensip25RegistrationKey(
  erc7930Registry: string,
  agentId: string | number,
): string {
  return `agent-registration[${erc7930Registry}][${agentId}]`;
}

export type AgentTextRecords = {
  /** ENSIP-26 */
  "agent-context": string;
  "agent-endpoint[web]"?: string;
  "agent-endpoint[mcp]"?: string;
  "agent-endpoint[a2a]"?: string;
  /** ENSIP-25 — set after ERC-7930 encoding is built */
  [ensip25Key: `agent-registration[${string}][${string}]`]: string | undefined;
  /** Project commerce extras (not ENS standards) */
  "com.worldcommerce.payment"?: string;
  "com.worldcommerce.chain"?: string;
  "com.worldcommerce.ucp"?: string;
  "com.worldcommerce.version"?: string;
};

export function buildMerchantAgentContext(input: {
  merchantName: string;
  ensName: string;
  sellerAgentId: number;
  sellerChainLabel: string;
}): string {
  return [
    `# ${input.merchantName}`,
    "",
    `ENS identity: ${input.ensName}`,
    `Platform seller agent: #${input.sellerAgentId} (${input.sellerChainLabel})`,
    "",
    "Commerce agent under the Shopify ENSv2 namespace.",
    "Discovery via Shopify UCP; settlement metadata via agent-endpoint and project text records.",
    "Verify registry binding with ENSIP-25 agent-registration keys (chain-scoped via ERC-7930).",
  ].join("\n");
}
