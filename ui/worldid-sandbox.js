/**
 * World ID verification UI (Human verification tab).
 * AgentBook live proof lives in the World panel tabs.
 */
let sandboxState = { verified: false, nullifiers: [], error: null };

function sandboxEls() {
  return {
    overlay: document.getElementById("worldPanelOverlay"),
    status: document.getElementById("sandboxStatus"),
    qr: document.getElementById("sandboxQr"),
    link: document.getElementById("sandboxLink"),
    verifyBtn: document.getElementById("worldVerifyBtn"),
  };
}

function setSandboxStatus(text, cls) {
  const { status } = sandboxEls();
  if (!status) return;
  status.textContent = text;
  status.className = "sandbox-status" + (cls ? ` ${cls}` : "");
}

function hideSandboxQr() {
  const { qr, link } = sandboxEls();
  if (qr) {
    qr.hidden = true;
    qr.removeAttribute("src");
    qr.alt = "World ID QR";
  }
  if (link) {
    link.removeAttribute("href");
    link.textContent = "";
  }
}

function showSandboxQr(url) {
  const { qr, link } = sandboxEls();
  if (!url) {
    hideSandboxQr();
    return;
  }
  if (qr) {
    qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
    qr.alt = "World ID QR";
    qr.hidden = false;
  }
  if (link) {
    link.href = url;
    link.textContent = "Open World ID";
  }
}

async function startSandboxProof() {
  const { qr, verifyBtn } = sandboxEls();
  if (!qr) return { ok: false, error: "World panel missing" };

  hideSandboxQr();

  let cfg;
  try {
    cfg = await fetch("/api/worldid/sandbox-config", { cache: "no-store" }).then((r) => r.json());
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    setSandboxStatus(error, "err");
    return { ok: false, error };
  }

  if (!cfg?.ok) {
    const error = cfg?.error || "World ID config missing";
    setSandboxStatus(error, "err");
    return { ok: false, error };
  }
  if (typeof IDKit === "undefined" || !IDKit?.IDKitWidget) {
    const error = "IDKit failed to load";
    setSandboxStatus(error, "err");
    return { ok: false, error };
  }

  if (verifyBtn) verifyBtn.disabled = true;
  setSandboxStatus("Preparing verification…");

  const signal = cfg.signal || cfg.buyerWallet || "worldcommerce-buyer";
  const { IDKitWidget } = IDKit;
  let qrData;
  let completion;
  try {
    ({ qrData, completion } = await IDKitWidget({
      app_id: cfg.appId,
      action: cfg.action,
      signal,
      verification_level: "orb",
      environment: cfg.environment || "sandbox",
    }).preset(IDKit.selfieCheckLegacy({ signal })));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    setSandboxStatus(error, "err");
    hideSandboxQr();
    if (verifyBtn) verifyBtn.disabled = false;
    return { ok: false, error };
  }

  if (qrData?.qr_code_url) {
    showSandboxQr(qrData.qr_code_url);
    setSandboxStatus("Scan the QR to verify");
  } else {
    hideSandboxQr();
    setSandboxStatus("Waiting for verification…");
  }

  const result = await completion;
  if (!result || result.error || !result.proof) {
    const error = result?.error || "Verification cancelled";
    setSandboxStatus(error, "err");
    hideSandboxQr();
    if (verifyBtn) verifyBtn.disabled = false;
    return { ok: false, error };
  }

  setSandboxStatus("Checking proof…");
  let verify;
  try {
    verify = await fetch("/api/worldid/sandbox-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proof: result.proof,
        merkle_root: result.merkle_root,
        nullifier_hash: result.nullifier_hash,
        verification_level: result.verification_level,
        signal,
      }),
    }).then((r) => r.json());
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    setSandboxStatus(error, "err");
    hideSandboxQr();
    if (verifyBtn) verifyBtn.disabled = false;
    return { ok: false, error };
  }

  if (!verify?.ok) {
    const error = verify?.error || "Proof rejected";
    setSandboxStatus(error, "err");
    hideSandboxQr();
    if (verifyBtn) verifyBtn.disabled = false;
    return { ok: false, error };
  }

  sandboxState = {
    verified: true,
    nullifiers: [result.nullifier_hash].filter(Boolean),
    error: null,
  };
  setSandboxStatus("Verified", "ok");
  hideSandboxQr();
  if (verifyBtn) verifyBtn.disabled = false;
  return { ok: true, nullifiers: sandboxState.nullifiers };
}

function setWorldTab(tab) {
  document.querySelectorAll(".world-tab").forEach((btn) => {
    const on = btn.getAttribute("data-world-tab") === tab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll("[data-world-panel]").forEach((panel) => {
    panel.hidden = panel.getAttribute("data-world-panel") !== tab;
  });
}

function openWorldPanel(tab = "human") {
  const overlay = document.getElementById("worldPanelOverlay");
  if (overlay) overlay.hidden = false;
  hideSandboxQr();
  if (!sandboxState.verified) setSandboxStatus("Ready to verify");
  setWorldTab(tab);
}

function closeWorldPanel() {
  const overlay = document.getElementById("worldPanelOverlay");
  if (overlay) overlay.hidden = true;
}

function wireWorldPanelUi() {
  const overlay = document.getElementById("worldPanelOverlay");
  hideSandboxQr();
  document.getElementById("worldFab")?.addEventListener("click", () => openWorldPanel("human"));
  document.getElementById("worldPanelClose")?.addEventListener("click", () => closeWorldPanel());
  document.getElementById("worldVerifyBtn")?.addEventListener("click", () => {
    startSandboxProof().catch((err) => {
      setSandboxStatus(err.message || String(err), "err");
      hideSandboxQr();
      const { verifyBtn } = sandboxEls();
      if (verifyBtn) verifyBtn.disabled = false;
    });
  });
  document.querySelectorAll(".world-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      setWorldTab(btn.getAttribute("data-world-tab") || "human");
    });
  });
  overlay?.addEventListener("click", (ev) => {
    if (ev.target === overlay) closeWorldPanel();
  });
}

document.addEventListener("DOMContentLoaded", wireWorldPanelUi);
window.startSandboxProof = startSandboxProof;
window.openWorldPanel = openWorldPanel;
window.closeWorldPanel = closeWorldPanel;
