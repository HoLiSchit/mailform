// Mailform Dashboard: Formularliste und Editor. Alle Daten gehen per textContent in die Seite, nie als HTML.

const $ = (id) => document.getElementById(id);

const ICON_PATHS = {
  chevron: '<path d="M9 6l6 6-6 6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 8.5v5"/><path d="M12 16.6v.01"/><path d="M10.6 4.4a1.6 1.6 0 0 1 2.8 0l7.2 12.4a1.6 1.6 0 0 1-1.4 2.4H4.8a1.6 1.6 0 0 1-1.4-2.4z"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5L19 4M16 7l2.5 2.5"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.2-2.8 7.4-7 9.5-4.2-2.1-7-5.3-7-9.5V6z"/>',
  code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  clip: '<path d="M20 11.5l-7.8 7.8a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.3 4.3l-8 8a1.5 1.5 0 0 1-2.1-2.1l7.3-7.3"/>',
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICON_PATHS[name]; // feste Zeichenketten aus ICON_PATHS
  return svg;
}

function chevron() {
  const svg = icon("chevron");
  svg.classList.add("chev");
  return svg;
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Nicht angemeldet");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.errors && data.errors.join(" ")) || data.error || res.statusText);
  return data;
}

let config = { defaultSmtp: "", publicHost: "", reloadMode: "restart" };
let targets = [];
let editing = null; // Name des bearbeiteten Ziels, null = neu

const endpointFor = (name) => `${(config.publicHost || "").replace(/\/$/, "")}/${name}`;

