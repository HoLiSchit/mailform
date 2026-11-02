// Tests für das Dashboard: Reload-Logik mit einem Fake-docker, API gegen eine echte Express-Instanz.
// Aufruf: npm test  (baut vorher)
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../dist/app");
const { Reloader } = require("../dist/reload");
const { TargetStore } = require("../dist/targets");
const { loadConfig } = require("../dist/config");

const noSleep = async () => {};

/** Fake docker: `logs` is what the container "printed" after each kill, state is what inspect answers. */
function fakeDocker({ logsAfterKill = [], state = "running" } = {}) {
    const calls = [];
    let killCount = 0;
    let logs = "";
    const docker = async (...args) => {
        calls.push(args.join(" "));
        if (args[0] === "kill") logs = logsAfterKill[Math.min(killCount++, logsAfterKill.length - 1)] ?? "";
        if (args[0] === "logs") return { stdout: logs, stderr: "" };
        if (args[0] === "inspect") return { stdout: typeof state === "function" ? state() : state, stderr: "" };
        return { stdout: "", stderr: "" };
    };
    return { docker, calls };
}

const reloader = (mode, fake) => new Reloader({ mode, container: "mailform", docker: fake.docker, sleep: noSleep, hupPolls: 3 });

test("hup: Erfolg wird aus dem Log gelesen", async () => {
    const fake = fakeDocker({ logsAfterKill: ["Loading targets...\nTargets reloaded"] });
    const result = await reloader("hup", fake).apply();
    assert.deepEqual(result, { ok: true, action: "neu geladen" });
    assert.equal(fake.calls[0], "kill --signal=HUP mailform");
});

test("hup: Reload failed rollt zurück, lädt erneut und maskiert Zugangsdaten", async () => {
    const fake = fakeDocker({ logsAfterKill: ["Reload failed: Target a is invalid: smtp://u:geheim@h", "Targets reloaded"] });
    let undone = false;
    const result = await reloader("hup", fake).apply(() => { undone = true; });
    assert.equal(result.ok, false);
    assert.ok(undone);
    assert.match(result.error, /Reload failed: Target a is invalid: smtp:\/\/\*\*\*/);
    assert.doesNotMatch(result.error, /geheim/);
    assert.doesNotMatch(result.error, /ACHTUNG/);
    assert.equal(fake.calls.filter((c) => c.startsWith("kill")).length, 2);
});

test("hup: scheitert auch der Rollback-Reload, steht das in der Meldung", async () => {
    const fake = fakeDocker({ logsAfterKill: ["Reload failed: kaputt"] });
    const result = await reloader("hup", fake).apply(() => {});
    assert.match(result.error, /ACHTUNG: Auch das Neuladen nach dem Zurückrollen/);
});

test("hup: weder Erfolg noch Fehler im Log ist ein Fehler", async () => {
    const fake = fakeDocker({ logsAfterKill: ["irgendwas anderes"] });
    const result = await reloader("hup", fake).apply();
    assert.equal(result.ok, false);
    assert.match(result.error, /Keine Rückmeldung/);
});

test("restart: Container muss laufen, sonst Absturz und Rollback", async () => {
    const ok = await reloader("restart", fakeDocker({ state: "running" })).apply();
    assert.deepEqual(ok, { ok: true, action: "neu gestartet" });

    let undone = false;
    const bad = await reloader("restart", fakeDocker({ state: "restarting" })).apply(() => { undone = true; });
    assert.equal(bad.ok, false);
    assert.ok(undone);
    assert.match(bad.error, /abgestürzt/);
});

test("Reloads laufen nacheinander", async () => {
    const order = [];
    let release;
    const gate = new Promise((r) => (release = r));
    const docker = async (...args) => {
        if (args[0] === "kill") order.push("kill");
        if (args[0] === "kill" && order.length === 1) await gate;
        if (args[0] === "logs") return { stdout: "Targets reloaded", stderr: "" };
        return { stdout: "", stderr: "" };
    };
    const r = new Reloader({ mode: "hup", container: "m", docker, sleep: noSleep });
    const first = r.apply();
    const second = r.apply();
    await new Promise((x) => setImmediate(x));
    assert.deepEqual(order, ["kill"]);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["kill", "kill"]);
});

test("Konfiguration: Pflichtwerte und RELOAD_MODE", () => {
    assert.throws(() => loadConfig({ SESSION_SECRET: "s" }), /DASH_PASS/);
    assert.throws(() => loadConfig({ DASH_PASS: "p" }), /SESSION_SECRET/);
    assert.throws(() => loadConfig({ DASH_PASS: "p", SESSION_SECRET: "s", RELOAD_MODE: "kill" }), /RELOAD_MODE/);
    assert.equal(loadConfig({ DASH_PASS: "p", SESSION_SECRET: "s" }).reloadMode, "restart");
});

// --- API ---------------------------------------------------------------
let dir, server, base, cookie, fake;

