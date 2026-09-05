# World AgentKit / Continuity prerequisites

## What works **before** Sandbox access

| Piece | Status |
|-------|--------|
| `@worldcoin/agentkit` installed | yes |
| Live AgentBook `lookupHuman(wallet)` on World Chain | yes (`npm run agentkit:status`) |
| World ID RP on portal app | configured (`WORLD_ID_*` in `.env`) |
| World ID action `human-backed-agent` | created |
| Demo allow/deny via `AGENTKIT_ASSUME_HUMAN_BACKED` | yes |
| AgentBook **register** (QR / World App) | needs your verified World ID |
| Sandbox-only APIs | wait for access |

## Commands

```bash
npm run agentkit:prereq    # checklist
npm run agentkit:status    # AgentBook lookup for BUYER_WALLET_ADDRESS
npm run agentkit:register  # interactive World App registration
```

Docs: https://docs.world.org/agents/agent-kit/integrate

## When Sandbox arrives

1. Keep AgentBook registration for the buyer wallet (primary Continuity signal).
2. Optionally set `WORLD_AGENTKIT_RPC` if Sandbox exposes an extra endpoint.
3. Set `AGENTKIT_ASSUME_HUMAN_BACKED=false` to demo the **deny / hold commission** path for unregistered wallets.
4. Poll `WORLD_ID_STATUS_ENDPOINT` until RP `registered` before relying on cloud World ID verify.

## Security

- `WORLD_ID_PRIVATE_KEY` is one-time from `configure_world_id`. Never commit it.
- If the key was exposed in chat, rotate via Developer Portal / `rotate_world_id_signing_key`.
