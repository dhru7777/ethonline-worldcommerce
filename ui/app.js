const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

let identities = null;
let ensNames = {
  buyer: "agent.dheeraj.eth",
  buyerRegistry: "dheeraj.eth",
  shopifyAgent: "agent.shopify.eth",
  root: "shopify.eth",
};
/** ens (lowercase) → wallet address for ⓘ tips */
const ensAddrBook = Object.create(null);
let intentSessionId = null;
let clarifying = false;
let busy = false;
let lastChoiceSet = [];
let pendingOffer = null;
let commissionBps = 170;

const profileCache = { buyer: null, seller: null };
const profileTab = { buyer: "identity", seller: "identity" };
const walletCache = { buyer: null, seller: null };
/** Demo ledger — last 3 shown per wallet, keyed by role perspective. */
const txLedger = { buyer: [], seller: [] };

const PROFILE_TABS = [
  { id: "identity", label: "ID" },
  { id: "ranking", label: "Rank" },
  { id: "feedback", label: "Feedback" },
  { id: "verify", label: "Verify" },
];

function buyerLabel() {
  return "Buyer Agent";
}

function shopifyLabel() {
  return "Shopify Agent";
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function shortHash(hash) {
  if (!hash) return "";
  const h = String(hash);
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

function shortAddr(addr) {
  if (!addr) return "—";
  const a = String(addr);
  if (a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function pushTx(role, tx) {
  txLedger[role].unshift(tx);
  if (txLedger[role].length > 12) txLedger[role].length = 12;
}

function txLineHtml({ dir, amount, fromEns, toEns, via, title, hash, explorer }) {
  const cls = dir === "in" ? "tx-in" : "tx-out";
  const sign = dir === "in" ? "+" : "−";
  const viaLine = via ? `<div class="tx-dir">via ${ensChip(via)}</div>` : "";
  const hashLine = hash
    ? `<a href="${esc(explorer || `https://sepolia.etherscan.io/tx/${hash}`)}" target="_blank" rel="noreferrer" title="${esc(hash)}">${esc(shortHash(hash))}</a>`
    : "";
  return `<span class="${cls}">${sign}$${esc(amount)} USDC</span>
    <div class="tx-dir">${ensChip(fromEns)} → ${ensChip(toEns)}</div>
    ${viaLine}
    ${title ? `${esc(title)}<br/>` : ""}${hashLine}`;
}

function renderTxList(role) {
  const txs = txLedger[role].slice(0, 3);
  if (!txs.length) return `<div class="tx-empty">No transactions yet</div>`;
  return txs
    .map((tx) => {
      const cls = tx.dir === "in" ? "tx-in" : "tx-out";
      const sign = tx.dir === "in" ? "+" : "−";
      const href = esc(tx.explorer || "#");
      return `<div class="tx-row">
        <div class="${cls}">${sign}$${esc(tx.amount)} · ${esc(tx.label || "USDC")}</div>
        <div class="tx-dir">${esc(tx.fromEns)} → ${esc(tx.toEns)}</div>
        ${tx.via ? `<div class="tx-dir">via ${esc(tx.via)}</div>` : ""}
        <div class="tx-meta"><span>${esc(tx.time || "")}</span><a href="${href}" target="_blank" rel="noreferrer">${esc(shortHash(tx.hash))}</a></div>
      </div>`;
    })
    .join("");
}

function registerEnsAddr(name, addr) {
  if (!name || !addr) return;
  ensAddrBook[String(name).toLowerCase()] = String(addr);
}

function resolveEnsAddress(name) {
  if (!name) return "";
  return ensAddrBook[String(name).toLowerCase()] || "";
}

function parentEnsFor(name) {
  const n = String(name || "").toLowerCase();
  if (n === String(ensNames.buyer).toLowerCase()) return ensNames.buyerRegistry || "dheeraj.eth";
  if (n.endsWith(".agent.shopify.eth")) {
    if (n.startsWith("commission.")) {
      const rest = n.slice("commission.".length);
      return rest; // lindt.agent.shopify.eth
    }
    return "agent.shopify.eth";
  }
  if (n.endsWith(".shopify.eth") && n !== "shopify.eth" && n !== "agent.shopify.eth") {
    return ensNames.root || "shopify.eth";
  }
  if (n === "agent.shopify.eth") return "shopify.eth";
  if (n.endsWith(".agent.dheeraj.eth")) return "agent.dheeraj.eth";
  if (n === "agent.dheeraj.eth") return ensNames.buyerRegistry || "dheeraj.eth";
  if (n === String(ensNames.buyerRegistry || "").toLowerCase()) return "eth";
  return ensNames.root || "shopify.eth";
}

/** ENS chip + ⓘ that reveals the bound address on hover / click. */
function ensChip(name, opts = {}) {
  if (!name) return "—";
  const extra = Array.isArray(opts) ? opts : opts.extra || [];
  const address = (!Array.isArray(opts) && opts.address) || resolveEnsAddress(name) || "";
  const parent = (!Array.isArray(opts) && opts.parent) || parentEnsFor(name);
  const lines = [name, parent ? `parent · ${parent}` : "", ...extra.filter(Boolean), address ? `addr · ${address}` : ""]
    .filter(Boolean);
  const tip = lines.join("\n");
  const info = address
    ? `<button type="button" class="ens-i" aria-label="Show address for ${esc(name)}" title="${esc(address)}" data-addr="${esc(address)}">i</button>
       <span class="ens-addr-tip" role="tooltip"><span class="ens-addr-label">address</span><code>${esc(address)}</code></span>`
    : "";
  return `<span class="ens-wrap" tabindex="0" title="${esc(tip)}" data-ens="${esc(name)}" data-addr="${esc(address)}">
    <span class="ens-chip">${esc(name)}</span>${info}
  </span>`;
}

function ensLinkForAddr(addr, ensPreferred) {
  if (ensPreferred) return ensChip(ensPreferred, { address: addr });
  if (!addr) return "—";
  return `<a href="https://sepolia.etherscan.io/address/${esc(addr)}" target="_blank" rel="noreferrer" title="${esc(addr)}">${esc(shortAddr(addr))}</a>`;
}

function wireEnsInfoClicks(root = document) {
  root.querySelectorAll?.(".ens-i")?.forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wrap = btn.closest(".ens-wrap");
      document.querySelectorAll(".ens-wrap.open").forEach((el) => {
        if (el !== wrap) el.classList.remove("open");
      });
      wrap?.classList.toggle("open");
    });
  });
}

