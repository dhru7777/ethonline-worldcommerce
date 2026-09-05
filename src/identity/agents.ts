import {
  agentRegistryCaip,
  config,
  scan8004AgentUrl,
} from "../config/index.js";
import { ensip25KeyForAgent } from "../ens/erc7930.js";

export type AgentIdentityView = {
  role: "buyer" | "seller";
  name: string;
  agentId: number;
  chainId: number;
  chainLabel: string;
  identityRegistry: string;
  globalId: string;
  walletAddress: string | null;
  scanUrl: string;
  ensip25Key: string;
  x402: boolean;
  trust: string[];
};

function chainLabel(chainId: number): string {
  if (chainId === 84532) return "Base Sepolia";
  if (chainId === 11155111) return "Ethereum Sepolia";
  if (chainId === 1) return "Ethereum";
  return `chain ${chainId}`;
}

export function getBuyerIdentity(): AgentIdentityView {
  const { buyer } = config;
  return {
    role: "buyer",
    name: buyer.name,
    agentId: buyer.agentId,
    chainId: buyer.chainId,
    chainLabel: chainLabel(buyer.chainId),
    identityRegistry: buyer.identityRegistry,
    globalId: `${agentRegistryCaip(buyer.chainId, buyer.identityRegistry)}:${buyer.agentId}`,
    walletAddress: buyer.walletAddress || null,
    scanUrl: scan8004AgentUrl(buyer.chainId, buyer.agentId),
    ensip25Key: ensip25KeyForAgent(
      buyer.chainId,
      buyer.identityRegistry,
      buyer.agentId,
    ),
    x402: true,
    trust: ["reputation"],
  };
}

export function getSellerIdentity(): AgentIdentityView {
  const { seller } = config;
  return {
    role: "seller",
    name: seller.name,
    agentId: seller.agentId,
    chainId: seller.chainId,
    chainLabel: chainLabel(seller.chainId),
    identityRegistry: seller.identityRegistry,
    globalId: `${agentRegistryCaip(seller.chainId, seller.identityRegistry)}:${seller.agentId}`,
    walletAddress: seller.payTo || null,
    scanUrl: scan8004AgentUrl(seller.chainId, seller.agentId),
    ensip25Key: ensip25KeyForAgent(
      seller.chainId,
      seller.identityRegistry,
      seller.agentId,
    ),
    x402: true,
    trust: ["reputation"],
  };
}

export function getIdentities() {
  return {
    buyer: getBuyerIdentity(),
    seller: getSellerIdentity(),
  };
}
