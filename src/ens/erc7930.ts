/**
 * Minimal ERC-7930 interoperable address encoder for EVM (EIP-155) registries.
 * Used by ENSIP-25 text record keys so the same 0x registry on different chains
 * cannot collide.
 *
 * Layout (high level): version | chainType | chainRefLen | chainRef | addrLen | address
 * Matches the ENSIP-25 Ethereum example style.
 */

function padHex(hex: string, byteLen: number): string {
  const h = hex.replace(/^0x/i, "").toLowerCase();
  return h.padStart(byteLen * 2, "0").slice(-byteLen * 2);
}

/**
 * Encode an EVM contract address on an EIP-155 chain as ERC-7930 hex.
 * Example (mainnet ERC-8004): chainId 1 + 0x8004A169… → 0x00010000010114…
 */
export function encodeErc7930EvmAddress(chainId: number, address: string): `0x${string}` {
  const addr = padHex(address, 20);
  // Compact chain reference for EIP-155: variable-length big-endian chain id
  let chainHex = chainId.toString(16);
  if (chainHex.length % 2) chainHex = `0${chainHex}`;
  const chainRefLen = chainHex.length / 2;

  // version=0x0001, chainType=0x0000 (eip155 family in ENSIP-25 examples), then lens + payloads
  // ENSIP-25 sample: 0x00010000010114 + 20-byte address  for chainId=1
  // Interpreted as: 0001 | 0000 | 01 | 01 | 14 | address
  const version = "0001";
  const chainType = "0000";
  const chainRefLenByte = padHex(chainRefLen.toString(16), 1);
  const addrLenByte = "14"; // 20 bytes

  return `0x${version}${chainType}${chainRefLenByte}${chainHex}${addrLenByte}${addr}`;
}

export function ensip25KeyForAgent(
  chainId: number,
  identityRegistry: string,
  agentId: string | number,
): string {
  const interop = encodeErc7930EvmAddress(chainId, identityRegistry);
  return `agent-registration[${interop}][${agentId}]`;
}