function bidCents(priceCents, bps = commissionBps) {
  return Math.max(1, Math.round((priceCents * bps) / 10000));
}

function scoreLine(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  const shown = Number.isInteger(n) ? n : Math.round(n * 100) / 100;
  return `${shown} / 100`;
}

function sameChoices(a, b) {
  if (!a?.length && !b?.length) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((x, i) => String(x).toLowerCase() === String(b[i]).toLowerCase());
}

function wirePopover(wrapId, btnId, onOpen) {
  const wrap = $(wrapId);
  const btn = $(btnId);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".pop-wrap.open").forEach((el) => {
      if (el !== wrap) el.classList.remove("open");
    });
    const opening = !wrap.classList.contains("open");
    wrap.classList.toggle("open");
    if (opening && onOpen) onOpen();
  });
  wrap.querySelector(".popover")?.addEventListener("click", (e) => e.stopPropagation());
}

document.addEventListener("click", () => {
  document.querySelectorAll(".pop-wrap.open").forEach((el) => el.classList.remove("open"));
  document.querySelectorAll(".ens-wrap.open").forEach((el) => el.classList.remove("open"));
});

function litPhases(...names) {
  document.querySelectorAll(".phase-step").forEach((el) => {
    el.classList.toggle("lit", names.includes(el.dataset.phase));
  });
}

function addPhase(name) {
  document.querySelector(`.phase-step[data-phase="${name}"]`)?.classList.add("lit");
}

function setBusy(on) {
  busy = on;
  $("form").classList.toggle("is-busy", on);
}

function clearFeed(el, hint) {
  el.innerHTML = "";
  if (hint) {
    const d = document.createElement("div");
    d.className = "empty-hint";
    d.textContent = hint;
    el.appendChild(d);
  }
}

function addBubble(feed, { side, label, html, sys = false }) {
  const hint = feed.querySelector(".empty-hint");
  if (hint) hint.remove();
  const wrap = document.createElement("div");
  wrap.className = `bwrap ${side === "out" ? "sent" : side === "mid" ? "mid" : "recv"}`;
  wrap.innerHTML = `
    ${label ? `<div class="blabel">${esc(label)}</div>` : ""}
    <div class="bubble ${sys ? "sys" : side === "out" ? "out" : "inc"}">${html}</div>
  `;
  feed.appendChild(wrap);
  wireEnsInfoClicks(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  feed.scrollTop = feed.scrollHeight;
  return wrap;
}

function lockPreviousChoices(selected) {
  $("feedBuyer").querySelectorAll(".choice-chip:not(:disabled)").forEach((btn) => {
    btn.disabled = true;
    const q = String(btn.dataset.q || "").trim().toLowerCase();
    btn.classList.toggle("is-selected", Boolean(selected) && q === String(selected).trim().toLowerCase());
    btn.classList.toggle("is-spent", !btn.classList.contains("is-selected"));
  });
}

function addAgentAsk(message, options) {
  let opts = (options || []).map((o) => String(o).trim()).filter(Boolean);
  if (sameChoices(opts, lastChoiceSet)) opts = [];
  lastChoiceSet = opts;
  const chips = opts
    .map(
      (opt) =>
        `<button type="button" class="prompt-chip choice-chip" data-q="${esc(opt)}">${esc(opt)}</button>`,
    )
    .join("");
  const wrap = addBubble($("feedBuyer"), {
    side: "inc",
    label: buyerLabel(),
    html: `${esc(message)}${chips ? `<div class="choice-row">${chips}</div>` : ""}`,
  });
  wrap.querySelectorAll(".choice-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (busy) return;
      $("q").value = btn.dataset.q;
      $("form").requestSubmit();
    });
  });
}

function profileKv(label, value) {
  return `<div class="profile-kv"><span class="profile-kv-label">${esc(label)}</span><span class="profile-kv-val">${esc(value ?? "—")}</span></div>`;
}

