# ENS product feedback (ENSv2 Sepolia hackathon)

## Index


| Section                                                                         | What it is                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [1. Context](#1-context)                                                        | What I built on ENSv2 and why I left the App            |
| [2. Disclaimer](#2-disclaimer)                                                  | Must-have vs could-have for **my** agent namespaces     |
| [3. Actionables](#3-actionables-what-would-make-ens-useful-for-agent-commerce)  | What to ship so agents can live under names + EAC       |
| [3.1 EOA register](#31-eoa-commitreveal-as-the-default-path-must-have)          | Skip HCA. Quote ETHRegistrar on Sepolia                 |
| [3.2 Fix or kill HCA pay](#32-fix-or-disable-hca-quoting-must-have)             | “No spend amount” is a blocker, not a hint              |
| [3.3 Factory / resolver deploy](#33-userregistry-initialize--gas-cap-must-have) | `initialize` + 21M gas hardcode                         |
| [3.4 Agent namespace cookbook](#34-agent-namespace--eac-cookbook-must-have)     | Trees, ENSIP-25/26, revoke = agent stops                |
| [3.5 Could-have](#35-could-have-still-for-hackathon-teams)                      | Docs pin, explorer for nested registries, prod timeline |
| [4. Problems](#4-problems-i-hit-discord--this-repo)                             | App, HCA, factory, docs, mapped to 3.x                  |
| [5. What worked](#5-what-was-actually-usable)                                   | Direct registrar + my own nested registries + EAC       |


Jump by problem:

1. [HCA: destination-chain balance / no spend amount](#41-hca-registration-fails-on-sepolia)
2. [App quoter cannot compute spend](#42-the-app-cannot-compute-what-to-spend)
3. [Only contract path works](#43-the-workaround-is-skip-the-app)
4. [Deploy resolver: 21M gas](#44-deploy-resolver-gas-limit-21m-above-rpc-cap)
5. [deployProxy initialize is wrong](#45-deployproxy-initialize-payload-does-not-match-the-impl)
6. [Official UserRegistryImpl unusable](#46-hackathon-userregistryimpl-has-no-initialize)
7. [Wrong Universal Resolver if you follow prod docs](#47-viem--prod-docs-resolve-the-wrong-tree)
8. [No official agent tree recipe](#48-nested-agent-trees-are-undocumented)
9. [EAC / ENSIP questions from other teams](#49-eac-and-agent-text-keys-are-the-right-model-and-not-in-the-app)
10. [Explorer shows 0 subnames on live trees](#410-explorer-shows-0-subnames--records-even-when-the-tree-is-live)
11. [Custom registries need explorer event shims](#411-custom-userregistry-must-speak-explorer-dialect)
12. [PublicResolver cannot hold agent text](#412-publicresolver-settext-is-the-wrong-tool-for-agent-trees)
13. [Deep links for judges](#413-records--addrnames-deep-links-are-how-you-prove-the-tree)

---



## 1. Context

I built **worldCommerce**. Buyer roles live under `dheeraj.eth` (`intent`, `guardrail`, `payment`, `feedback`). Merchants live under `agent.shopify.eth`. Commission is a leaf (`commission.{merchant}.agent.shopify.eth`). Text is ENSIP-25/26 plus commerce keys. EAC is how Shopify admin vs merchant operator is split.

ENS is the naming and permission half of the product. World AgentKit is the human-backing half. If ENSv2 does not resolve, the demo is a chat UI.

I funded an EOA with Sepolia ETH + MockUSDC (`0xcbfd…6f05`). I funded HCA `0xA54465eFAF8E70A0Df12De6…` with 0.05 ETH + 60 MockUSDC. Session `chainId` was `11155111` (Sepolia), not a separate L2.

The hackathon App kept failing. I registered `shopify.eth` / `dheeraj.eth` with commit–reveal against `ETHRegistrar` (`cli/register-eth-name.ts`). Nested trees use my own `ShopifyUserRegistry` + `PermissionedCommerceResolver` because the published `UserRegistryImpl` does not `initialize`. Simon (Web3-Degens) hit the same wall and told others to skip the App and call the contract.

This writeup is that path, plus what other teams posted in the same Discord (Tushar: 21M gas + bad `initialize`; Berkin: EAC + agent text keys).

## 2. Disclaimer

This is not a review of production ENS.

It is what blocked **agent commerce namespaces** on the ETHOnline Sepolia ENSv2 deployment, ranked as:

- **Must have** for my use case: without this, I cannot mint a head name or hang an agent tree under it.
- **Could have** for my use case: I shipped a workaround. Mentors should own it so the next team does not lose a day.

I am not asking for mainnet ENSv2 this weekend. I am asking for a register path that matches the chain the App already shows (`11155111`), a factory that matches its implementation, and a written recipe for agent subnames + EAC.

---



## 3. Actionables: what would make ENS useful for agent commerce

Agent commerce needs three ENS jobs: **get a name**, **put an agent tree under it**, **revoke the agent’s write keys so it stops**. The App currently fails at job 1. I rebuilt jobs 2 and 3 in `ens-contracts/`.

### 3.1 EOA commit–reveal as the default path (must have)

Put “Register with your EOA on Sepolia” on the first screen. Call `ETHRegistrar.getRegisterPrice(label, duration, MockUSDC)`, approve, `commit`, wait `MIN_COMMITMENT_AGE`, `register`. Same ABI I used in `cli/register-eth-name.ts`.

**Example.** I asked: is unsponsored HCA broken, or is there a non-HCA path? There is a path. It is the registrar. The App does not offer it. I had to write a script. Simon did the same.

**Ship.** In-App EOA flow + a 20-line snippet in the hackathon docs (registrar, MockUSDC, PublicResolverV2, commit–reveal). Label it “if the App quote fails, do this.”

### 3.2 Fix or disable HCA quoting (must have)

Until HCA quoting works on **Sepolia as Sepolia**, hide it. Do not send teams into a destination-chain gas-refund model on `chainId 11155111`.

Errors I hit:

1. `no destination-chain balance… gas refund`
2. Then: `quote returned no spend amount`

Likely causes I already wrote in Discord: wrong/unsupported payment token for the quoter, a new session account that is not the HCA I funded, or a broken fallback quote. Other people funded the same way and still died.

**Ship.** Either quote MockUSDC on the registrar for the **same** address the UI shows as funded, or disable HCA and point at [3.1](#31-eoa-commitreveal-as-the-default-path-must-have). Log `paymentToken`, `payer`, `chainId`, `quotedAmount` in the App error. “Can’t compute what to spend” is not a diagnosis.

### 3.3 UserRegistry `initialize` + gas cap (must have)

Tushar: every register dies at “Deploy resolver”:

`RPC eth_sendRawTransaction: gas limit too high (cap: 16777216, tx: 21000000)`

Same on MetaMask/Infura, Alchemy, and a public Sepolia RPC. That is an App hardcode of 21M, above the 16.7M cap.

He also decoded `deployProxy`: malformed `initialize` payload, implementation does not expose that selector, first arg looks like an unfilled EOA placeholder.

My repo comment is the same bug from the other side: `Hackathon UserRegistryImpl has no initialize — we use ens-contracts instead.`

**Ship.**

- Gas limit ≤ 16M (or `eth_estimateGas`). Never 21M.
- `UserRegistryImpl` / `PermissionedResolver` `initialize` must match what the App encodes. If the impl has no `initialize`, do not call `deployProxy` with one.
- Publish a known-good factory call (or “deploy your own IRegistry, then `setSubregistry` on the `.eth` token”) so teams do not reverse-engineer a revert.



### 3.4 Agent namespace + EAC cookbook (must have)

This is the ENS half of agent commerce. A name is not enough. I need a tree and a revoke switch.

Recommended shape (what I shipped):

```text
{human}.eth
  └── agent
        ├── intent | guardrail | payment | feedback

{platform}.eth
  └── agent
        └── {merchant}
              └── commission
```

**EAC.** Berkin asked: agent may only update a heartbeat text record; if the owner revokes, the agent cannot write and stops. **Yes. That is the right model.** I do the same: Shopify admin full control; merchant may edit `agent-endpoint[web]`; merchant must not edit `ensip25-registration` or `commission.`*. Revoke = operator stops. Document it as the agent access-control recipe, not a forum answer.

**Text keys.** Do not invent `agent.model` / `agent.prompt` as the standard. Use:


| Key                                        | Spec     | Role                            |
| ------------------------------------------ | -------- | ------------------------------- |
| `agent-context`                            | ENSIP-26 | What this agent is              |
| `agent-endpoint[web]` / `[mcp]` / `[a2a]`  | ENSIP-26 | How to call it                  |
| `agent-registration[{erc7930}][{agentId}]` | ENSIP-25 | Bind to ERC-8004 (chain-scoped) |
| app keys (`com.*`)                         | project  | Payment, commission bps, UCP    |


**Ship.** One cookbook page: nested `UserRegistry`, `setSubregistry` / `setResolver` on the head token, `authorizeTextRoles` allow + a deny revert proof. That is the “agent scope” ENS can actually enforce today. World should hold the spend mandate. ENS should hold **who may write which records**.

### 3.5 Could-have, still for hackathon teams

- Banner on the App and Explorer: **ETHOnline Sepolia ENSv2, not production ENS.** Always override viem’s Universal Resolver with `UpgradableUniversalResolverProxy` (`0xd26f…f142`). I put that in `src/ens/client.ts` after resolution hit the wrong tree.
- Explorer should show nested registries I `setSubregistry`’d, not only names minted in the App — and must not show **0 Subnames** when a subregistry is set (see [4.10](#410-explorer-shows-0-subnames--records-even-when-the-tree-is-live)).
- Publish the **event / IERC interface checklist** custom registries must implement for the Explorer (see [4.11](#411-custom-userregistry-must-speak-explorer-dialect)).
- One sentence on prod / other L2s (Arc, etc.): “not this deployment.” Do not let that thread eat mentor time during the hackathon.
- Manager App vs Explorer are two workers.dev hosts. One entry URL. I mixed them in Discord already.
- Shareable deep links after mint: name, `/records`, `/addr/{owner}/names` (see [4.13](#413-records--addrnames-deep-links-are-how-you-prove-the-tree)).

---



## 4. Problems I hit (this repo)

Each item maps back to [section 3](#3-actionables-what-would-make-ens-useful-for-agent-commerce).

### 4.1 HCA registration fails on Sepolia.

**Must have.** Maps to [3.2](#32-fix-or-disable-hca-quoting-must-have) and [3.1](#31-eoa-commitreveal-as-the-default-path-must-have).

Funded EOA + HCA. Session `chainId` `11155111`. Errors: destination-chain balance / gas refund, then quote with no spend amount. Unsponsored HCA on Sepolia is acting like an L2 paymaster path. This chain is not that.

### 4.2 The App cannot compute what to spend.

**Must have.** Maps to [3.2](#32-fix-or-disable-hca-quoting-must-have).

“The App can’t compute what to spend” is a quoter miss: token, payer, or fallback. MockUSDC on the registrar **does** return `getRegisterPrice`. I printed it in the CLI. The App is not calling the same thing the contract answers.

### 4.3 The workaround is skip the App.

**Must have** to document. Maps to [3.1](#31-eoa-commitreveal-as-the-default-path-must-have).

Simon: broken payment layer in the App; go to the contract. I did: `npx tsx cli/register-eth-name.ts shopify`. That should be official, not tribal knowledge.

### 4.4 Deploy resolver: gas limit 21M above RPC cap.

**Must have.** Maps to [3.3](#33-userregistry-initialize--gas-cap-must-have).

Tushar, three RPCs, `onchain-heartbeat.eth`, App `hackathon-deployment-portal-app.ens-cf.workers.dev`. Cap 16,777,216. Tx 21,000,000. Estimate or 16M. Never 21M.

### 4.5 deployProxy initialize payload does not match the impl.

**Must have.** Maps to [3.3](#33-userregistry-initialize--gas-cap-must-have).

Malformed `initialize`, selector missing on the implementation, first arg an empty EOA placeholder. The App is encoding a constructor story the bytecode does not have.

### 4.6 Hackathon UserRegistryImpl has no initialize.

**Must have.** Maps to [3.3](#33-userregistry-initialize--gas-cap-must-have) and [3.4](#34-agent-namespace--eac-cookbook-must-have).

I stopped using `0x47b442…` as a factory clone. I deploy `ShopifyUserRegistry` myself and `setSubregistry` on the `shopify.eth` / `dheeraj.eth` token. That should not be required to get a nested agent name.

### 4.7 viem / prod docs resolve the wrong tree.

**Could have** (must have in the README of the hackathon). Maps to [3.5](#35-could-have-still-for-hackathon-teams).

If I do not override `ensUniversalResolver` to `0xd26f…f142`, I am not on this deployment. Feature-branch docs vs ens.domains. Two sources of truth.

### 4.8 Nested agent trees are undocumented.

**Must have** for the track. Maps to [3.4](#34-agent-namespace--eac-cookbook-must-have).

`shopify.eth → agent → lindt → commission` is the product. Deploy + `ens:live` is a lot of txs I reverse-engineered. A cookbook would have saved a day and stopped teams from putting a single flat name on a landing page.

### 4.9 EAC and agent text keys are the right model, and not in the App.

**Must have** as docs. Maps to [3.4](#34-agent-namespace--eac-cookbook-must-have).

Berkin’s Capsule questions are the same design I used. Heartbeat-only write + revoke to halt the agent: recommended. Keys: ENSIP-26 endpoints/context, ENSIP-25 registration with ERC-7930, not ad-hoc `agent.prompt`. The App does not help you set EAC or those keys. I did it in `npm run ens:live` (allow tx + deny revert).

### 4.10 Explorer shows 0 subnames / records even when the tree is live.

**Must have** for the Explorer. Maps to [3.5](#35-could-have-still-for-hackathon-teams) and [3.4](#34-agent-namespace--eac-cookbook-must-have).

After `setSubregistry` + live `register` under my nested registries, `shopify.eth` / `dheeraj.eth` / `agent.dheeraj.eth` still showed **0 Subnames** (and thin Records) in the hackathon Explorer for a long time. On-chain the tree was real. The Explorer indexes **official PermissionedRegistry / ERC-1155 style events**, not an arbitrary `LabelRegistered` from a minimal IRegistry.

That is a product bug for agent demos: judges open the Explorer, see zeros, and assume ENS is fake. My UI had to say “verify via Subregistry address / deep links,” then I redeployed explorer-compatible registries just so the portal would light up.

**Ship.** Either (a) document the exact event/interface surface the Explorer indexes and require custom registries to emit it, or (b) walk `getSubregistry` / ownership and show children even when events differ. A “0 subnames” badge on a parent with a non-zero subregistry is worse than “unknown.”

### 4.11 Custom UserRegistry must speak Explorer dialect.

**Must have** once you leave the App factory. Maps to [3.3](#33-userregistry-initialize--gas-cap-must-have) and [3.5](#35-could-have-still-for-hackathon-teams).

Missing `initialize` forced me off `UserRegistryImpl`. Getting names to *appear* in the Explorer forced a second round of work: shims for `findOwner` / `IOwnedRegistry` (`0x63560a8e`), `ownerOf`, `getStatus`, official `LabelRegistered` / `SubregistryUpdated`, and on the resolver side official `TextChanged` + `supportsInterface` (including PermissionedResolver `0x91413117`).

So the cookbook is not only “deploy IRegistry + setSubregistry.” It is “deploy a registry the **Explorer can index**,” or teams will ship a working tree that looks empty in the only judge UI that matters.

### 4.12 PublicResolver setText is the wrong tool for agent trees.

**Must have** in the cookbook. Maps to [3.4](#34-agent-namespace--eac-cookbook-must-have).

I hit blocked / useless `PublicResolver` text writes for agent commerce keys. The working path was: deploy `PermissionedCommerceResolver`, `ETH.setResolver` (or equivalent) on the parent name, then EAC `authorizeTextRoles` + `setText`. Without that, ENSIP-25/26 and `com.worldcommerce.*` never stick where the Explorer’s Records tab can show them.

Document: head names minted via registrar ≠ agent text home. Point the name at a permissioned resolver before promising Records in the portal.

### 4.13 Records + `/addr/…/names` deep links are how you prove the tree.

**Could have** → **must have** for demos. Maps to [3.5](#35-could-have-still-for-hackathon-teams).

Name pages alone are not enough when Subnames counters lag. What actually helped in the live demo:


| Link                                              | Why                                  |
| ------------------------------------------------- | ------------------------------------ |
| `…/shopify.eth` · `…/dheeraj.eth`                 | Parent identity                      |
| `…/shopify.eth/records` · `…/dheeraj.eth/records` | ENSIP + commerce text                |
| `…/addr/0xCD64…9D91/names`                        | Wallet → names owned (buyer / human) |


Ship these as first-class Explorer share URLs (and in the App after register). My ENS Tree FAB links them because without Records + addr/names, judges only see the zeroed Subnames tab.

---



## 5. What was actually usable

- `ETHRegistrar` on Sepolia: `isAvailable`, `getRegisterPrice`, commit–reveal, MockUSDC pay. This is the real register API.
- Head names once minted: `setSubregistry` / `setResolver` on the `.eth` token.
- Permissioned resolver EAC: grant `agent-endpoint[web]`, deny `ensip25-registration` / `commission.*`, catch `EACUnauthorized`.
- Explorer for names that exist — **after** registries emit the events/interfaces it indexes (otherwise Subnames stay at 0).
- Records + addr/names deep links once resolvers and ownership shims are in place.
- ENSIP-25/26 as the agent record layer.

What was not usable: the App payment/HCA layer, `UserRegistryImpl` via the App factory, 21M gas, production ENS docs for this deployment, PublicResolver as the agent text home, and the Explorer’s Subnames counter against a minimal custom IRegistry.

For agent commerce, ENS should be the **scope of write**: which agent may touch which records, under which parent, until the human revokes. That is already in EAC if the factory and the App let me on the tree. Registration should be a boring EOA tx on Sepolia. I should not need a Discord thread and a custom registrar script to get `shopify.eth` — and I should not need a second registry rewrite so the Explorer stops lying with **0 subnames**.