# AgentKit Continuity — implementation log

**Project:** worldCommerce  
**Track:** AgentKit Continuity  
**Live demo:** https://worldcommerce-production.up.railway.app  
**Product critique:** [world-product-feedback.md](./world-product-feedback.md)  
**Prereqs / Orb vs Sandbox:** [agentkit.md](./agentkit.md)

## Value proposition

World’s AgentKit default is **access**: a human-backed agent gets cheaper x402 API calls (`free-trial` / `discount`).

This app uses **both**:

```text
World kit:     human-backed → cheaper API (free-trial catalog)
worldCommerce: human-backed → merchant commission released
               not backed  → 402 on catalog + commission held
```

- Merchants bid a commission to be chosen (`COMMISSION_BPS`, demo 1.7%).
- The Shopify / seller path may **release** that bid to the buyer agent only if AgentBook resolves a human on the buyer wallet.
- If AgentBook returns `null`, commission is **held**. The purchase can still settle. The bounty cannot.

Bots can shop. They cannot farm merchant incentives. `dheeraj.eth` / `agent.dheeraj.eth` is the ENS name of that human. AgentBook `humanId` is the uniqueness proof. They are not the same registry.

Register is **once** (Orb World App → AgentBook write). Lookup is **on every payout** (no QR).

---

## Continuity rubric