function buildProfilePanel(tabId, data) {
  const sec = data.sections || {};
  const id = sec.identity || {};
  const rank = sec.ranking || {};
  const fb = sec.feedback || {};
  const links = (sec.verify && sec.verify.links) || [];

  if (tabId === "identity") {
    return [
      profileKv("Agent ID", `#${id.agentId ?? data.agentId}`),
      profileKv("Chain", id.chainLabel || data.chainLabel),
      profileKv("Global ID", id.globalId || data.globalId),
      profileKv("Owner", id.ownerShort || shortAddr(id.owner)),
      profileKv("Agent wallet", id.agentWalletShort || shortAddr(id.agentWallet)),
      profileKv("x402", id.x402Support ? "yes" : "no"),
      profileKv("Trust", (id.trust || []).join(", ") || "reputation"),
      profileKv("ENSIP-25", id.ensip25Key || data.ensip25Key),
    ].join("");
  }
  if (tabId === "ranking") {
    if (rank.healthScore == null && rank.popularity == null && rank.rank == null) {
      return `<div class="wallet-muted">No ranking data from 8004scan yet.</div>`;
    }
    return [
      profileKv("Network rank", rank.rank ?? rank.networkRank ?? "—"),
      profileKv("Health score", scoreLine(rank.healthScore)),
      profileKv("Popularity", scoreLine(rank.popularity)),
      profileKv("Freshness", scoreLine(rank.freshness)),
      profileKv("Metadata", scoreLine(rank.metadataCompleteness)),
      profileKv("Quality", scoreLine(rank.quality)),
      profileKv("Activity", scoreLine(rank.activity)),
    ].join("");
  }
  if (tabId === "feedback") {
    return [
      profileKv("On-chain feedbacks", fb.totalFeedbacks ?? 0),
      profileKv("Average score", scoreLine(fb.averageScore)),
      profileKv("Stars", fb.starCount ?? 0),
      profileKv("Watchers", fb.watchCount ?? 0),
      profileKv("Verified", fb.isVerified ? "yes" : "no"),
      profileKv("Publisher", fb.ownerUsername || "—"),
    ].join("");
  }
  if (tabId === "verify") {
    if (!links.length) return `<div class="wallet-muted">No verify links available.</div>`;
    return links
      .map(
        (l) =>
          `<div class="profile-kv"><span class="profile-kv-label">${esc(l.label)}</span><span class="profile-kv-val"><a href="${esc(l.url)}" target="_blank" rel="noreferrer">open ↗</a></span></div>`,
      )
      .join("");
  }
  return "";
}

function renderProfilePop(role, data, errMsg) {
  const pop = $(`${role}Popover`);
  if (!pop) return;
  if (errMsg) {
    pop.innerHTML = `<div class="pop-title">ERC-8004 · ${esc(role)} agent</div><div class="wallet-err">${esc(errMsg)}</div>`;
    return;
  }
  const active = profileTab[role] || "identity";
  const tabBar = PROFILE_TABS.map(
    (t) =>
      `<button type="button" class="wallet-tab-btn${t.id === active ? " active" : ""}" data-profile-tab="${t.id}">${t.label}</button>`,
  ).join("");
  const panels = PROFILE_TABS.map((t) => {
    const hidden = t.id !== active ? ' style="display:none"' : "";
    return `<div class="profile-tab-panel" data-profile-panel="${t.id}"${hidden}>${buildProfilePanel(t.id, data)}</div>`;
  }).join("");
  const warn =
    data.warnings?.length
      ? `<div class="wallet-muted" style="margin-top:6px">${esc(data.warnings.join("; "))}</div>`
      : "";

  pop.innerHTML = `
    <div class="pop-title">ERC-8004 · ${esc(role)} agent</div>
    <div class="pop-agent-name">${esc(data.name || "—")}</div>
    <div class="wallet-tab-bar profile-tab-bar">${tabBar}</div>
    ${panels}
    ${warn}
  `;

  pop.querySelectorAll("[data-profile-tab]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      profileTab[role] = btn.getAttribute("data-profile-tab");
      renderProfilePop(role, data);
    });
  });
}

async function loadProfile(role) {
  const pop = $(`${role}Popover`);
  pop.innerHTML = `<div class="wallet-loading">Loading 8004scan…</div>`;
  try {
    const data = await fetch(`/api/agent/${role}?t=${Date.now()}`, { cache: "no-store" }).then((r) =>
      r.json(),
    );
    if (data.error) throw new Error(data.error);
    profileCache[role] = data;
    renderProfilePop(role, data);
  } catch (e) {
    renderProfilePop(role, null, e.message || String(e));
  }
}

