/**
 * BACKUP — ENS Tree UI v1 (dense cards). Restore from here if needed.
 * Paired with styles in styles.css under "ENS Tree FAB + sheet" before v2.
 * Date: 2026-09-05
 */
function renderEnsNode_v1(node, depth = 0) {
  const can = (node.perms?.can || [])
    .slice(0, 3)
    .map((k) => `<span class="ens-pill can">${esc(k)}</span>`)
    .join("");
  const deny = (node.perms?.deny || [])
    .slice(0, 2)
    .map((k) => `<span class="ens-pill deny">${esc(k)}</span>`)
    .join("");
  const kids = (node.children || [])
    .map((c) => renderEnsNode_v1(c, depth + 1))
    .join("");
  return `
    <div class="ens-node${depth === 0 ? " is-root" : ""}" data-id="${esc(node.id)}">
      <div class="ens-node-row">
        <div class="ens-node-name">${esc(node.name)}</div>
        <div class="ens-node-role">${esc(node.role)}</div>
      </div>
      <div class="ens-node-task">${esc(node.task)}</div>
      <div class="ens-node-perms">${can}${deny}</div>
      ${kids ? `<div class="ens-node-children">${kids}</div>` : ""}
    </div>
  `;
}