async function start(fakeOpts) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-test-"));
    fake = fakeDocker(fakeOpts);
    const config = loadConfig({ DASH_PASS: "pw", SESSION_SECRET: "sec", TARGETS_DIR: dir, RELOAD_MODE: "hup" });
    const app = createApp(config, new TargetStore(dir), reloader("hup", fake));
    await new Promise((resolve) => (server = app.listen(0, "127.0.0.1", resolve)));
    base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "pw" }) });
    cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const api = (method, url, body) =>
    fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: body && JSON.stringify(body) });

const form = (extra = {}) => ({
    smtp: "smtps://user:geheim@mail.example.com", recipients: ["a@example.com"], rateLimit: { timespan: 60, requests: 3 }, ...extra
});

beforeEach(() => start({ logsAfterKill: ["Targets reloaded"] }));
afterEach(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("API ist ohne Login gesperrt", async () => {
    assert.equal((await fetch(base + "/api/targets")).status, 401);
    const page = await fetch(base + "/", { redirect: "manual" });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), "/login");
});

test("Anlegen: Datei mit 0600, Passwort in der API maskiert, Antwort nennt die Aktion", async () => {
    const r = await api("POST", "/api/targets", { name: "kontakt", ...form({ key: "k1" }) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).restart.action, "neu geladen");
    assert.equal(fs.statSync(path.join(dir, "kontakt.json")).mode & 0o777, 0o600);

    const got = await (await api("GET", "/api/targets/kontakt")).json();
    assert.equal(got.smtp, "smtps://user:********@mail.example.com");
    assert.doesNotMatch(JSON.stringify(await (await api("GET", "/api/targets")).json()), /geheim/);
});

test("Bearbeiten: Maske behält das Passwort, nicht verwaltete Felder bleiben", async () => {
    fs.writeFileSync(path.join(dir, "kontakt.json"), JSON.stringify({
        ...form(), redirect: { success: "https://x/ok" }, captcha: { provider: "hcaptcha", secret: "cs" }, maxFileSizeMb: 9
    }));
    const r = await api("PUT", "/api/targets/kontakt", form({ smtp: "smtps://user:********@mail.example.com", recipients: ["b@example.com"] }));
    assert.equal(r.status, 200);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "kontakt.json"), "utf8"));
    assert.equal(saved.smtp, "smtps://user:geheim@mail.example.com");
    assert.deepEqual(saved.recipients, ["b@example.com"]);
    assert.deepEqual(saved.redirect, { success: "https://x/ok" });
    assert.equal(saved.captcha.secret, "cs");
    assert.equal(saved.maxFileSizeMb, 9);
});

test("Fehlgeschlagener Reload rollt Anlegen, Bearbeiten und Löschen zurück", async () => {
    await server.close();
    const failThenOk = ["Reload failed: kaputt", "Targets reloaded"];
    await start({ logsAfterKill: [...failThenOk, ...failThenOk, ...failThenOk] });

    const created = await api("POST", "/api/targets", { name: "neu", ...form() });
    assert.equal(created.status, 422);
    assert.match((await created.json()).error, /kaputt/);
    assert.equal(fs.existsSync(path.join(dir, "neu.json")), false);

    const original = JSON.stringify(form(), null, 2);
    fs.writeFileSync(path.join(dir, "alt.json"), original);

    const edited = await api("PUT", "/api/targets/alt", form({ recipients: ["x@example.com"] }));
    assert.equal(edited.status, 422);
    assert.equal(fs.readFileSync(path.join(dir, "alt.json"), "utf8"), original);

    const deleted = await api("DELETE", "/api/targets/alt");
    assert.equal(deleted.status, 422);
    assert.equal(fs.readFileSync(path.join(dir, "alt.json"), "utf8"), original);
    assert.equal(fs.statSync(path.join(dir, "alt.json")).mode & 0o777, 0o600);
});

test("Validierung und Namen", async () => {
    assert.equal((await api("POST", "/api/targets", { name: "Groß", ...form() })).status, 400);
    const bad = await api("POST", "/api/targets", { name: "ok-name", smtp: "x", recipients: [], rateLimit: {} });
    assert.equal(bad.status, 422);
    assert.equal((await bad.json()).errors.length, 3);
    assert.equal((await api("GET", "/api/targets/..%2Fetc")).status, 400);
    assert.equal(fake.calls.filter((c) => c.startsWith("kill")).length, 0);
});

test("Status zeigt Container-Zustand", async () => {
    await server.close();
    await start({ state: "running|healthy" });
    assert.deepEqual(await (await api("GET", "/api/status")).json(), { reloadMode: "hup", state: "running", health: "healthy" });
});

test("Login-Sperre lässt sich nicht mit gefälschtem X-Forwarded-For umgehen", async () => {
    const attempt = (i) => fetch(base + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.0.0.${i}, 203.0.113.7` },
        body: JSON.stringify({ username: "admin", password: "falsch" }),
    });
    for (let i = 0; i < 8; i++) assert.equal((await attempt(i)).status, 401);
    assert.equal((await attempt(99)).status, 429);
});

test("Ungültiges JSON ergibt eine JSON-Fehlerantwort ohne Stacktrace", async () => {
    const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{kaputt" });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: "Ungültige Anfrage" });
});