function renderWalletPop(role, data, errMsg) {
  const pop = $(`${role}WalletPop`);
  if (!pop) return;
  if (errMsg) {
    pop.innerHTML = `<div class="wallet-pop-title">Wallet</div><div class="wallet-err">${esc(errMsg)}</div>`;
    return;
  }
  const eth = data.balances?.ETH?.formatted ?? "—";
  const usdc = data.balances?.USDC?.formatted ?? "—";
  const titleEns = role === "buyer" ? ensNames.buyer : ensNames.shopifyAgent;
  const headNote =
    role === "seller"
      ? `<div class="wallet-muted">head registry · merchants resolve under ${esc(ensNames.root)}</div>`
      : role === "buyer"
        ? `<div class="wallet-muted">parent registry · ${esc(ensNames.buyerRegistry)}</div>`
        : "";
  const err =
    data.errors?.length
      ? `<div class="wallet-err">${esc(data.errors.join("; "))}</div>`
      : "";

  pop.innerHTML = `
    <div class="wallet-pop-title">Wallet</div>
    <div class="wallet-addr-row">
      ${ensChip(titleEns, { address: data.address, extra: role === "seller" ? ["Shopify head"] : ["Buyer agent"] })}
      ${headNote}
    </div>
    <div class="wallet-bal-row"><span>ETH</span><span class="wallet-bal-val">${esc(eth)}</span></div>
    <div class="wallet-bal-row"><span>USDC</span><span class="wallet-bal-val">${esc(usdc)}</span></div>
    <div class="tx-section-title">Last 3 transactions</div>
    ${renderTxList(role)}
    <div class="wallet-muted" style="margin-top:8px">${esc(data.network)} · ${esc(data.caip2)}</div>
    ${err}
  `;
  wireEnsInfoClicks(pop);
}

async function loadWallet(role) {
  const pop = $(`${role}WalletPop`);
  pop.innerHTML = `<div class="wallet-loading">Loading balances…</div>`;
  try {
    const data = await fetch(`/api/wallet/${role}?t=${Date.now()}`, { cache: "no-store" }).then((r) =>
      r.json(),
    );
    if (data.error) throw new Error(data.error);
    walletCache[role] = data;
    renderWalletPop(role, data);
  } catch (e) {
    renderWalletPop(role, null, e.message || String(e));
  }
}

/** Staggered offers — merchant ENS under shopify.eth; ⓘ shows payTo address. */
async function renderProductsStaggered(offers) {
  const feed = $("feedSeller");
  clearFeed(feed);
  const status = document.createElement("div");
  status.className = "merchant-status";
  status.innerHTML = `UCP · ${offers.length} offers · ${ensChip(ensNames.root, { extra: ["Shopify head registry"] })}`;
  feed.appendChild(status);
  wireEnsInfoClicks(status);

  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i];
    const row = document.createElement("div");
    row.className = `product-row${i === 0 ? " lead-bid" : ""}`;
    const img = offer.imageUrl
      ? `<img class="p-ph" src="${esc(offer.imageUrl)}" alt="" onerror="this.style.visibility='hidden'" />`
      : `<div class="p-ph"></div>`;
    const ensName = offer.ens?.ensName || `${String(offer.merchantName || "merchant").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.agent.shopify.eth`;
    if (offer.merchantPayTo) registerEnsAddr(ensName, offer.merchantPayTo);
    const bid = (bidCents(offer.priceCents) / 100).toFixed(2);
    const mode = offer.ens?.writeMode || "dry-run";
    row.innerHTML = `
      ${img}
      <div>
        <div class="p-vendor">${esc(offer.merchantName)}</div>
        <div class="p-title">${esc(offer.title)}</div>
        <div class="p-price">$${(offer.priceCents / 100).toFixed(2)}</div>
      </div>
      <div class="p-bid">
        ${ensChip(ensName, {
          address: offer.merchantPayTo,
          extra: [`mode · ${mode}`, "under agent.shopify.eth", "ENSIP-26 + EAC"],
        })}
        <span class="bid-amt">$${esc(bid)} bid</span>
      </div>
    `;
    feed.appendChild(row);
    wireEnsInfoClicks(row);
    await sleep(480);
    row.classList.add("show");
    if (i === 0) row.classList.add("glow");
    feed.scrollTop = feed.scrollHeight;
  }
}

function nhcCents(priceCents, bps = 170) {
  return Math.max(1, Math.round(priceCents * (1 - bps / 10000)));
}

async function fetchAgentKit() {
  try {
    const v = await fetch("/api/agentkit/verify", { cache: "no-store" }).then((r) => r.json());
    return v;
  } catch {
    return {
      isHumanBacked: false,
      capacityTier: "manual-approval-required",
      failureReason: "AgentKit unreachable",
      checkedVia: "pending",
    };
  }
}

