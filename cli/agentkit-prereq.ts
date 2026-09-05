/**
 * AgentKit prerequisites checklist (works before Sandbox access).
 *
 *   npm run agentkit:prereq
 *   npm run agentkit:status
 *   npm run agentkit:register   # needs verified World ID in World App
 */
import { createAgentBookVerifier } from "@worldcoin/agentkit";
import { config } from "../src/config/index.js";
import { AGENTBOOK, verifyAgentHumanBacked } from "../src/agentkit/verify.js";

const cmd = process.argv[2] || "prereq";

async function status(wallet: string) {
  console.log(`AgentBook  ${AGENTBOOK.contract}`);
  console.log(`Network    ${AGENTBOOK.network}`);
  console.log(`Wallet     ${wallet}`);
  const book = createAgentBookVerifier();
  const humanId = await book.lookupHuman(wallet as `0x${string}`);
  console.log(`Registered ${Boolean(humanId)}`);
  console.log(`humanId    ${humanId ?? "(null)"}`);
  const v = await verifyAgentHumanBacked(wallet);
  console.log(`verify()   humanBacked=${v.isHumanBacked} via=${v.checkedVia} tier=${v.capacityTier}`);
  if (v.failureReason) console.log(`reason     ${v.failureReason}`);
  return Boolean(humanId);
}

async function prereq() {
  console.log("=== worldCommerce · AgentKit prerequisites ===\n");

  const buyer = config.buyer.walletAddress || "";
  console.log("1) Packages");
  console.log("   @worldcoin/agentkit installed");
  console.log("   CLI: npx @worldcoin/agentkit-cli\n");

  console.log("2) World ID Developer Portal (done / pending)");
  console.log(`   app_id     ${config.worldId.appId || "(set WORLD_ID_APP_ID)"}`);
  console.log(`   rp_id      ${config.worldId.rpId || "(set WORLD_ID_RP_ID after configure_world_id)"}`);
  console.log(`   action     ${config.worldId.action || "human-backed-agent"}`);
  console.log(
    `   signer     ${config.worldId.signerAddress || "(from configure_world_id)"}`,
  );
  console.log(
    `   privateKey ${config.worldId.privateKey ? "set in .env (WORLD_ID_PRIVATE_KEY)" : "MISSING — save from configure_world_id once"}`,
  );
  console.log("");

  console.log("3) AgentBook lookup (public — no Sandbox needed)");
  if (!buyer) {
    console.log("   BUYER_WALLET_ADDRESS missing in .env\n");
  } else {
    const registered = await status(buyer);
    console.log("");
    if (!registered) {
      console.log("4) Register buyer wallet (needs YOUR verified World ID in World App)");
      console.log(`   npm run agentkit:register`);
      console.log(`   # or: npx @worldcoin/agentkit-cli register ${buyer}`);
      console.log("   Scan the QR with World App when prompted.\n");
    } else {
      console.log("4) Buyer wallet already registered in AgentBook ✓\n");
    }
  }

  console.log("5) Demo mode until registration / Sandbox");
  console.log(
    `   AGENTKIT_ASSUME_HUMAN_BACKED=${config.agentkit.assumeHumanBacked}`,
  );
  console.log(
    "   true  → allow path even if AgentBook miss (hackathon demo)",
  );
  console.log(
    "   false → deny / hold commission when not registered (honest Continuity demo)\n",
  );

  console.log("6) When Sandbox access arrives");
  console.log("   - Set WORLD_AGENTKIT_RPC / any Sandbox keys in .env");
  console.log("   - Prefer live AgentBook registration over assume");
  console.log("   - Optional: set AGENTKIT_FORCE_ASSUME=false (default)\n");

  console.log("Docs: https://docs.world.org/agents/agent-kit/integrate");
}

async function registerHint() {
  const buyer = config.buyer.walletAddress;
  if (!buyer) throw new Error("BUYER_WALLET_ADDRESS required");
  console.log("Opening AgentBook registration for buyer wallet…");
  console.log("This requires a verified World ID in World App (not Sandbox).");
  console.log(`\n  npx @worldcoin/agentkit-cli register ${buyer}\n`);
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(
    "npx",
    ["@worldcoin/agentkit-cli", "register", buyer],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  process.exit(r.status ?? 1);
}

async function main() {
  if (cmd === "status") {
    const w = process.argv[3] || config.buyer.walletAddress;
    if (!w) throw new Error("wallet required");
    await status(w);
    return;
  }
  if (cmd === "register") {
    await registerHint();
    return;
  }
  await prereq();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