| Requirement | Status | Notes |
|---|---|---|
| Uses AgentKit in a meaningful way | **Yes** | Commission gate **and** x402 free-trial catalog (`/api/agentkit/data`) |
| Shows a working app | **Yes** | Railway demo + split-screen buyer × Shopify UI |
| Registers or resolves agents through AgentBook | **Yes (register + resolve)** | Orb World ID verified; AgentBook write tx `0x25e4710c…` on World Chain. `lookupHuman` returns human `0x2493…7ff4`. Screens: [feedback §5.1](./world-product-feedback.md#51-proof-orb-world-id-bound-the-buyer-agent) |
| World ID Sandbox App to test remotely | **Wired in-app** | Header **Sandbox ID** → IDKit `environment: sandbox` → scan with TestFlight World ID (Sandbox). Does not write AgentBook. Needs `WORLD_ID_PRIVATE_KEY`. |
| Feedback: AgentKit docs + integration flow | **Yes** | This file + world-product-feedback.md + agentkit.md |
| Feedback: Developer Portal | **Partial** | App + RP + signer configured; portal does not explain Orb vs Sandbox for AgentBook |
| Feedback: Sandbox states / proofs / test users | **In progress** | Access: `dheerajinnyc@gmail.com`. Install still needs the **iPhone Apple ID** in TestFlight |
| Feedback: confusing / missing / broken | **Yes** | world-product-feedback.md; Orb required for register is the top surprise |

---

## What we implemented (AgentKit surface)

| World piece | Intended for | Used here? | Code | In this app |
|---|---|---|---|---|
| AgentBook `lookupHuman(wallet)` | wallet → anonymous human id | **Yes** | `src/agentkit/verify.ts` | Before commission: human id → release; else hold |
| `createAgentBookVerifier()` | Canonical World Chain registry | **Yes** | same | `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` (`eip155:480`) |
| AgentBook **register** (CLI + QR) | Bind wallet to Orb World ID once | **Done** | `npm run agentkit:register` | Buyer `0xCD643061B9a5D96AD8595B252fE098EA33a39D91` → human `0x2493…7ff4`. Tx `0x25e4710cc1432567536c3a72e35a1aac53a421a1689a7abbc449ce0c271bb1e4`. Screens in demo **AgentBook live** chip |
| `/api/agentkit/verify` | Expose lookup to UI | **Yes** | `cli/serve.ts` | Guardrail bubble |
| Lookup on `POST /api/settle` | Fail closed at money time | **Yes** | `settlePurchase({ humanBacked })` | Merchant1 → buyer USDC only if lookup passed |
| `AGENTKIT_ASSUME_HUMAN_BACKED` | Labeled demo mock | **true (release-path demo)** | `.env` / Railway | Live lookup still runs; UI shows `agentbook-mock` when unregistered |
| `createAgentkitClient` / signed header | Agent-side x402 (Step 3) | **Yes** | `src/agentkit/resource.ts` | Buyer signs SIWE for `/api/agentkit/data` via `GET /api/agentkit/access` |
| `createAgentkitHooks` + `InMemoryAgentKitStorage` `free-trial` | Server x402 access (Steps 4–5) | **Yes** | `GET /api/agentkit/data` | 3 uses / human; else HTTP 402. Node HTTP, not Hono |
| Hono + live World USDC facilitator settle | Docs sample | **No** | — | 402 JSON includes `accepts`; we do not take World USDC |
| World ID cloud verify on settle | Proof at payout | **No** | action in `.env` only | Register-time Orb is the production proof; payout is AgentBook read |
| World ID Sandbox / IDKit | Remote test without Orb | **Yes (in UI)** | `src/worldid/sandbox.ts` · header **Sandbox ID** | `environment: sandbox` + selfie preset. Does not write AgentBook |

---

## Why AgentBook asks for an Orb

Production AgentBook is World’s **sybil-resistant** agent registry. The product claim is “this wallet is backed by a **unique human**,” not “someone has the World App installed.”

World ID uniqueness at that level is **Orb** (iris hardware). Device-only World App and World ID Sandbox are weaker / fake identities. The CLI therefore opens `world.org/verify` against **production World App** and the app correctly refuses to finish without Orb.

Sandbox exists so you can test **your RP** (`human-backed-agent`) without production identities. World’s own docs: Sandbox proofs are not production uniqueness and must not be treated as AgentBook enrollment.

| If you… | Result |
|---|---|
| Scan register QR in Orb-verified World App | AgentBook write; later `lookupHuman` returns `humanId`; commission can release |
| Scan the same QR in Sandbox or unverified World App | Wait forever / Orb required |
| Skip register, `assume=false` | `lookupHuman` → `null` → commission **held** (honest Continuity demo of the bot path) |
| Skip register, `assume=true` | Labeled mock: live lookup `null`, commission **releases**, header chip **AgentBook mock** |

Orb write for this demo is **done** (mentor Orb on the register QR). `lookupHuman` now returns a human id. Commission **release** is live, not mocked. To show **hold**, use a different unregistered wallet.

---

## Runtime flow (no QR on purchase)

| Step | Actor | AgentKit? | QR? |
|---|---|---|---|
| 0. Enroll buyer wallet | Human + Orb World App | Register write | **Once** (Orb only) |
| 1. Human types intent | `dheeraj.eth` | No | No |
| 2. Buyer agent searches Shopify UCP | `agent.dheeraj.eth` | No | No |
| 3. Merchant ENS + bids | `*.agent.shopify.eth` | No | No |
| 4. Guardrails bubble | worldAgent | **Lookup + Step 3–5 catalog probe** | No |
| 5. Human Approve | HITL | No | No |
| 6. Buyer pays merchant | Sepolia USDC | No | No |
| 7. Seller releases or holds commission | Shopify agent | **Lookup again** | No |

---

## Incentive mapping

| AgentBook | Purchase | Merchant bid / commission |
|---|---|---|
| `humanId` found | Pays merchant | **Released** to buyer agent |
| `null` (bot / no Orb register) | May still pay merchant | **Held** |
| Lookup RPC fail and `assume=false` | Same | **Held** |

---

## Portal IDs (this app)

| Field | Value |
|---|---|
| App ID | `app_9e8641e847eb208a9f5fb9615d1b8b82` |
| RP ID | `rp_d0def0416259c77e` |
| Signer | `0x3c1EA69552FfCe94038cabE6FC85DD45Dba2f0ae` |
| Action | `human-backed-agent` |
| Buyer wallet | `0xCD643061B9a5D96AD8595B252fE098EA33a39D91` |

Do not commit `WORLD_ID_PRIVATE_KEY`.

---

## Docs / Portal / Sandbox notes

### AgentKit docs
- Integrate guide leads with x402 `fetch` + hooks. Commerce settle is not a sample.
- Register (Orb QR) and lookup (public read) are different products; the QR does not say “Orb required” until World App opens.
- Sandbox access does not change AgentBook. That should be one sentence in the register step.

### Developer Portal
- Created production app, action `human-backed-agent`, RP + signer.
- Portal ends on RP registered. It does not say: Orb → AgentBook write; Sandbox → IDKit only.

### Sandbox App
- Approved for `dheerajinnyc@gmail.com`. TestFlight must use the **same Apple ID as the iPhone**, or the build never appears.
- Next: tap **Sandbox ID** in the demo header, scan with World ID (Sandbox). Paste `WORLD_ID_PRIVATE_KEY` if the RP signature step fails. This does not replace Orb for AgentBook.

### Confusing / missing / broken
- Orb required to **write** AgentBook; lookup works without it. Easy to think Sandbox replaces Orb. It does not.
- `AGENTKIT_ASSUME_HUMAN_BACKED` default `true` is a labeled mock (header chip), not a silent Orb success.
- See world-product-feedback.md for scope card / hold-release / x402 mismatch.
