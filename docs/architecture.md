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
  → Seller agent (ERC-8004 #6832 · Base Sepolia) + x402 incentive
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

## Chain split

| Concern | Chain |
|---|---|
| ENSv2 registries / resolvers | Ethereum Sepolia |
| Buyer ERC-8004 | Ethereum Sepolia |
| Seller ERC-8004 + x402 USDC | Base Sepolia |

ENSIP-25 uses ERC-7930 interoperable addresses so the same registry bytecode on different chains cannot satisfy the wrong verification key.

## Module map

```
src/
  config/           env + chain helpers
  ens/              slug, ERC-7930, records, lazy namespace ensure
  identity/         buyer + seller ERC-8004 views
  ucp/              Shopify catalog discovery
  agentkit/         (next) World human-backing
  orchestrator/     (next) capacity + incentive gates
  x402/             (next) Base settlement helpers
ui/                 split buyer / seller demo
cli/serve.ts        local demo server
```

## EAC demo (planned live)

- Shopify admin: full control under `shopify.eth`
- Merchant operator: may edit `agent-endpoint[*]` and `com.worldcommerce.*`
- Denied: changing ENSIP-25 `agent-registration[…][…]` keys
