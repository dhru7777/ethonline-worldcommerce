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

/** AgentBook registration proof on World Chain. */
const AGENTBOOK_PROOF_TX =
  "0x25e4710cc1432567536c3a72e35a1aac53a421a1689a7abbc449ce0c271bb1e4";
const AGENTBOOK_PROOF_EXPLORER = `https://worldscan.org/tx/${AGENTBOOK_PROOF_TX}`;

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

const ENS_EXPLORER = "https://hackathon-deployment-portal-app.ens-cf.workers.dev";
const ENS_BUYER_ADDR = "0xCD643061B9a5D96AD8595B252fE098EA33a39D91";

function ensExplorerNameUrl(name) {
  return `${ENS_EXPLORER}/${encodeURIComponent(String(name || ""))}`;
}
function ensExplorerRecordsUrl(name) {
  return `${ensExplorerNameUrl(name)}/records`;
}
function ensExplorerAddrNamesUrl(addr) {
  return `${ENS_EXPLORER}/addr/${addr}/names`;
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
  const nameHref = ensExplorerNameUrl(name);
  const info = address
    ? `<button type="button" class="ens-i" aria-label="Show address for ${esc(name)}" title="${esc(address)}" data-addr="${esc(address)}">i</button>
       <span class="ens-addr-tip" role="tooltip"><span class="ens-addr-label">address</span><code><a href="${esc(ensExplorerAddrNamesUrl(address))}" target="_blank" rel="noopener">${esc(address)}</a></code></span>`
    : "";
  return `<span class="ens-wrap" tabindex="0" title="${esc(tip)}" data-ens="${esc(name)}" data-addr="${esc(address)}">
    <a class="ens-chip" href="${esc(nameHref)}" target="_blank" rel="noopener">${esc(name)}</a>${info}
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

function addBubble(feed, { side, label, html, sys = false, delay = 0 }) {
  const hint = feed.querySelector(".empty-hint");
  if (hint) hint.remove();
  const wrap = document.createElement("div");
  const align =
    side === "out" || side === "human" ? "sent" : side === "mid" ? "mid" : "recv";
  const bubbleClass = sys
    ? "sys"
    : side === "out"
      ? "out"
      : side === "human"
        ? "human"
        : "inc";
  wrap.className = `bwrap ${align}`;
  wrap.innerHTML = `
    ${label ? `<div class="blabel">${esc(label)}</div>` : ""}
    <div class="bubble ${bubbleClass}">${html}</div>
  `;
  feed.appendChild(wrap);
  wireEnsInfoClicks(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  feed.scrollTop = feed.scrollHeight;
  if (delay > 0) {
    return sleep(delay).then(() => wrap);
  }
  return wrap;
}

async function say(feed, opts) {
  const delay = opts.delay ?? 900;
  return addBubble(feed, { ...opts, delay });
}

function lockPreviousChoices(selected) {
  $("feedBuyer").querySelectorAll(".choice-chip:not(:disabled)").forEach((btn) => {
    btn.disabled = true;
    const q = String(btn.dataset.q || "").trim().toLowerCase();
    btn.classList.toggle("is-selected", Boolean(selected) && q === String(selected).trim().toLowerCase());
    btn.classList.toggle("is-spent", !btn.classList.contains("is-selected"));
  });
}

async function addAgentAsk(message, options) {
  let opts = (options || []).map((o) => String(o).trim()).filter(Boolean);
  if (sameChoices(opts, lastChoiceSet)) opts = [];
  lastChoiceSet = opts;
  const chips = opts
    .map(
      (opt) =>
        `<button type="button" class="prompt-chip choice-chip" data-q="${esc(opt)}">${esc(opt)}</button>`,
    )
    .join("");
  const wrap = await say($("feedBuyer"), {
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
    const rows = [
      profileKv("Name", data.displayName || data.name || "—"),
      profileKv("ENS", data.ensName || "—"),
      profileKv("Agent ID", `#${id.agentId ?? data.agentId}`),
      profileKv("Chain", id.chainLabel || data.chainLabel),
      profileKv("Global ID", id.globalId || data.globalId),
      profileKv("Owner", id.ownerShort || shortAddr(id.owner)),
      profileKv("Agent wallet", id.agentWalletShort || shortAddr(id.agentWallet)),
      profileKv("x402", id.x402Support ? "yes" : "no"),
      profileKv("Trust", (id.trust || []).join(", ") || "reputation"),
      profileKv("ENSIP-25", id.ensip25Key || data.ensip25Key),
    ];
    const ak = window.__agentKit;
    const wallet = String(id.agentWallet || data.walletAddress || "").toLowerCase();
    const liveWallet = String(ak?.agentWallet || window.__buyerWallet || "").toLowerCase();
    const isBuyer = data.role === "buyer" || (wallet && liveWallet && wallet === liveWallet);
    if (ak && isBuyer) {
      rows.push(
        profileKv(
          "AgentBook",
          ak.checkedVia === "agentbook-live" && ak.isHumanBacked && ak.mocked !== true
            ? "registered · live"
            : ak.mocked
              ? "demo mock"
              : ak.isHumanBacked
                ? "human-backed"
                : "unregistered",
        ),
      );
      if (ak.humanId) rows.push(profileKv("World human", ak.humanId));
    }
    return rows.join("");
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
    pop.innerHTML = `<div class="pop-title">ERC-8004 · ${esc(role === "buyer" ? "Buyer Agent" : "Shopify Agent")}</div><div class="wallet-err">${esc(errMsg)}</div>`;
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
    <div class="pop-title">ERC-8004 · ${esc(role === "buyer" ? "Buyer Agent" : "Shopify Agent")}</div>
    <div class="pop-agent-name">${esc(data.displayName || data.name || (role === "buyer" ? "Buyer Agent" : "Shopify Agent"))}</div>
    <div class="pop-agent-ens">${esc(data.ensName || (role === "buyer" ? ensNames.buyer : ensNames.shopifyAgent))}</div>
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
    await sleep(720);
    row.classList.add("show");
    if (i === 0) row.classList.add("glow");
    feed.scrollTop = feed.scrollHeight;
  }
}

