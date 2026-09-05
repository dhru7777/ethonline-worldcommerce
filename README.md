# worldCommerce

ENSv2 Shopify agent namespaces for agentic commerce — Sepolia beta.

Shopify owns the head registry (`shopify.eth` → `agent.shopify.eth`). Merchants get `{slug}.agent.shopify.eth`. Buyer roles live under `dheeraj.eth` → `agent.dheeraj.eth` (`intent` / `guardrail` / `payment` / `feedback`). ERC-8004 identity + ENSIP-25/26 + EAC.

## What is central

| Layer | Job |
|---|---|
| **ENSv2 (Sepolia)** | Nested UserRegistry trees + PermissionedCommerceResolver + EAC |
| **ENSIP-25 / 26** | `agent-registration[ERC-7930][id]` + `agent-context` / `agent-endpoint[*]` |
| **ERC-8004** | Buyer + seller identity (Ethereum Sepolia) |
| **Shopify UCP** | Product discovery — merchant ENS labels come from search hits |
| **x402** | Incentive / payment rail (Sepolia MockUSDC in demo) |
| **World AgentKit** | Human-backing gate (wired next) |

## Naming rules

- **Seller:** `lindt.agent.shopify.eth` (+ demo `commission.lindt.agent.shopify.eth`)
- **Buyer:** `intent.agent.dheeraj.eth`, `guardrail…`, `payment…`, `feedback…`
- **UI:** bottom-left **ENS Tree** button visualizes both sides + permissions
- **Ops:** `npm run ens:deploy` then `npm run ens:live`
## Agents (defaults — override via `.env`)

| Role | Agent ID | Chain |
|---|---|---|
| Buyer | `9638` | Ethereum Sepolia |
| Seller / Shopify platform | `6832` | Ethereum Sepolia |

Monad is not used.

## Quick start

```bash
cp .env.example .env
# fill keys you have (OpenAI optional; deployer key for live ENS writes)

npm install
npm run demo
```

Open [http://localhost:5190](http://localhost:5190).

Flow: intent → UCP offers + ENS → **worldAgent** capacity check → Approve/Reject → Sepolia MockUSDC pay merchant → Merchant1 commission → buyer → receipt / feedback.

Try: `Find me chocolates under $10` → Approve the pick.

## API

- `GET /api/health` — ENS mode + identities
- `GET /api/identities` — buyer / seller ERC-8004 views + ENSIP-25 keys
- `GET /api/agent/buyer|seller` — live 8004scan profile (ID / Rank / Feedback / Verify)
- `GET /api/wallet/buyer|seller` — Sepolia ETH+USDC balances
- `GET /api/ens/tree` — current in-memory namespace tree
- `POST /api/discover` `{ "text": "chocolates under $10" }` — UCP (or fallback) + lazy ENS ensure
- `POST /api/turn` — multi-turn intent → UCP offers + ENS

`ENS_WRITE_MODE=dry-run` (default) builds namespaces and text records without Sepolia txs. Set `live` + `ENS_DEPLOYER_PRIVATE_KEY` when Permissioned Registry writes are ready.

## Docs

- [Architecture](docs/architecture.md)
- **ETHOnline ENSv2 Sepolia (use these, not production docs):**
  - [Deployments + viem/ethers override](https://feature-permres-inode-refact.docs-bao.pages.dev/learn/deployments#sepolia-ensv2-beta)
  - [ENSv2 overview](https://feature-permres-inode-refact.docs-bao.pages.dev/ensv2/overview)
  - [ENS Explorer](https://hackathon-deployment-portal-app.ens-cf.workers.dev/)
  - [ENS App (register names)](https://hackathon-deployment-manager-app-v4.ens-cf.workers.dev/)
- ENSIP-25: https://docs.ens.domains/ensip/25/
- ENSIP-26: https://docs.ens.domains/ensip/26/
