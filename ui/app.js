const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

let identities = null;
let intentSessionId = null;
let clarifying = false;
let busy = false;
let lastChoiceSet = [];
let pendingOffer = null;

const profileCache = { buyer: null, seller: null };
const profileTab = { buyer: "identity", seller: "identity" };
const walletCache = { buyer: null, seller: null };

const PROFILE_TABS = [
  { id: "identity", label: "ID" },
  { id: "ranking", label: "Rank" },
  { id: "feedback", label: "Feedback" },
  { id: "verify", label: "Verify" },
];

function shortAddr(addr) {
  if (!addr || addr.length < 12) return addr || "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
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
    label: identities?.buyer?.name || "buyer agent",
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
  const err =
    data.errors?.length
      ? `<div class="wallet-err">${esc(data.errors.join("; "))}</div>`
      : "";

  pop.innerHTML = `
    <div class="wallet-pop-title">${esc(role)} · Base Sepolia</div>
    <div class="wallet-addr-row">
      ${
        data.explorer
          ? `<a href="${esc(data.explorer)}" target="_blank" rel="noreferrer">${esc(data.addressShort || data.address)}</a>`
          : esc(data.addressShort || "not set")
      }
    </div>
    <div class="wallet-bal-row"><span>ETH</span><span class="wallet-bal-val">${esc(eth)}</span></div>
    <div class="wallet-bal-row"><span>USDC</span><span class="wallet-bal-val">${esc(usdc)}</span></div>
    <div class="wallet-muted" style="margin-top:8px">${esc(data.network)} · ${esc(data.caip2)}</div>
    ${err}
  `;
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

/** Midnight-style: append one row, wait, then reveal — ENS lives on each offer. */
async function renderProductsStaggered(offers) {
  const feed = $("feedSeller");
  clearFeed(feed);
  const status = document.createElement("div");
  status.className = "merchant-status";
  status.textContent = `UCP · ${offers.length} merchants · ENS on each offer`;
  feed.appendChild(status);

  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i];
    const row = document.createElement("div");
    row.className = `product-row${i === 0 ? " lead-bid" : ""}`;
    const img = offer.imageUrl
      ? `<img class="p-ph" src="${esc(offer.imageUrl)}" alt="" onerror="this.style.visibility='hidden'" />`
      : `<div class="p-ph"></div>`;
    const ensName = offer.ens?.ensName || "—";
    row.innerHTML = `
      ${img}
      <div>
        <div class="p-vendor">${esc(offer.merchantName)}</div>
        <div class="p-title">${esc(offer.title)}</div>
        <div class="p-price">$${(offer.priceCents / 100).toFixed(2)}</div>
      </div>
      <div class="p-ens"><b>${esc(ensName)}</b>ENS</div>
    `;
    feed.appendChild(row);
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

  addPhase("guardrails");

  const ak = await fetchAgentKit();
  const capacityLine = ak.isHumanBacked
    ? `capacity: ok · tier ${ak.capacityTier}`
    : `capacity: HOLD · ${ak.capacityTier}`;

  addBubble($("feedBuyer"), {
    side: "inc",
    label: "worldAgent",
    html: ak.isHumanBacked
      ? `AgentBook · human-backed ✓ · ${esc(ak.checkedVia)} · tier ${esc(ak.capacityTier)}`
      : `AgentBook · not human-backed · payout commission will hold<br/><span class="wallet-muted">${esc(ak.failureReason || "")}</span>`,
  });

  addBubble($("feedBuyer"), {
    side: "inc",
    label: "buyer agent",
    html: `<div>Guardrails:</div><div class="guard-lines">  budget ≤ ${esc(budget)}
  MCC allowed
  domain policy: pass
  ${esc(capacityLine)}</div>`,
  });

  addBubble($("feedBuyer"), {
    side: "inc",
    label: "buyer agent",
    html: `Agent pick: <b>${esc(pick.title)}</b><br/>Price $${esc(price)} · NHC $${esc(nhc)}`,
  });

  const canApprove = true; // HITL always available; AgentKit gates commission not the button
  const wrap = addBubble($("feedBuyer"), {
    side: "inc",
    label: "human approval",
    html: `Approve <b>${esc(pick.title)}</b> for $${esc(price)}?
      ${!ak.isHumanBacked ? `<div class="wallet-muted" style="margin-top:6px">Note: commission held until human-backed</div>` : ""}
      <div class="approve-row">
        <button type="button" class="approve-btn" data-decision="approve" ${canApprove ? "" : "disabled"}>Approve</button>
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
          label: "buyer agent",
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
          label: "payout",
          html: `Paying MockUSDC on Sepolia · $${esc(price)} → merchant…`,
        });
        addBubble($("feedSeller"), {
          side: "inc",
          label: "shopify",
          html: `Settlement started · ${esc(pick.ens?.ensName || pick.merchantName)}`,
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

        addBubble($("feedBuyer"), {
          side: "inc",
          label: "payout",
          html: `−$${esc(s.priceFormatted)} USDC → merchant<br/>
            ${esc(s.title)}<br/>
            <a href="${esc(s.explorers.purchase)}" target="_blank" rel="noreferrer">${esc(s.purchaseTx.hash.slice(0, 10))}…</a>`,
        });

        addBubble($("feedBuyer"), {
          side: "inc",
          label: "worldAgent",
          html: v.isHumanBacked
            ? `Incentive gate · human-backed ✓ · release commission`
            : `Incentive gate · HOLD commission (not human-backed)`,
        });

        if (s.commissionAction === "release" && s.commissionTx) {
          addBubble($("feedBuyer"), {
            side: "inc",
            label: "payout",
            html: `+$${esc(s.commissionFormatted)} USDC → buyer agent<br/>
              Merchant1 commission · NHC $${esc(s.nhcFormatted)}<br/>
              <a href="${esc(s.explorers.commission)}" target="_blank" rel="noreferrer">${esc(String(s.commissionTx.hash).slice(0, 10))}…</a>`,
          });
        } else {
          addBubble($("feedBuyer"), {
            side: "inc",
            label: "payout",
            html: `Commission held · $${esc(s.commissionFormatted)} not sent`,
          });
        }

        addBubble($("feedBuyer"), {
          side: "inc",
          label: "payout",
          html: `<b>Receipt</b><br/>
            ${esc(s.title)} · ${esc(s.ensName || "")}<br/>
            Paid $${esc(s.priceFormatted)} · NHC $${esc(s.nhcFormatted)}<br/>
            buyer ${esc(s.buyerShort)} · merchant ${esc(s.merchantPayToShort)}`,
        });

        addBubble($("feedBuyer"), {
          side: "inc",
          label: "agent",
          html: `Feedback ready · rate this purchase?<div class="approve-row" style="margin-top:8px">
            <button type="button" class="approve-btn" data-stars="5">★★★★★</button>
            <button type="button" class="approve-btn reject" data-stars="skip">Skip</button>
          </div>`,
        });
        const last = $("feedBuyer").lastElementChild;
        last?.querySelectorAll("[data-stars]").forEach((b) => {
          b.addEventListener("click", () => {
            last.querySelectorAll("[data-stars]").forEach((x) => {
              x.disabled = true;
            });
            const stars = b.dataset.stars;
            addBubble($("feedBuyer"), {
              side: "inc",
              label: "agent",
              html:
                stars === "skip"
                  ? "Feedback skipped · reputation unchanged this run"
                  : `Reputation noted · ${esc(stars)}/5 (demo log · on-chain feedback next)`,
            });
          });
        });

        addBubble($("feedSeller"), {
          side: "inc",
          label: "shopify",
          html: `Paid · merchant received $${esc(s.priceFormatted)} USDC`,
          sys: true,
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
  $("status").textContent = `${health.ens.root} · ${health.ens.writeMode}`;
  $("buyerSub").textContent = `ERC-8004 · #${identities.buyer.agentId} · ${identities.buyer.chainLabel}`;
  $("sellerSub").textContent = `ERC-8004 · #${identities.seller.agentId} · ${identities.seller.chainLabel}`;
  litPhases("identity");
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
    $("sellerSub").textContent = "UCP · awaiting intent";
  }

  addBubble($("feedBuyer"), { side: "out", label: "you", html: esc(text) });
  lockPreviousChoices(text);
  $("q").value = "";

  try {
    const res = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text, sessionId: intentSessionId, limit: 8 }),
      signal: AbortSignal.timeout(45000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Intent failed");

    intentSessionId = data.sessionId;

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
      label: identities?.buyer?.name || "buyer agent",
      html: `${esc(data.agentMessage)}<br/>Intent: "${esc(parsed.query)}" · Budget: ${esc(budget)} · via ${esc(data.provider)}`,
    });

    addPhase("offers");
    addPhase("ens");
    $("sellerSub").textContent = `UCP · ${(data.offers || []).length} offers`;

    addBubble($("feedBuyer"), {
      side: "inc",
      label: identities?.buyer?.name || "buyer agent",
      html: "Searching Shopify UCP…",
    });
    addBubble($("feedSeller"), {
      side: "inc",
      label: "shopify",
      html: "Merchants returning offers — ENS names attach per merchant…",
      sys: true,
    });

    await sleep(350);
    await renderProductsStaggered(data.offers || []);

    addBubble($("feedBuyer"), {
      side: "inc",
      label: identities?.buyer?.name || "buyer agent",
      html: `${(data.offers || []).length} merchants found · each row carries its own .shopify.eth name`,
    });

    await showGuardrailsAndApproval(data.offers || [], parsed);
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
  if (walletCache.buyer) renderWalletPop("buyer", walletCache.buyer);
  else loadWallet("buyer");
});
wirePopover("sellerWalletWrap", "sellerWalletBtn", () => {
  if (walletCache.seller) renderWalletPop("seller", walletCache.seller);
  else loadWallet("seller");
});

boot().catch((err) => {
  $("status").textContent = String(err);
});