async function showGuardrailsAndApproval(offers, parsed) {
  if (!offers?.length) return;
  const pick = offers[0];
  pendingOffer = pick;
  const budget = parsed?.maxPriceCents
    ? `$${(parsed.maxPriceCents / 100).toFixed(0)}`
    : "none";
  const price = (pick.priceCents / 100).toFixed(2);
  const nhc = (nhcCents(pick.priceCents) / 100).toFixed(2);
  const pickEns = pick.ens?.ensName || "merchant.agent.shopify.eth";

  addPhase("guardrails");

  const ak = await fetchAgentKit();
  const capacityLine = ak.isHumanBacked
    ? `capacity: ok · tier ${ak.capacityTier}`
    : `capacity: HOLD · ${ak.capacityTier}`;

  addBubble($("feedBuyer"), {
    side: "inc",
    label: "worldAgent",
    html: ak.isHumanBacked
      ? `AgentBook · human-backed ✓ · ${esc(ak.checkedVia)} · tier ${esc(ak.capacityTier)} · ${ensChip(ensNames.buyer, ["Buyer Agent primary name"])}`
      : `AgentBook · not human-backed · commission will hold<br/><span class="wallet-muted">${esc(ak.failureReason || "")}</span>`,
  });

  addBubble($("feedBuyer"), {
    side: "inc",
    label: buyerLabel(),
    html: `<div>Guardrails:</div><div class="guard-lines">  budget ≤ ${esc(budget)}
  MCC allowed
  domain policy: pass
  ${esc(capacityLine)}</div>`,
  });

  addBubble($("feedBuyer"), {
    side: "inc",
    label: buyerLabel(),
    html: `Agent pick: <b>${esc(pick.title)}</b><br/>Price $${esc(price)} · NHC $${esc(nhc)}<br/>${ensChip(pickEns, ["merchant leaf under shopify.eth"])}`,
  });

  // Human approval on the right (HITL)
  const wrap = addBubble($("feedBuyer"), {
    side: "out",
    label: "human",
    html: `Approve <b>${esc(pick.title)}</b> for $${esc(price)}?
      ${!ak.isHumanBacked ? `<div class="wallet-muted" style="margin-top:6px">Note: commission held until human-backed</div>` : ""}
      <div class="approve-row">
        <button type="button" class="approve-btn" data-decision="approve">Approve</button>
        <button type="button" class="approve-btn reject" data-decision="reject">Reject</button>
      </div>`,
  });

  wrap.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (busy) return;
      const decision = btn.dataset.decision;
      wrap.querySelectorAll(".approve-btn").forEach((b) => {
        b.disabled = true;
      });
      if (decision !== "approve") {
        pendingOffer = null;
        addBubble($("feedBuyer"), {
          side: "inc",
          label: buyerLabel(),
          html: "Rejected — say another product or budget to search again.",
        });
        return;
      }

      addBubble($("feedBuyer"), {
        side: "out",
        label: "you",
        html: "Agent pick approved",
      });
      addPhase("payout");
      setBusy(true);
      try {
        addBubble($("feedBuyer"), {
          side: "inc",
          label: buyerLabel(),
          html: `Paying MockUSDC on Sepolia · $${esc(price)} → ${ensChip(pickEns)}…`,
        });
        addBubble($("feedSeller"), {
          side: "inc",
          label: shopifyLabel(),
          html: `Settlement started · ${ensChip(pickEns)} via ${ensChip(ensNames.shopifyAgent)}`,
          sys: true,
        });

        const res = await fetch("/api/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            priceCents: pick.priceCents,
            title: pick.title,
            ensName: pick.ens?.ensName,
            merchantPayTo: pick.merchantPayTo,
            appearOrder: pick.appearOrder ?? 0,
          }),
          signal: AbortSignal.timeout(180000),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Settlement failed");

        const s = data.settlement;
        const v = data.verification;
        const merchantEns = s.ensName || pickEns;
        const t = nowTime();
        const purchaseLabel = (s.title || "").slice(0, 28);

        pushTx("buyer", {
          dir: "out",
          amount: s.priceFormatted,
          fromEns: ensNames.buyer,
          toEns: merchantEns,
          via: ensNames.root,
          label: purchaseLabel,
          hash: s.purchaseTx?.hash,
          explorer: s.explorers?.purchase,
          time: t,
        });
        pushTx("seller", {
          dir: "in",
          amount: s.priceFormatted,
          fromEns: ensNames.buyer,
          toEns: merchantEns,
          via: ensNames.root,
          label: purchaseLabel,
          hash: s.purchaseTx?.hash,
          explorer: s.explorers?.purchase,
          time: t,
        });

        addBubble($("feedBuyer"), {
          side: "inc",
          label: buyerLabel(),
          html: txLineHtml({
            dir: "out",
            amount: s.priceFormatted,
            fromEns: ensNames.buyer,
            toEns: merchantEns,
            via: ensNames.root,
            title: s.title,
            hash: s.purchaseTx?.hash,
            explorer: s.explorers?.purchase,
          }),
        });

        addBubble($("feedSeller"), {
          side: "inc",
          label: shopifyLabel(),
          html: txLineHtml({
            dir: "in",
            amount: s.priceFormatted,
            fromEns: ensNames.buyer,
            toEns: merchantEns,
            via: ensNames.root,
            title: s.title,
            hash: s.purchaseTx?.hash,
            explorer: s.explorers?.purchase,
          }),
        });

        addBubble($("feedBuyer"), {
          side: "inc",
          label: "worldAgent",
          html: v.isHumanBacked
            ? `Incentive gate · human-backed ✓ · release commission → ${ensChip(ensNames.buyer)}`
            : `Incentive gate · HOLD commission (not human-backed)`,
        });

        if (s.commissionAction === "release" && s.commissionTx) {
          pushTx("buyer", {
            dir: "in",
            amount: s.commissionFormatted,
            fromEns: merchantEns,
            toEns: ensNames.buyer,
            via: ensNames.root,
            label: "commission",
            hash: s.commissionTx.hash,
            explorer: s.explorers?.commission,
            time: t,
          });
          pushTx("seller", {
            dir: "out",
            amount: s.commissionFormatted,
            fromEns: merchantEns,
            toEns: ensNames.buyer,
            via: ensNames.root,
            label: "commission",
            hash: s.commissionTx.hash,
            explorer: s.explorers?.commission,
            time: t,
          });

          addBubble($("feedBuyer"), {
            side: "inc",
            label: shopifyLabel(),
            html: `${txLineHtml({
              dir: "in",
              amount: s.commissionFormatted,
              fromEns: merchantEns,
              toEns: ensNames.buyer,
              via: ensNames.root,
              title: `Merchant commission · NHC $${s.nhcFormatted}`,
              hash: s.commissionTx.hash,
              explorer: s.explorers?.commission,
            })}`,
          });
          addBubble($("feedSeller"), {
            side: "inc",
            label: shopifyLabel(),
            html: txLineHtml({
              dir: "out",
              amount: s.commissionFormatted,
              fromEns: merchantEns,
              toEns: ensNames.buyer,
              via: ensNames.root,
              title: "Commission bid → buyer",
              hash: s.commissionTx.hash,
              explorer: s.explorers?.commission,
            }),
          });
        } else {
          addBubble($("feedBuyer"), {
            side: "inc",
            label: shopifyLabel(),
            html: `Commission held · <span class="tx-out">$${esc(s.commissionFormatted)}</span> not sent`,
          });
        }

        if (walletCache.buyer) renderWalletPop("buyer", walletCache.buyer);
        if (walletCache.seller) renderWalletPop("seller", walletCache.seller);
        loadWallet("buyer");
        loadWallet("seller");

        addBubble($("feedBuyer"), {
          side: "inc",
          label: buyerLabel(),
          html: `<b>Receipt</b><br/>
            ${esc(s.title)} · ${ensChip(merchantEns)}<br/>
            Paid <span class="tx-out">$${esc(s.priceFormatted)}</span> · NHC $${esc(s.nhcFormatted)}<br/>
            ${ensChip(ensNames.buyer)} → ${ensChip(merchantEns)} · via ${ensChip(ensNames.root)}`,
        });

        const ratingWrap = document.createElement("div");
        ratingWrap.className = "bwrap mid";
        ratingWrap.innerHTML = `
          <div class="rating-wrap">
            <div class="rating-stars" id="ratingStars">
              <span class="star" data-v="1">★</span><span class="star" data-v="2">★</span><span class="star" data-v="3">★</span><span class="star" data-v="4">★</span><span class="star" data-v="5">★</span>
            </div>
            <div class="rating-val" id="ratingVal">rate this purchase</div>
          </div>`;
        $("feedBuyer").appendChild(ratingWrap);
        requestAnimationFrame(() => ratingWrap.classList.add("show"));
        $("feedBuyer").scrollTop = $("feedBuyer").scrollHeight;

        const starsEl = ratingWrap.querySelector("#ratingStars");
        const valEl = ratingWrap.querySelector("#ratingVal");
        let rated = false;
        const finishRate = (v) => {
          if (rated) return;
          rated = true;
          starsEl.querySelectorAll(".star").forEach((s) =>
            s.classList.toggle("on", Number(s.dataset.v) <= v),
          );
          valEl.textContent = `${v}/5 · ${v * 20}/100`;
          addBubble($("feedBuyer"), {
            side: "inc",
            label: buyerLabel(),
            html: `Reputation noted · ${esc(String(v))}/5 (demo log · on-chain feedback next)`,
          });
          addBubble($("feedSeller"), {
            side: "inc",
            label: shopifyLabel(),
            html: `Feedback · ${esc(String(v))}/5 on ${ensChip(merchantEns)}`,
            sys: true,
          });
        };
        starsEl.addEventListener("mouseover", (ev) => {
          if (rated) return;
          const v = Number(ev.target.dataset.v);
          if (!v) return;
          starsEl.querySelectorAll(".star").forEach((s) =>
            s.classList.toggle("on", Number(s.dataset.v) <= v),
          );
        });
        starsEl.addEventListener("mouseleave", () => {
          if (rated) return;
          starsEl.querySelectorAll(".star").forEach((s) => s.classList.remove("on"));
        });
        starsEl.addEventListener("click", (ev) => {
          const v = Number(ev.target.dataset.v);
          if (!v) return;
          finishRate(v);
        });
      } catch (err) {
        addBubble($("feedBuyer"), {
          side: "mid",
          html: `Settlement error: ${esc(err.message || String(err))}`,
          sys: true,
        });
      } finally {
        setBusy(false);
        pendingOffer = null;
      }
    });
  });
}