function nhcCents(priceCents, bps = 170) {
  return Math.max(1, Math.round(priceCents * (1 - bps / 10000)));
}

function agentBookLine(ak) {
  if (ak.isHumanBacked) {
    return `AgentBook · human-backed ✓ · ${ensChip(ensNames.buyer, ["Buyer Agent"])}`;
  }
  return `AgentBook · not human-backed · commission will hold`;
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
  applyAgentBookChips(ak);
  const capacityLine = ak.isHumanBacked
    ? `capacity: ok · tier ${ak.capacityTier}`
    : `capacity: HOLD · ${ak.capacityTier}`;

  await say($("feedBuyer"), {
    side: "inc",
    label: "worldAgent",
    html: agentBookLine(ak),
  });

  await say($("feedBuyer"), {
    side: "inc",
    label: buyerLabel(),
    html: `<div>Guardrails:</div><div class="guard-lines">  budget ≤ ${esc(budget)}
  MCC allowed
  domain policy: pass
  ${esc(capacityLine)}</div>`,
  });

  await say($("feedBuyer"), {
    side: "inc",
    label: buyerLabel(),
    html: `Agent pick: <b>${esc(pick.title)}</b><br/>Price $${esc(price)} · NHC $${esc(nhc)}<br/>${ensChip(pickEns, ["merchant leaf under shopify.eth"])}`,
  });

  const wrap = await say($("feedBuyer"), {
    side: "human",
    label: "human",
    html: `<div class="approve-copy">Approve <b>${esc(pick.title)}</b> for $${esc(price)}?</div>${
      !ak.isHumanBacked
        ? `<div class="wallet-muted" style="margin-top:6px">Commission held until AgentBook says human-backed</div>`
        : ""
    }<div class="approve-row">
        <button type="button" class="approve-btn" data-decision="approve">Approve</button>
        <button type="button" class="approve-btn reject" data-decision="reject">Reject</button>
      </div>`,
    delay: 500,
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
        await say($("feedBuyer"), {
          side: "inc",
          label: buyerLabel(),
          html: "Rejected. Say another product or budget to search again.",
        });
        return;
      }

      await say($("feedBuyer"), {
        side: "out",
        label: "you",
        html: "Agent pick approved",
      });
      addPhase("payout");
      setBusy(true);
      try {
        await say($("feedBuyer"), {
          side: "inc",
          label: buyerLabel(),
          html: `Paying MockUSDC on Sepolia · $${esc(price)} to ${ensChip(pickEns)}…`,
        });
        await say($("feedSeller"), {
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

        await say($("feedBuyer"), {
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

        await say($("feedSeller"), {
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

        await say($("feedBuyer"), {
          side: "inc",
          label: "worldAgent",
          html: v.isHumanBacked
            ? `Incentive gate · human-backed ✓ · release commission to ${ensChip(ensNames.buyer)}`
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

          await say($("feedBuyer"), {
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
          await say($("feedSeller"), {
            side: "inc",
            label: shopifyLabel(),
            html: txLineHtml({
              dir: "out",
              amount: s.commissionFormatted,
              fromEns: merchantEns,
              toEns: ensNames.buyer,
              via: ensNames.root,
              title: "Commission to buyer",
              hash: s.commissionTx.hash,
              explorer: s.explorers?.commission,
            }),
          });
        } else {
          await say($("feedBuyer"), {
            side: "inc",
            label: shopifyLabel(),
            html: `Commission held · <span class="tx-out">$${esc(s.commissionFormatted)}</span> not sent`,
          });
        }

        if (walletCache.buyer) renderWalletPop("buyer", walletCache.buyer);
        if (walletCache.seller) renderWalletPop("seller", walletCache.seller);
        loadWallet("buyer");
        loadWallet("seller");

        await say($("feedBuyer"), {
          side: "inc",
          label: buyerLabel(),
          html: `<b>Receipt</b><br/>
            ${esc(s.title)} · ${ensChip(merchantEns)}<br/>
            Paid <span class="tx-out">$${esc(s.priceFormatted)}</span> · NHC $${esc(s.nhcFormatted)}<br/>
            ${ensChip(ensNames.buyer)} to ${ensChip(merchantEns)} via ${ensChip(ensNames.root)}`,
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
        await sleep(500);

        const starsEl = ratingWrap.querySelector("#ratingStars");
        const valEl = ratingWrap.querySelector("#ratingVal");
        let rated = false;
        const finishRate = async (v) => {
          if (rated) return;
          rated = true;
          starsEl.querySelectorAll(".star").forEach((s) =>
            s.classList.toggle("on", Number(s.dataset.v) <= v),
          );
          valEl.textContent = `${v}/5 · writing ERC-8004…`;
          try {
            const fbRes = await fetch("/api/feedback", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                stars: v,
                title: s.title,
                ensName: merchantEns,
                agentId: identities?.seller?.agentId,
              }),
              signal: AbortSignal.timeout(180000),
            });
            const fbData = await fbRes.json();
            if (!fbRes.ok) throw new Error(fbData.error || "Feedback failed");
            const fb = fbData.feedback;
            valEl.innerHTML = `${v}/5 · on-chain ✓`;
            const txLink = fb.explorer
              ? `<a href="${esc(fb.explorer)}" target="_blank" rel="noopener">${esc(shortHash(fb.hash))}</a>`
              : "";
            const scanLink = fb.scanUrl
              ? `<a href="${esc(fb.scanUrl)}" target="_blank" rel="noopener">8004scan ↗</a>`
              : "";
            await say($("feedBuyer"), {
              side: "inc",
              label: buyerLabel(),
              html: `ERC-8004 feedback · <b>${esc(String(v))}/5</b> to Shopify Agent #${esc(String(fb.agentId))}<br/>${txLink}${scanLink ? ` · ${scanLink}` : ""}`,
            });
            await say($("feedSeller"), {
              side: "inc",
              label: shopifyLabel(),
              html: `Reputation received · ${esc(String(v))}/5 on-chain · ${ensChip(ensNames.shopifyAgent)}${txLink ? `<br/>${txLink}` : ""}`,
              sys: true,
            });
            profileTab.seller = "feedback";
            profileCache.seller = null;
            await loadProfile("seller");
          } catch (err) {
            valEl.textContent = `${v}/5 · failed`;
            await say($("feedBuyer"), {
              side: "inc",
              label: buyerLabel(),
              html: `ERC-8004 feedback failed: ${esc(err.message || err)}`,
            });
          }
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
          if (!v || rated) return;
          finishRate(v);
        });
      } catch (err) {
        await say($("feedBuyer"), {
          side: "mid",
          html: `Settlement error: ${esc(err.message || String(err))}`,
          sys: true,
        });
        wrap.querySelectorAll(".approve-btn").forEach((b) => {
          b.disabled = false;
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
  window.__buyerWallet = health.ens?.buyerAgentAddress || identities?.buyer?.walletAddress || "";
  registerEnsAddr(ensNames.buyerRegistry, health.ens?.buyerRegistryAddress);
  registerEnsAddr(ensNames.shopifyAgent, health.ens?.shopifyAddress || identities?.seller?.walletAddress);
  registerEnsAddr(ensNames.root, health.ens?.shopifyAddress || identities?.seller?.walletAddress);
  const ms = health.ens?.merchants || {};
  if (ms.m1) registerEnsAddr("lindt.agent.shopify.eth", ms.m1);
  if (ms.m2) registerEnsAddr("cocoa-house.agent.shopify.eth", ms.m2);
  if (ms.m3) registerEnsAddr("sweet-factory.agent.shopify.eth", ms.m3);

  const ak = await fetchAgentKit();
  applyAgentBookChips(ak);
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

function applyAgentBookChips(ak) {
  window.__agentKit = ak || null;
  if (ak?.humanId && $("agentbookProofHuman")) {
    $("agentbookProofHuman").textContent = ak.humanId;
  }
  if (ak?.agentWallet && $("agentbookProofAgent")) {
    $("agentbookProofAgent").textContent = ak.agentWallet;
  }
}

function renderEnsNode(node, depth = 0) {
  const kids = node.children || [];
  const hasKids = kids.length > 0;
  const openDefault = false;
  const can = (node.perms?.can || [])
    .slice(0, 4)
    .map((k) => `<span class="ens-pill can">${esc(k)}</span>`)
    .join("");
  const deny = (node.perms?.deny || [])
    .slice(0, 3)
    .map((k) => `<span class="ens-pill deny">${esc(k)}</span>`)
    .join("");
  const linkBits = [];
  if (node.explorerUrl) {
    linkBits.push(`<a href="${esc(node.explorerUrl)}" target="_blank" rel="noopener">name ↗</a>`);
  }
  if (node.recordsUrl) {
    linkBits.push(`<a href="${esc(node.recordsUrl)}" target="_blank" rel="noopener">records ↗</a>`);
  }
  const link = linkBits.length
    ? `<div class="ens-tdetail-links">${linkBits.join(" · ")}</div>`
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
      const L = forest.links || {
        shopify: ensExplorerNameUrl("shopify.eth"),
        shopifyRecords: ensExplorerRecordsUrl("shopify.eth"),
        dheeraj: ensExplorerNameUrl("dheeraj.eth"),
        dheerajRecords: ensExplorerRecordsUrl("dheeraj.eth"),
        buyerNames: ensExplorerAddrNamesUrl(ENS_BUYER_ADDR),
      };
      note.innerHTML = `Explorer ·
        <a href="${esc(L.shopify)}" target="_blank" rel="noopener">shopify.eth</a>
        · <a href="${esc(L.shopifyRecords)}" target="_blank" rel="noopener">records</a>
        · <a href="${esc(L.dheeraj)}" target="_blank" rel="noopener">dheeraj.eth</a>
        · <a href="${esc(L.dheerajRecords)}" target="_blank" rel="noopener">records</a>
        · <a href="${esc(L.buyerNames)}" target="_blank" rel="noopener">wallet names</a>`;
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
    if (e.key === "Escape") {
      if (tourActive) {
        abortTour();
        return;
      }
      closeEnsTree();
    }
  });
}

/* —— Demo tutorial (spotlight walkthrough) —— */
let tourActive = false;
let tourResolveNext = null;
let tourToken = 0;

function clearTourHighlight() {
  document.querySelectorAll(".tour-pulse").forEach((el) => el.classList.remove("tour-pulse"));
  const spot = $("tourSpot");
  if (spot) spot.style.opacity = "0";
}

function placeTourTip(target) {
  const tip = $("tourTip");
  const spot = $("tourSpot");
  if (!tip || !spot) return;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (target) {
    const r = target.getBoundingClientRect();
    spot.style.opacity = "1";
    spot.style.top = `${Math.max(4, r.top - pad)}px`;
    spot.style.left = `${Math.max(4, r.left - pad)}px`;
    spot.style.width = `${Math.min(vw - 8, r.width + pad * 2)}px`;
    spot.style.height = `${Math.min(vh - 8, r.height + pad * 2)}px`;
    target.classList.add("tour-pulse");
    const tipW = Math.min(400, vw - 24);
    let left = Math.min(vw - tipW - 12, Math.max(12, r.left));
    let top = r.bottom + 14;
    if (top + 200 > vh) top = Math.max(12, r.top - 200);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  } else {
    spot.style.opacity = "0";
    tip.style.left = `${Math.max(12, (vw - 400) / 2)}px`;
    tip.style.top = `${Math.max(24, vh * 0.22)}px`;
  }
}

function openTourUi() {
  const root = $("tourRoot");
  if (root) root.hidden = false;
}

function closeTourUi() {
  const root = $("tourRoot");
  if (root) root.hidden = true;
  clearTourHighlight();
  if (tourResolveNext) {
    tourResolveNext();
    tourResolveNext = null;
  }
}

function abortTour() {
  tourActive = false;
  tourToken += 1;
  closeTourUi();
  closeEnsTree();
  document.querySelectorAll(".pop-wrap.open").forEach((el) => el.classList.remove("open"));
  const btn = $("tutorialBtn");
  if (btn) btn.disabled = false;
}

async function waitForSelector(selector, { timeout = 45000, predicate } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!tourActive) throw new Error("tour-aborted");
    const el = document.querySelector(selector);
    if (el && (!predicate || predicate(el))) return el;
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function waitWhileBusy(timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!tourActive) throw new Error("tour-aborted");
    if (!busy) return;
    await sleep(120);
  }
  throw new Error("Timed out waiting for the demo to finish a step");
}

function waitForTourNext(autoMs = 0) {
  return new Promise((resolve) => {
    tourResolveNext = () => {
      tourResolveNext = null;
      resolve("next");
    };
    if (autoMs > 0) {
      setTimeout(() => {
        if (tourResolveNext) tourResolveNext();
      }, autoMs);
    }
  });
}

async function runTourStep({
  step,
  total,
  title,
  body,
  target,
  nextLabel = "Next",
  autoMs = 0,
  action,
}) {
  if (!tourActive) return;
  clearTourHighlight();
  $("tourStep").textContent = `${step} / ${total}`;
  $("tourTitle").textContent = title;
  $("tourBody").textContent = body;
  $("tourNext").textContent = nextLabel;
  placeTourTip(target || null);
  await sleep(700);
  if (!tourActive) return;
  await waitForTourNext(autoMs);
  if (!tourActive) return;
  if (typeof action === "function") {
    await action();
    await sleep(1200);
  }
}

async function openBuyerProfileTour() {
  document.querySelectorAll(".pop-wrap.open").forEach((el) => el.classList.remove("open"));
  const wrap = $("buyerProfileWrap");
  wrap?.classList.add("open");
  if (profileCache.buyer) renderProfilePop("buyer", profileCache.buyer);
  else await loadProfile("buyer");
}

function expandEnsTreeRoots() {
  ["ensTreeBuyer", "ensTreeSeller"].forEach((id) => {
    const root = $(id)?.querySelector(".ens-titem");
    if (!root) return;
    root.classList.add("is-open");
    root.querySelector(".ens-trow")?.classList.add("is-open");
    const child = root.querySelector(":scope > .ens-tline > .ens-titem");
    if (child) {
      child.classList.add("is-open");
      child.querySelector(".ens-trow")?.classList.add("is-open");
    }
  });
}

async function startWorldCommerceTutorial() {
  if (tourActive || busy) return;
  const token = ++tourToken;
  tourActive = true;
  $("tutorialBtn").disabled = true;
  document.querySelectorAll(".pop-wrap.open").forEach((el) => el.classList.remove("open"));
  closeEnsTree();
  if (typeof window.closeWorldPanel === "function") window.closeWorldPanel();
  openTourUi();

  const total = 12;
  const PROMPT = "Find me chocolates under $10";

  try {
    await runTourStep({
      step: 1,
      total,
      title: "An agent shops for a human",
      body: "Left is the buyer agent. Right is the Shopify agent. The top bar is the trip: identity, intent, offers, ens, guardrails, payout. Four things must be true, or this is a farm.",
      target: $("phases") || document.querySelector(".stage"),
      nextLabel: "Start",
    });
    if (!tourActive || token !== tourToken) return;

    await runTourStep({
      step: 2,
      total,
      title: "1. Named counterparties",
      body: "agent.dheeraj.eth and agent.shopify.eth, not hex. Named buyer, named seller. That is question one.",
      target: $("buyerSub") || $("buyerPanel"),
      nextLabel: "Next",
    });
    if (!tourActive || token !== tourToken) return;

    await runTourStep({
      step: 3,
      total,
      title: "ENS name and 8004 record",
      body: "ENS is the name. ERC-8004 is the agent record. World is whether a human is behind the wallet. That shows at payout. Do not mix them.",
      target: $("buyerProfileBtn"),
      nextLabel: "Open profile",
      action: async () => {
        await openBuyerProfileTour();
      },
    });
    if (!tourActive || token !== tourToken) return;

    await runTourStep({
      step: 4,
      total,
      title: "2. Shop for the human",
      body: `We type: "${PROMPT}". Labels come from this search, not a fake list.`,
      target: document.querySelector(`.prompt-chip[data-q="${PROMPT}"]`) || $("q"),
      nextLabel: "Search",
      action: async () => {
        document.querySelectorAll(".pop-wrap.open").forEach((el) => el.classList.remove("open"));
        const chip = document.querySelector(`.prompt-chip[data-q="${PROMPT}"]`);
        if (chip) chip.click();
        else {
          $("q").value = PROMPT;
          runTurn(PROMPT);
        }
      },
    });
    if (!tourActive || token !== tourToken) return;

    clearTourHighlight();
    $("tourTitle").textContent = "Discovering…";
    $("tourBody").textContent = "Watch the right panel. Merchants return under shopify.eth.";
    $("tourStep").textContent = `5 / ${total}`;
    placeTourTip($("sellerPanel"));
    await waitWhileBusy(90000);
    const choice = document.querySelector("#feedBuyer .choice-chip:not(:disabled)");
    if (choice && tourActive) {
      choice.click();
      await waitWhileBusy(90000);
    }
    await sleep(900);
    if (!tourActive || token !== tourToken) return;

    const ensOffer =
      document.querySelector("#feedSeller .ens-chip") ||
      document.querySelector("#feedSeller .product-row") ||
      $("sellerPanel");
    await runTourStep({
      step: 5,
      total,
      title: "Search-driven ENS",
      body: "Each offer carries a merchant name under shopify.eth from this result set. Search something else next and the tree changes.",
      target: ensOffer,
      nextLabel: "Next",
    });
    if (!tourActive || token !== tourToken) return;

    await runTourStep({
      step: 6,
      total,
      title: "3. What if I fire it?",
      body: "Open the ENS Tree. Buyer roles and seller permissions live here on-chain, not only in the UI.",
      target: $("ensTreeBtn"),
      nextLabel: "Open tree",
      action: async () => {
        await openEnsTree();
        await sleep(500);
        expandEnsTreeRoots();
      },
    });
    if (!tourActive || token !== tourToken) return;

    const pills =
      document.querySelector(".ens-pill.can") ||
      document.querySelector(".ens-tree-cols") ||
      $("ensTreeOverlay");
    await runTourStep({
      step: 7,
      total,
      title: "EAC: can vs deny",
      body: "Green means the agent may write. Red means it cannot rewrite registration or commission. Revoke the role and writes stop. That is firing the agent.",
      target: pills,
      nextLabel: "Close tree",
      action: () => closeEnsTree(),
    });
    if (!tourActive || token !== tourToken) return;

    const approve = await waitForSelector('button.approve-btn[data-decision="approve"]', {
      timeout: 90000,
    }).catch(() => null);
    const gateTarget =
      document.querySelector("#feedBuyer .bwrap.sent") ||
      approve ||
      $("feedBuyer");
    await runTourStep({
      step: 8,
      total,
      title: "4. Person or farm?",
      body: "AgentBook line, guardrails, then Approve. Ranking can be automatic. Money cannot. This tap is the human.",
      target: gateTarget,
      nextLabel: "Next",
    });
    if (!tourActive || token !== tourToken) return;

    if (approve) {
      await runTourStep({
        step: 9,
        total,
        title: "Approve: two money events",
        body: "Purchase goes to the merchant ENS. Then commission release if human-backed, or hold if not.",
        target: approve,
        nextLabel: "Approve",
        action: () => approve.click(),
      });
      if (!tourActive || token !== tourToken) return;
      clearTourHighlight();
      $("tourTitle").textContent = "Settling…";
      $("tourBody").textContent =
        "Watch purchase MockUSDC to the merchant name, then commission release or hold.";
      $("tourStep").textContent = `9 / ${total}`;
      placeTourTip($("feedBuyer"));
      await waitWhileBusy(180000);
      await sleep(1200);
    } else {
      await runTourStep({
        step: 9,
        total,
        title: "Approve when ready",
        body: "When the Approve bubble appears, tap it. Purchase hits the merchant ENS. Commission follows AgentBook.",
        target: $("feedBuyer"),
        nextLabel: "Next",
      });
    }
    if (!tourActive || token !== tourToken) return;

    const commissionTarget =
      document.querySelector("#feedBuyer .bubble.inc") ||
      $("feedBuyer") ||
      $("sellerPanel");
    await runTourStep({
      step: 10,
      total,
      title: "Commission and bidding",
      body: "The bid and commission move from the seller side to the buyer agent after Approve. ENS names keep who paid whom clear on both chats. World AgentKit checks human backing so commission releases or holds. That is why each bubble arrives one after another, left then right, so the money path is easy to follow.",
      target: commissionTarget,
      nextLabel: "Next",
    });
    if (!tourActive || token !== tourToken) return;

    await runTourStep({
      step: 11,
      total,
      title: "Names, humans, money",
      body: "ENS is the name, the tree, and the lock. World AgentKit is the human. USDC is the money.",
      target: document.querySelector(".brand") || $("worldFab"),
      nextLabel: "Next",
    });
    if (!tourActive || token !== tourToken) return;

    const stars =
      document.querySelector("#ratingStars") ||
      document.querySelector(".rating-wrap") ||
      $("feedBuyer");
    await runTourStep({
      step: 12,
      total,
      title: "ERC-8004 feedback",
      body: "Tap the stars to leave on-chain feedback for the Shopify agent. That reputation sticks to the agent record.",
      target: stars,
      nextLabel: "Done",
      action: async () => {
        const star = document.querySelector('#ratingStars .star[data-v="5"]');
        if (star) {
          star.click();
          await waitWhileBusy(180000).catch(() => {});
          await sleep(800);
        }
      },
    });
  } catch (err) {
    if (String(err.message || err) !== "tour-aborted") {
      await say($("feedBuyer"), {
        side: "mid",
        html: `Tutorial stopped: ${esc(err.message || err)}`,
        sys: true,
      });
    }
  } finally {
    tourActive = false;
    closeTourUi();
    closeEnsTree();
    document.querySelectorAll(".pop-wrap.open").forEach((el) => el.classList.remove("open"));
    const btn = $("tutorialBtn");
    if (btn) btn.disabled = false;
  }
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

  await say($("feedBuyer"), { side: "out", label: "you", html: esc(text), delay: 500 });
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
      await addAgentAsk(data.agentMessage, data.options);
      return;
    }

    clarifying = false;
    const parsed = data.parsed;
    const budget = parsed.maxPriceCents
      ? `$${(parsed.maxPriceCents / 100).toFixed(0)}`
      : "none";
    await say($("feedBuyer"), {
      side: "inc",
      label: buyerLabel(),
      html: `${esc(data.agentMessage)}<br/>Intent: "${esc(parsed.query)}" · Budget: ${esc(budget)} · via ${esc(data.provider)}`,
    });

    addPhase("offers");
    addPhase("ens");
    const offers = (data.offers || []).slice(0, 5);
    $("sellerSub").textContent = `UCP · ${offers.length} offers`;

    await say($("feedBuyer"), {
      side: "inc",
      label: buyerLabel(),
      html: "Searching Shopify UCP…",
      delay: 600,
    });
    await say($("feedSeller"), {
      side: "inc",
      label: shopifyLabel(),
      html: `Merchants returning offers under ${ensChip(ensNames.root)}…`,
      sys: true,
      delay: 600,
    });

    await sleep(400);
    await renderProductsStaggered(offers);

    await say($("feedBuyer"), {
      side: "inc",
      label: buyerLabel(),
      html: `${offers.length} offers · hover a name for ENS details`,
    });

    await showGuardrailsAndApproval(offers, parsed);
    intentSessionId = null;
  } catch (err) {
    clarifying = false;
    intentSessionId = null;
    const msg = err.name === "TimeoutError" ? "Request timed out. Try again." : err.message;
    await say($("feedBuyer"), { side: "mid", html: `Error: ${esc(msg)}`, sys: true });
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

$("tutorialBtn")?.addEventListener("click", () => {
  startWorldCommerceTutorial();
});
$("tourSkip")?.addEventListener("click", () => abortTour());
$("tourNext")?.addEventListener("click", () => {
  if (tourResolveNext) tourResolveNext();
});
window.addEventListener("resize", () => {
  if (!tourActive) return;
  const pulsed = document.querySelector(".tour-pulse");
  if (pulsed) placeTourTip(pulsed);
});

boot().catch((err) => {
  console.error(err);
});
