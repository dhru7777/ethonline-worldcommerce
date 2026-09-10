/**
 * World ID 4.0 Sandbox (TestFlight app) — Continuity remote test.
 * Does NOT write AgentBook. Production Orb register is a separate path.
 */
import { signRequest } from "@worldcoin/idkit-core/signing";
import { config } from "../config/index.js";

const seenNullifiers = new Set<string>();

export function worldIdPublicConfig() {
  const mockSelfie = Boolean(config.worldId.mockSelfie);
  return {
    appId: config.worldId.appId,
    rpId: config.worldId.rpId,
    action: config.worldId.action,
    environment: config.worldId.environment,
    signerAddress: config.worldId.signerAddress || null,
    hasSigningKey: Boolean(config.worldId.privateKey),
    mockSelfie,
    username: config.worldId.username || null,
    note: mockSelfie
      ? "Sandbox selfie is mocked. TestFlight Selfie Check is failing; Approve does not open the QR."
      : "Sandbox proofs test the RP remotely. They do not enroll AgentBook.",
  };
}

function verifyUrl() {
  const rp = config.worldId.rpId;
  if (!rp) return "";
  const ep = config.worldId.verifyEndpoint || "";
  if (ep.startsWith("http")) return ep;
  return `https://developer.world.org/api/v4/verify/${rp}`;
}

export function signWorldIdRequest(action?: string) {
  if (!config.worldId.privateKey) {
    throw new Error(
      "WORLD_ID_PRIVATE_KEY missing — paste the one-time signing key for this RP into .env",
    );
  }
  if (!config.worldId.rpId) {
    throw new Error("WORLD_ID_RP_ID missing");
  }
  const signed = signRequest({
    signingKeyHex: config.worldId.privateKey,
    action: action || config.worldId.action,
    ttl: 300,
  });
  return {
    rp_id: config.worldId.rpId,
    app_id: config.worldId.appId,
    action: action || config.worldId.action,
    environment: config.worldId.environment,
    nonce: signed.nonce,
    created_at: Number(signed.createdAt),
    expires_at: Number(signed.expiresAt),
    signature: signed.sig,
  };
}

export async function verifyWorldIdProof(idkitResponse: unknown) {
  const url = verifyUrl();
  if (!url) throw new Error("WORLD_ID_RP_ID missing");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(idkitResponse),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    return { ok: false, status: res.status, body };
  }

  const nullifiers: string[] = [];
  const asObj = body as {
    responses?: Array<{ nullifier?: string; nullifier_hash?: string }>;
  };
  const idkit = idkitResponse as {
    responses?: Array<{ nullifier?: string; nullifier_hash?: string }>;
  };
  for (const row of asObj.responses || idkit.responses || []) {
    const n = row.nullifier || row.nullifier_hash;
    if (n) nullifiers.push(n);
  }
  for (const n of nullifiers) {
    if (seenNullifiers.has(n)) {
      return { ok: false, status: 409, error: "nullifier_replayed", nullifier: n };
    }
  }
  for (const n of nullifiers) seenNullifiers.add(n);

  return {
    ok: true,
    status: res.status,
    environment: config.worldId.environment,
    nullifiers,
    body,
    writesAgentBook: false,
  };
}