async function boot() {
  const health = await fetch("/api/health").then((r) => r.json());
  identities = health.identities;
  if (health.ens?.buyerName) ensNames.buyer = health.ens.buyerName;
  if (health.ens?.buyerRegistryName) ensNames.buyerRegistry = health.ens.buyerRegistryName;
  if (health.ens?.shopifyAgentName) ensNames.shopifyAgent = health.ens.shopifyAgentName;
  if (health.ens?.root) ensNames.root = health.ens.root;
  if (health.payment?.commissionBps) commissionBps = health.payment.commissionBps;

  registerEnsAddr(ensNames.buyer, health.ens?.buyerAgentAddress || identities?.buyer?.walletAddress);
  registerEnsAddr(ensNames.buyerRegistry, health.ens?.buyerRegistryAddress);
  registerEnsAddr(ensNames.shopifyAgent, health.ens?.shopifyAddress || identities?.seller?.walletAddress);
  registerEnsAddr(ensNames.root, health.ens?.shopifyAddress || identities?.seller?.walletAddress);
  const ms = health.ens?.merchants || {};
  if (ms.m1) registerEnsAddr("lindt.agent.shopify.eth", ms.m1);
  if (ms.m2) registerEnsAddr("cocoa-house.agent.shopify.eth", ms.m2);
  if (ms.m3) registerEnsAddr("sweet-factory.agent.shopify.eth", ms.m3);

  $("status").textContent = `${ensNames.root} · ${health.ens.writeMode}`;
  $("buyerSub").innerHTML = ensChip(ensNames.buyer, {
    extra: [`parent · ${ensNames.buyerRegistry}`, "Buyer Agent"],
  });
  $("sellerSub").innerHTML = ensChip(ensNames.shopifyAgent, {
    extra: ["under shopify.eth", "merchant hub"],
  });
  wireEnsInfoClicks($("buyerSub"));
  wireEnsInfoClicks($("sellerSub"));
  litPhases("identity");
  wireEnsTreeUi();
}