/* ---------- Hinweis (Toast) ---------- */
let toastTimer;
function toast(text, tone = "ok") {
  clearTimeout(toastTimer);
  $("toastHost").replaceChildren(h("div", { class: "toast", role: "status" }, icon(tone === "ok" ? "check" : "alert"), h("span", {}, text)));
  toastTimer = setTimeout(() => $("toastHost").replaceChildren(), 5000);
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} kopiert`);
  } catch {
    toast("Kopieren nicht möglich, bitte von Hand markieren", "bad");
  }
}

/* ---------- Status ---------- */
async function loadStatus() {
  const box = $("status");
  try {
    const s = await api("/api/status");
    const mode = s.reloadMode === "hup" ? "Neuladen per Signal" : "Neustart bei Änderung";
    let tone = "warn";
    let text = `Container: ${s.state}`;
    if (s.state === "running" && (s.health === "healthy" || s.health === "")) { tone = "ok"; text = "Mailform läuft"; }
    else if (s.state === "running") text = `Mailform läuft, Gesundheit: ${s.health}`;
    else if (s.state === "unknown") { tone = "bad"; text = "Mailform nicht erreichbar"; }
    else if (s.state === "exited" || s.state === "restarting") tone = "bad";
    box.dataset.tone = tone;
    box.replaceChildren(h("span", { class: "dot" }), h("span", {}, text, h("span", { class: "status-detail" }, ` · ${mode}`)));
  } catch {
    box.dataset.tone = "bad";
    box.replaceChildren(h("span", { class: "dot" }), h("span", {}, "Status nicht abrufbar"));
  }
}

/* ---------- Liste ---------- */
function formatRate(rate) {
  if (!rate) return "kein Limit";
  const t = rate.timespan;
  const span = t % 3600 === 0 ? `${t / 3600} Std.` : t % 60 === 0 ? `${t / 60} Min.` : `${t} Sek.`;
  return `${rate.requests} pro ${span}`;
}

function originList(t) {
  return [].concat(t.origin || []);
}

function tagsFor(t) {
  const tags = [];
  if (t.key) tags.push(h("span", { class: "tag tag-on" }, icon("key"), "Key"));
  if (t.honeypot) tags.push(h("span", { class: "tag tag-on" }, icon("shield"), "Honeypot"));
  if (t.captcha) tags.push(h("span", { class: "tag tag-on" }, icon("shield"), "Captcha"));
  if (t.allowHtml) tags.push(h("span", { class: "tag tag-warn" }, icon("code"), "HTML"));
  if (t.allowUploads) tags.push(h("span", { class: "tag tag-warn" }, icon("clip"), "Uploads"));
  if (!originList(t).length) tags.push(h("span", { class: "tag tag-warn" }, icon("alert"), "alle Origins"));
  return tags;
}

function renderRow(t) {
  if (t.error) {
    return h("button", { class: "row", type: "button", disabled: true },
      h("div", { class: "cell" }, h("div", { class: "cell-name" }, t.name), h("div", { class: "cell-sub" }, t.error)));
  }
  const origins = originList(t);
  const copyBtn = h("button", {
    class: "inline-copy copy", type: "button", "aria-label": `Endpoint von ${t.name} kopieren`,
    onclick: (e) => { e.stopPropagation(); copy(endpointFor(t.name), "Endpoint"); },
  }, icon("copy"));

  return h("div", { class: "row" },
    h("div", { class: "cell" },
      h("button", { class: "row-open", type: "button", onclick: () => openSheet(t.name) }, t.name),
      h("div", { class: "cell-endpoint" }, h("span", { class: "mono" }, endpointFor(t.name)), copyBtn)),
    h("div", { class: "cell cell-mail" }, h("div", { class: "cell-sub" }, (t.recipients || []).join(", "))),
    h("div", { class: "cell cell-origin" },
      h("div", { class: "cell-sub" }, origins.length ? origins.join(", ").replace(/https?:\/\//g, "") : "alle erlaubt"),
      h("div", { class: "cell-sub" }, formatRate(t.rateLimit))),
    h("div", { class: "tags" }, ...tagsFor(t)),
    chevron());
}

function renderList() {
  const list = $("list");
  list.setAttribute("aria-busy", "false");

  if (!targets.length) {
    list.replaceChildren(h("div", { class: "empty" },
      h("h2", {}, "Noch kein Formular"),
      h("p", {}, "Lege ein Formular an. Du bekommst einen Endpoint, den du als action in dein HTML-Formular einträgst, und Mailform schickt die Nachrichten an deine Empfänger."),
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openSheet(null) }, "Erstes Formular anlegen")));
    return;
  }

  const head = h("div", { class: "row row-head", "aria-hidden": "true" },
    h("div", {}, "Formular"), h("div", {}, "Empfänger"), h("div", {}, "Origin und Limit"), h("div", {}, "Schutz"), h("div"));
  list.replaceChildren(head, ...targets.map(renderRow));
}

async function loadTargets() {
  try {
    targets = await api("/api/targets");
    $("lede").textContent = targets.length === 1 ? "1 Formular aktiv." : `${targets.length} Formulare aktiv.`;
    renderList();
  } catch (e) {
    $("list").setAttribute("aria-busy", "false");
    $("list").replaceChildren(h("div", { class: "load-error" }, icon("alert"), h("span", {}, `Formulare konnten nicht geladen werden: ${e.message}`),
      h("button", { class: "btn", type: "button", onclick: loadTargets }, "Erneut versuchen")));
  }
}

/* ---------- Editor ---------- */
const sheet = $("sheet");
const field = (id) => $(`f-${id}`);

function splitRate(seconds) {
  if (seconds % 3600 === 0) return [seconds / 3600, "3600"];
  if (seconds % 60 === 0) return [seconds / 60, "60"];
  return [seconds, "1"];
}

function updateEndpoint() {
  $("endpoint").textContent = endpointFor(field("name").value || "<name>");
}

function setError(text) {
  $("formError").replaceChildren(...(text ? [h("div", { class: "alert" }, icon("alert"), h("span", {}, text))] : []));
  if (text) $("formError").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function setPending(text) {
  const busy = Boolean(text);
  $("pending").hidden = !busy;
  $("pendingText").textContent = text || "";
  for (const id of ["save", "cancel", "delete", "closeSheet"]) $(id).disabled = busy;
}

function resetDelete() {
  const btn = $("delete");
  btn.classList.remove("confirm");
  btn.textContent = "Löschen";
}

async function openSheet(name) {
  editing = name;
  setError("");
  setPending("");
  resetDelete();
  $("form").reset();
  field("name").disabled = Boolean(name);
  $("delete").hidden = !name;
  $("sheetTitle").textContent = name ? name : "Neues Formular";

  if (name) {
    let t;
    try {
      t = await api(`/api/targets/${encodeURIComponent(name)}`);
    } catch (e) {
      toast(e.message, "bad");
      return;
    }
    field("name").value = t.name;
    field("recipients").value = (t.recipients || []).join("\n");
    field("smtp").value = t.smtp || "";
    field("origin").value = originList(t).join("\n");
    field("honeypot").value = t.honeypot || "";
    field("allowHtml").checked = Boolean(t.allowHtml);
    field("allowUploads").checked = Boolean(t.allowUploads);
    field("from").value = t.from || "";
    field("fixedFrom").checked = Boolean(t.fixedFrom);
    field("key").value = t.key || "";
    field("subjectPrefix").value = t.subjectPrefix || "";
    const rate = t.rateLimit || { timespan: 300, requests: 3 };
    field("rl-requests").value = rate.requests;
    const [amount, unit] = splitRate(rate.timespan);
    field("rl-amount").value = amount;
    field("rl-unit").value = unit;
  } else {
    field("smtp").value = config.defaultSmtp || "";
    field("rl-requests").value = 3;
    field("rl-amount").value = 5;
    field("rl-unit").value = "60";
  }

  updateEndpoint();
  if (!sheet.open) sheet.showModal();
  (name ? field("recipients") : field("name")).focus();
}

function closeSheet() {
  if (sheet.open) sheet.close();
}

function readForm() {
  const lines = (id) => field(id).value.split("\n").map((s) => s.trim()).filter(Boolean);
  return {
    recipients: lines("recipients"),
    smtp: field("smtp").value.trim(),
    origin: lines("origin"),
    honeypot: field("honeypot").value.trim(),
    allowHtml: field("allowHtml").checked,
    allowUploads: field("allowUploads").checked,
    from: field("from").value.trim(),
    fixedFrom: field("fixedFrom").checked,
    subjectPrefix: field("subjectPrefix").value,
    key: field("key").value.trim(),
    rateLimit: {
      requests: Number(field("rl-requests").value),
      timespan: Number(field("rl-amount").value) * Number(field("rl-unit").value),
    },
  };
}

const applying = () => (config.reloadMode === "hup" ? "Mailform lädt die Formulare neu …" : "Mailform startet neu …");

async function save(event) {
  event.preventDefault();
  setError("");
  const body = readForm();
  if (!(body.rateLimit.requests > 0) || !(body.rateLimit.timespan > 0)) {
    setError("Rate-Limit: Anzahl und Zeitraum müssen größer als 0 sein.");
    return;
  }
  setPending(applying());

  try {
    let res;
    if (editing) {
      res = await api(`/api/targets/${encodeURIComponent(editing)}`, { method: "PUT", body: JSON.stringify(body) });
    } else {
      body.name = field("name").value.trim();
      res = await api("/api/targets", { method: "POST", body: JSON.stringify(body) });
    }
    closeSheet();
    toast(`„${res.name}“ gespeichert, Mailform ${res.restart.action}.`);
    await Promise.all([loadTargets(), loadStatus()]);
  } catch (e) {
    setError(e.message);
    loadStatus();
  } finally {
    setPending("");
  }
}

async function remove() {
  const btn = $("delete");
  if (!btn.classList.contains("confirm")) {
    btn.classList.add("confirm");
    btn.textContent = `„${editing}“ endgültig löschen`;
    setTimeout(resetDelete, 5000);
    return;
  }
  setError("");
  setPending(applying());
  try {
    const res = await api(`/api/targets/${encodeURIComponent(editing)}`, { method: "DELETE" });
    const name = editing;
    closeSheet();
    toast(`„${name}“ gelöscht, Mailform ${res.restart.action}.`);
    await Promise.all([loadTargets(), loadStatus()]);
  } catch (e) {
    setError(e.message);
    resetDelete();
  } finally {
    setPending("");
  }
}

/* ---------- Verdrahtung ---------- */
$("form").addEventListener("submit", save);
$("delete").addEventListener("click", remove);
$("cancel").addEventListener("click", closeSheet);
$("closeSheet").addEventListener("click", closeSheet);
$("newTarget").addEventListener("click", () => openSheet(null));
field("name").addEventListener("input", updateEndpoint);
$("genKey").addEventListener("click", async () => { field("key").value = (await api("/api/generate-key")).key; });
document.querySelector("[data-copy-endpoint]").append(icon("copy"));
document.querySelector("[data-copy-endpoint]").addEventListener("click", () => copy($("endpoint").textContent, "Endpoint"));
$("logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
});
// Klick auf den abgedunkelten Hintergrund schließt das Blatt (nur wenn nichts läuft)
sheet.addEventListener("mousedown", (e) => { if (e.target === sheet && !$("save").disabled) closeSheet(); });
sheet.addEventListener("cancel", (e) => { if ($("save").disabled) e.preventDefault(); });

(async function init() {
  try { config = { ...config, ...(await api("/api/config")) }; } catch { /* Standardwerte */ }
  await Promise.all([loadTargets(), loadStatus()]);
  setInterval(loadStatus, 30000);
})();
