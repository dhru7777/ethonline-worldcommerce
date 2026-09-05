/**
 * Canonical ENSv2 agent namespace trees for demo + UI.
 * Merchants are search-driven (not a fixed brand list).
 * Explorer: https://hackathon-deployment-portal-app.ens-cf.workers.dev/
 */

export const ENS_EXPLORER =
  "https://hackathon-deployment-portal-app.ens-cf.workers.dev";

export type EnsTreePerm = {
  can: string[];
  deny: string[];
};

export type EnsTreeNode = {
  id: string;
  name: string;
  role: string;
  task: string;
  live?: boolean;
  placeholder?: boolean;
  explorerUrl?: string;
  perms: EnsTreePerm;
  children?: EnsTreeNode[];
};

export type EnsForest = {
  buyer: EnsTreeNode;
  seller: EnsTreeNode;
  legend: { can: string; deny: string; note: string };
  explorer: string;
};

function explorerUrl(name: string): string {
  return `${ENS_EXPLORER}/${encodeURIComponent(name)}`;
}

export function buildEnsForest(opts?: {
  /** Live merchants from this session's UCP search (preferred). */
  merchantLabels?: { label: string; title: string }[];
  /** Attach commission leaf under this merchant label when present. */
  commissionOn?: string;
}): EnsForest {
  const live = opts?.merchantLabels?.filter((m) => m.label) || [];
  const commissionOn = opts?.commissionOn || (live[0]?.label ?? "");

  let sellerMerchants: EnsTreeNode[];

  if (live.length) {
    sellerMerchants = live.map((m, i) => {
      const ensName = `${m.label}.agent.shopify.eth`;
      const node: EnsTreeNode = {
        id: `merchant-${m.label}`,
        name: ensName,
        role: `merchant · #${i + 1}`,
        task: `${m.title} · UCP hit · ENSIP-25/26`,
        live: true,
        explorerUrl: explorerUrl(ensName),
        perms: {
          can: ["agent-endpoint[web]", "agent-context", "com.worldcommerce.*"],
          deny: ["ensip25-registration", "commission.*"],
        },
        children: [],
      };
      if (commissionOn && m.label === commissionOn) {
        const cName = `commission.${m.label}.agent.shopify.eth`;
        node.children = [
          {
            id: `commission-${m.label}`,
            name: cName,
            role: "commission",
            task: "BPS · payout split · incentive release",
            live: true,
            explorerUrl: explorerUrl(cName),
            perms: {
              can: ["com.worldcommerce.commission", "com.worldcommerce.payout"],
              deny: ["agent-endpoint[*]", "ensip25-registration", "spend"],
            },
          },
        ];
      }
      return node;
    });
  } else {
    // Template — filled when a search returns merchants
    sellerMerchants = [
      {
        id: "merchant-placeholder",
        name: "{merchantId}.agent.shopify.eth",
        role: "merchant · dynamic",
        task: "Created from live UCP search — not a fixed brand list",
        placeholder: true,
        live: false,
        perms: {
          can: ["agent-endpoint[web]", "agent-context"],
          deny: ["ensip25-registration"],
        },
        children: [
          {
            id: "commission-placeholder",
            name: "commission.{merchantId}.agent.shopify.eth",
            role: "commission",
            task: "Demo leaf under first merchant when registered live",
            placeholder: true,
            live: false,
            perms: {
              can: ["com.worldcommerce.commission"],
              deny: ["ensip25-registration"],
            },
          },
        ],
      },
    ];
  }

  return {
    explorer: ENS_EXPLORER,
    legend: {
      can: "EAC allow",
      deny: "EAC deny",
      note: "Expand a row for task · permissions · explorer",
    },
    buyer: {
      id: "dheeraj",
      name: "dheeraj.eth",
      role: "human owner",
      task: "Root admin · wallet USDC · grant/revoke agent roles",
      live: true,
      explorerUrl: explorerUrl("dheeraj.eth"),
      perms: {
        can: ["ROOT · all keys", "setSubregistry", "authorize*"],
        deny: [],
      },
      children: [
        {
          id: "buyer-agent",
          name: "agent.dheeraj.eth",
          role: "buyer head",
          task: "Orchestrates purchase agents under one namespace",
          live: true,
          explorerUrl: explorerUrl("agent.dheeraj.eth"),
          perms: {
            can: ["agent-context", "ENSIP-25 bind"],
            deny: ["direct USDC without payment agent"],
          },
          children: [
            {
              id: "intent",
              name: "intent.agent.dheeraj.eth",
              role: "intent",
              task: "Capture & clarify — date night, budget, vibe",
              live: true,
              explorerUrl: explorerUrl("intent.agent.dheeraj.eth"),
              perms: {
                can: ["agent-context", "com.worldcommerce.intent"],
                deny: ["payment.*", "ensip25-registration", "spend"],
              },
            },
            {
              id: "guardrail",
              name: "guardrail.agent.dheeraj.eth",
              role: "guardrail",
              task: "Budget · merchant quality · human approve/reject",
              live: true,
              explorerUrl: explorerUrl("guardrail.agent.dheeraj.eth"),
              perms: {
                can: ["com.worldcommerce.guardrail", "com.worldcommerce.approval"],
                deny: ["spend", "rewrite intent after lock"],
              },
            },
            {
              id: "payment",
              name: "payment.agent.dheeraj.eth",
              role: "payment",
              task: "MockUSDC settle · receipts · commission read",
              live: true,
              explorerUrl: explorerUrl("payment.agent.dheeraj.eth"),
              perms: {
                can: ["com.worldcommerce.receipt", "spend (wallet policy)"],
                deny: ["change ENSIP-25", "forge feedback"],
              },
            },
            {
              id: "feedback",
              name: "feedback.agent.dheeraj.eth",
              role: "feedback",
              task: "ERC-8004 reputation → seller agent",
              live: true,
              explorerUrl: explorerUrl("feedback.agent.dheeraj.eth"),
              perms: {
                can: ["com.worldcommerce.feedback", "8004 giveFeedback"],
                deny: ["payment keys", "raise budget"],
              },
            },
          ],
        },
      ],
    },
    seller: {
      id: "shopify",
      name: "shopify.eth",
      role: "platform owner",
      task: "Head registry · setSubregistry · Shopify agent #6832",
      live: true,
      explorerUrl: explorerUrl("shopify.eth"),
      perms: {
        can: ["ROOT · all keys", "setSubregistry", "authorize*"],
        deny: [],
      },
      children: [
        {
          id: "seller-agent",
          name: "agent.shopify.eth",
          role: "seller head",
          task: "Merchant namespace hub — labels from live search",
          live: true,
          explorerUrl: explorerUrl("agent.shopify.eth"),
          perms: {
            can: ["register merchants", "agent-context"],
            deny: ["buyer wallet spend"],
          },
          children: sellerMerchants,
        },
      ],
    },
  };
}