function renderEnsNode(node, depth = 0) {
  const kids = node.children || [];
  const hasKids = kids.length > 0;
  const openDefault = depth < 2;
  const can = (node.perms?.can || [])
    .slice(0, 4)
    .map((k) => `<span class="ens-pill can">${esc(k)}</span>`)
    .join("");
  const deny = (node.perms?.deny || [])
    .slice(0, 3)
    .map((k) => `<span class="ens-pill deny">${esc(k)}</span>`)
    .join("");
  const link = node.explorerUrl
    ? `<a href="${esc(node.explorerUrl)}" target="_blank" rel="noopener">explorer ↗</a>`
    : "";
  const childHtml = hasKids
    ? `<ul class="ens-tline">${kids.map((c) => renderEnsNode(c, depth + 1)).join("")}</ul>`
    : "";

  return `
    <li class="ens-titem${openDefault ? " is-open" : ""}" data-id="${esc(node.id)}">
      <button type="button" class="ens-trow${openDefault ? " is-open" : ""}" data-ens-toggle>
        <span class="ens-tchev${hasKids || node.task ? "" : " is-leaf"}">▸</span>
        <span class="ens-tname${node.placeholder ? " is-ph" : ""}">${esc(node.name)}</span>
        <span class="ens-trole">${esc(node.role || "")}</span>
      </button>
      <div class="ens-tdetail">
        <div class="ens-tdetail-task">${esc(node.task || "")}</div>
        <div class="ens-tdetail-perms">${can}${deny}</div>
        ${link}
      </div>
      ${childHtml}
    </li>
  `;
}

function renderEnsCol(el, title, root) {
  if (!el || !root) return;
  el.innerHTML = `
    <div class="ens-tree-col-head">${esc(title)}</div>
    <ul class="ens-tline">${renderEnsNode(root, 0)}</ul>
  `;
  el.querySelectorAll("[data-ens-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const item = btn.closest(".ens-titem");
      if (!item) return;
      item.classList.toggle("is-open");
      btn.classList.toggle("is-open");
    });
  });
}

async function openEnsTree() {
  const overlay = $("ensTreeOverlay");
  if (!overlay) return;
  overlay.hidden = false;
  $("ensTreeBuyer").innerHTML = `<div class="wallet-loading">loading tree…</div>`;
  $("ensTreeSeller").innerHTML = "";
  try {
    const data = await fetch("/api/ens/tree", { cache: "no-store" }).then((r) => r.json());
    const forest = data.forest;
    const mode = data.writeMode || "dry-run";
    const nMerchants = data.live?.merchants?.length || 0;
    $("ensTreeSub").textContent =
      nMerchants > 0
        ? `${mode} · ${nMerchants} merchant namespace${nMerchants === 1 ? "" : "s"} from this session`
        : `${mode} · search to mint merchant leaves`;
    $("ensTreeLegend").innerHTML = `
      <span class="ens-pill can">${esc(forest.legend?.can || "allow")}</span>
      <span class="ens-pill deny">${esc(forest.legend?.deny || "deny")}</span>
      <span>${esc(forest.legend?.note || "Expand a row for details")}</span>
    `;
    const note = $("ensTreeNote");
    if (note) {
      note.innerHTML = `On-chain subnames are live under our UserRegistry. The hackathon explorer may still show <b>0 subnames</b> because it indexes official PermissionedRegistry / ERC-1155 events — not our custom <code>LabelRegistered</code>. Verify via
        <a href="https://hackathon-deployment-portal-app.ens-cf.workers.dev/shopify.eth" target="_blank" rel="noopener">shopify.eth</a>
        ·
        <a href="https://hackathon-deployment-portal-app.ens-cf.workers.dev/dheeraj.eth" target="_blank" rel="noopener">dheeraj.eth</a>
        (subregistry linked). After explorer-compatible redeploy, try
        <a href="https://hackathon-deployment-portal-app.ens-cf.workers.dev/agent.dheeraj.eth" target="_blank" rel="noopener">agent.dheeraj.eth</a>
        ·
        <a href="https://hackathon-deployment-portal-app.ens-cf.workers.dev/intent.agent.dheeraj.eth" target="_blank" rel="noopener">intent.agent.dheeraj.eth</a>.`;
    }
    renderEnsCol($("ensTreeBuyer"), "Buyer", forest.buyer);
    renderEnsCol($("ensTreeSeller"), "Seller", forest.seller);
  } catch (e) {
    $("ensTreeBuyer").innerHTML = `<div class="wallet-loading">${esc(e.message || e)}</div>`;
  }
}

