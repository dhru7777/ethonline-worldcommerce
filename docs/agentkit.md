# World AgentKit / Continuity prerequisites

## Orb vs Sandbox (why the QR asks for an Orb)

`npm run agentkit:register` talks to **production** AgentBook on World Chain. That contract only accepts a **World ID Orb** proof: one unique human, hardware-attested, not a phone account.

World ID Sandbox **cannot** finish that QR.

| | Production World App | World ID (Sandbox) TestFlight |
|---|---|---|
| Proves | Real unique human (Orb) | Fake / resettable test human |
| Used for | AgentBook **register** write | IDKit / RP testing (`environment: sandbox`) |
| Can write AgentBook? | Yes, if Orb-verified | **No** — proofs are non-production |
| Continuity rubric | “Registers or resolves via AgentBook” | “Uses Sandbox App to test remotely” |

So the CLI is correct when it says *“verified World ID in World App (not Sandbox)”*. Scan that QR with **World App** after an Orb visit. Scanning it with the Sandbox app (or a World App that is only device-verified) will sit on “Waiting for verification…” or demand Orb.

You do **not** need an Orb for:

- `lookupHuman(wallet)` (public read — returns `null` if unregistered)
- Installing Sandbox and testing your RP (`app_9e8641e847eb208a9f5fb9615d1b8b82` / `rp_d0def0416259c77e`)
- The commission **hold** path (unregistered wallet → do not pay the bid)

You **do** need an Orb for:

- `AgentBook.register(0xCD64…)` so lookup returns a real `humanId`
- The commission **release** path without the labeled `AGENTKIT_ASSUME_HUMAN_BACKED` mock
- AgentKit **free-trial grant** on `GET /api/agentkit/data` (hooks also call `lookupHuman`)

If you do not have an Orb: **Ctrl-C** the waiting CLI. Do not leave it spinning. The demo defaults to a **labeled AgentBook mock** (`AGENTKIT_ASSUME_HUMAN_BACKED=true`) so you can still show commission **release**. Set `false` to show the hold path. Sandbox IDKit is separate (Approve selfie).

## Status

| Piece | Status |
|-------|--------|
| `@worldcoin/agentkit` installed | yes |
| Live AgentBook `lookupHuman(wallet)` on World Chain | yes (`npm run agentkit:status`) |
| World ID RP on portal | `app_9e8641e847eb208a9f5fb9615d1b8b82` · `rp_d0def0416259c77e` |
| World ID action `human-backed-agent` | created (not called on `/api/settle`) |
| AgentBook **register** | **done** · tx `0x25e4710c…` · `status` = registered |
| World ID Sandbox App | access granted; not wired in the UI yet |
| `AGENTKIT_ASSUME_HUMAN_BACKED` | labeled mock when live lookup is empty (`true` = release-path demo) |

## Commands

```bash
npm run agentkit:prereq
npm run agentkit:status
# Orb-verified World App only — will not complete in Sandbox:
npm run agentkit:register
```

Docs: https://docs.world.org/agents/agent-kit/integrate  
Sandbox: https://docs.world.org/world-id/sandbox/what-is-sandbox

## Security

- `WORLD_ID_PRIVATE_KEY` is one-time from `configure_world_id`. Never commit it.
- If the key was exposed in chat, rotate via Developer Portal / `rotate_world_id_signing_key`.
