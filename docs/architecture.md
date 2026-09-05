# Architecture

## Pipeline

```
User prompt
  → Buyer agent (ERC-8004 #9638 · Ethereum Sepolia)
  → Shopify UCP search (fallback catalog if UCP fails)
  → Unique merchants from THIS result set only
  → Lazy ENSv2 ensure: {slug}.shopify.eth under shopify.eth
  → Permissioned Resolver text records (ENSIP-25/26 + commerce keys)
  → EAC permissions (Shopify admin vs merchant operator)
  → Rank / select offer
  → Seller agent (ERC-8004 #6832 · Ethereum Sepolia) + settlement
  → Receipt / reputation
  → (next) World AgentKit human-backing gate on capacity + payout
```

## ENSv2 centrality

Removing ENSv2 must break merchant namespace resolution and permission demos. Labels are never a hard-coded fashion brand list; they are derived from search hits (or sequential `merchantN` for prod-style demos).

**ETHOnline:** build only against the hackathon Sepolia deployment
([deployments](https://feature-permres-inode-refact.docs-bao.pages.dev/learn/deployments#sepolia-ensv2-beta)),
not production docs. Always override viem’s Universal Resolver with
`UpgradableUniversalResolverProxy` (`0xd26f…f142`) via `src/ens/client.ts`.

Register head names in the [hackathon ENS App](https://hackathon-deployment-manager-app-v4.ens-cf.workers.dev/);
inspect via [ENS Explorer](https://hackathon-deployment-portal-app.ens-cf.workers.dev/).

**Agent trees:** `shopify.eth → agent → {merchant} → commission…` and
`dheeraj.eth → agent → intent|guardrail|payment|feedback`. Deploy nested registries with
`npm run ens:deploy`, wire with `npm run ens:live`. UI: bottom-left **ENS Tree** panel.

## Chain split

| Concern | Chain |
|---|---|
| ENSv2 registries / resolvers | Ethereum Sepolia |
| Buyer ERC-8004 | Ethereum Sepolia |
| Seller ERC-8004 + settlement USDC | Ethereum Sepolia |

ENSIP-25 uses ERC-7930 interoperable addresses so the same registry bytecode on different chains cannot satisfy the wrong verification key.

## Module map

```
src/
  config/           env + chain helpers
  ens/              slug, ERC-7930, records, lazy ensure, liveRegistry writes
  identity/         buyer + seller ERC-8004 views
  ucp/              Shopify catalog discovery
  agentkit/         (next) World human-backing
  orchestrator/     (next) capacity + incentive gates
  x402/             (next) Base settlement helpers
ens-contracts/      minimal ShopifyUserRegistry + PermissionedCommerceResolver
ui/                 split buyer / seller demo
cli/serve.ts        local demo server
cli/ens-live-setup.ts  wire subregistry + EAC allow/deny
```

## EAC demo (live)

- Shopify admin: full control under `shopify.eth` (resolver `admin`)
- Merchant operator: may edit keys granted via `authorizeTextRoles` (e.g. `agent-endpoint[web]`)
- Denied: keys not authorized (e.g. `ensip25-registration` / ENSIP-25 registration keys)
- CLI: `npm run ens:live` → allow tx + deny revert proof