function closeEnsTree() {
  const overlay = $("ensTreeOverlay");
  if (overlay) overlay.hidden = true;
}

function wireEnsTreeUi() {
  $("ensTreeBtn")?.addEventListener("click", () => openEnsTree());
  $("ensTreeClose")?.addEventListener("click", () => closeEnsTree());
  $("ensTreeOverlay")?.addEventListener("click", (e) => {
    if (e.target === $("ensTreeOverlay")) closeEnsTree();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeEnsTree();
  });
}

async function runTurn(text) {
  if (!text || busy) return;
  setBusy(true);

  const followUp = clarifying && intentSessionId;
  if (!followUp) {
    clearFeed($("feedBuyer"));
    clearFeed(
      $("feedSeller"),
      "UCP catalog waiting until the buyer names a product and a budget…",
    );
    lastChoiceSet = [];
    intentSessionId = null;
    pendingOffer = null;
    litPhases("identity", "intent");
    $("sellerSub").innerHTML = ensChip(ensNames.shopifyAgent, { extra: ["awaiting UCP search"] });
    wireEnsInfoClicks($("sellerSub"));
  }

  addBubble($("feedBuyer"), { side: "out", label: "you", html: esc(text) });
  lockPreviousChoices(text);
  $("q").value = "";

  try {
    const res = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text, sessionId: intentSessionId, limit: 5 }),
      signal: AbortSignal.timeout(45000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Intent failed");

    intentSessionId = data.sessionId;
    if (data.ensNames) {
      ensNames = { ...ensNames, ...data.ensNames };
    }

    if (data.stopReason !== "ready") {
      clarifying = true;
      addAgentAsk(data.agentMessage, data.options);
      return;
    }

    clarifying = false;
    const parsed = data.parsed;
    const budget = parsed.maxPriceCents
      ? `$${(parsed.maxPriceCents / 100).toFixed(0)}`
      : "none";
    addBubble($("feedBuyer"), {
      side: "inc",
      label: buyerLabel(),
      html: `${esc(data.agentMessage)}<br/>Intent: "${esc(parsed.query)}" · Budget: ${esc(budget)} · via ${esc(data.provider)}`,
    });

    addPhase("offers");
    addPhase("ens");
    const offers = (data.offers || []).slice(0, 5);
    $("sellerSub").textContent = `UCP · ${offers.length} offers`;

    addBubble($("feedBuyer"), {
      side: "inc",
      label: buyerLabel(),
      html: "Searching Shopify UCP…",
    });
    addBubble($("feedSeller"), {
      side: "inc",
      label: shopifyLabel(),
      html: `Merchants returning offers under ${ensChip(ensNames.root)}…`,
      sys: true,
    });

    await sleep(350);
    await renderProductsStaggered(offers);

    addBubble($("feedBuyer"), {
      side: "inc",
      label: buyerLabel(),
      html: `${offers.length} offers · hover a name for ENS details`,
    });

    await showGuardrailsAndApproval(offers, parsed);
    intentSessionId = null;
  } catch (err) {
    clarifying = false;
    intentSessionId = null;
    const msg = err.name === "TimeoutError" ? "Request timed out — try again" : err.message;
    addBubble($("feedBuyer"), { side: "mid", html: `Error: ${esc(msg)}`, sys: true });
  } finally {
    setBusy(false);
    $("q").focus();
  }
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  runTurn($("q").value.trim());
});

document.querySelectorAll(".prompt-chip[data-q]").forEach((btn) => {
  if (btn.classList.contains("choice-chip")) return;
  btn.addEventListener("click", () => {
    if (busy) return;
    $("q").value = btn.dataset.q;
    runTurn(btn.dataset.q);
  });
});

wirePopover("buyerProfileWrap", "buyerProfileBtn", () => {
  if (profileCache.buyer) renderProfilePop("buyer", profileCache.buyer);
  else loadProfile("buyer");
});
wirePopover("sellerProfileWrap", "sellerProfileBtn", () => {
  if (profileCache.seller) renderProfilePop("seller", profileCache.seller);
  else loadProfile("seller");
});
wirePopover("buyerWalletWrap", "buyerWalletBtn", () => {
  if (walletCache.buyer) {
    renderWalletPop("buyer", walletCache.buyer);
    loadWallet("buyer");
  } else loadWallet("buyer");
});
wirePopover("sellerWalletWrap", "sellerWalletBtn", () => {
  if (walletCache.seller) {
    renderWalletPop("seller", walletCache.seller);
    loadWallet("seller");
  } else loadWallet("seller");
});

boot().catch((err) => {
  $("status").textContent = String(err);
});
