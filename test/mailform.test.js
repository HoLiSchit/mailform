// Integrationstests: startet einen Mini-SMTP-Server und den echten Dienst (dist/main.js).
// Aufruf: npm test  (baut vorher)
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ORIGIN = "https://example.org";
let smtp, smtpPort, mails = [], proc, base, dir, log = "";

function startSmtp() {
    return new Promise((resolve) => {
        smtp = net.createServer((sock) => {
            let buf = "", inData = false;
            sock.write("220 test ESMTP\r\n");
            sock.on("data", (chunk) => {
                buf += chunk.toString("binary");
                for (;;) {
                    if (inData) {
                        const i = buf.indexOf("\r\n.\r\n");
                        if (i < 0) return;
                        mails.push(buf.slice(0, i)); buf = buf.slice(i + 5); inData = false;
                        sock.write("250 queued\r\n"); continue;
                    }
                    const i = buf.indexOf("\r\n");
                    if (i < 0) return;
                    const line = buf.slice(0, i).toUpperCase(); buf = buf.slice(i + 2);
                    if (line.startsWith("EHLO") || line.startsWith("HELO")) sock.write("250 test\r\n");
                    else if (line === "DATA") { inData = true; sock.write("354 go\r\n"); }
                    else if (line.startsWith("QUIT")) { sock.write("221 bye\r\n"); sock.end(); }
                    else sock.write("250 ok\r\n");
                }
            });
        }).listen(0, "127.0.0.1", () => { smtpPort = smtp.address().port; resolve(); });
    });
}

function writeTarget(name, extra = {}) {
    fs.writeFileSync(path.join(dir, name + ".json"), JSON.stringify({
        smtp: `smtp://127.0.0.1:${smtpPort}`, recipients: ["elli@example.com"], from: "forms@example.com",
        fixedFrom: true, origin: [ORIGIN, "https://www.example.org"], honeypot: "website",
        rateLimit: { timespan: 60, requests: 1000 }, ...extra
    }));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const header = (mail, name) => (mail.match(new RegExp("^" + name + ": (.*)$", "mi")) || [])[1];

function form(fields, file) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (file) fd.append("file", new Blob(["inhalt"], { type: "text/plain" }), "a.txt");
    return fd;
}

const post = (target, body, headers = {}) =>
    fetch(`${base}/${target}`, { method: "POST", body, headers: { Origin: ORIGIN, ...headers } });

before(async () => {
    await startSmtp();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mailform-test-"));
    writeTarget("kontakt");
    writeTarget("mitdatei", { allowUploads: true });
    writeTarget("html", { allowHtml: true });
    writeTarget("kaputt", { smtp: "smtp://127.0.0.1:65500" });
    proc = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, PORT: "0", TARGETS_DIR: dir } });
    const port = await new Promise((resolve, reject) => {
        proc.stdout.on("data", (d) => {
            log += d; const m = /started on port (\d+)/.exec(log); if (m) resolve(m[1]);
        });
        proc.stderr.on("data", (d) => (log += d));
        proc.on("exit", () => reject(new Error("Dienst beendet: " + log)));
    });
    base = `http://127.0.0.1:${port}`;
});

after(() => { proc.kill(); smtp.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("Anfrage: Reply-To ist die Besucherin, Text statt HTML, Zeilenumbrüche bleiben", async () => {
    mails = [];
    const r = await post("kontakt", form({ from: "besucher@example.org", firstName: "Max <evil@x.de>", subject: "Kontaktanfrage", body: "Zeile 1\nZeile 2 <a href=\"http://x\">x</a>" }));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
    assert.match(header(mails[0], "Reply-To"), /besucher@example\.org/);
    assert.match(header(mails[0], "From"), /forms@example\.com/);
    assert.doesNotMatch(header(mails[0], "From"), /evil@x\.de/);
    assert.match(header(mails[0], "Content-Type"), /text\/plain/);
    assert.match(mails[0], /Zeile 1\r?\nZeile 2/);
});

test("allowHtml sendet HTML", async () => {
    mails = [];
    await post("html", form({ subject: "Hallo", body: "<b>fett</b>" }));
    assert.match(header(mails[0], "Content-Type"), /text\/html/);
});

test("Honeypot: Erfolg, aber keine Mail", async () => {
    mails = [];
    const r = await post("kontakt", form({ subject: "Spam", body: "kaufen sie jetzt", website: "http://spam" }));
    assert.equal(r.status, 200);
    assert.equal(mails.length, 0);
});

test("Fremde Origin wird abgelehnt, zweite erlaubte Origin geht", async () => {
    const bad = await post("kontakt", form({ subject: "Test", body: "hallo hallo" }), { Origin: "https://evil.example" });
    assert.equal(bad.status, 403);
    const ok = await post("kontakt", form({ subject: "Test", body: "hallo hallo" }), { Origin: "https://www.example.org" });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://www.example.org");
});

test("JSON-Anfragen funktionieren", async () => {
    mails = [];
    const r = await post("kontakt", JSON.stringify({ subject: "JSON", body: "per json", from: "a@b.de" }), { "Content-Type": "application/json" });
    assert.equal(r.status, 200);
    assert.equal(mails.length, 1);
});

test("Uploads sind standardmäßig aus und mit allowUploads erlaubt", async () => {
    mails = [];
    const off = await post("kontakt", form({ subject: "Datei", body: "mit datei" }, true));
    assert.ok(off.status >= 400 && off.status < 500);
    assert.equal(mails.length, 0);
    const on = await post("mitdatei", form({ subject: "Datei", body: "mit datei" }, true));
    assert.equal(on.status, 200);
    assert.match(mails[0], /a\.txt/);
});

test("SMTP-Fehler: allgemeine Meldung ohne Details", async () => {
    const r = await post("kaputt", form({ subject: "Fehler", body: "smtp kaputt" }));
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { message: "Sending the email failed" });
});

test("Pflichtfelder werden geprüft", async () => {
    const r = await post("kontakt", form({ subject: "x" }));
    assert.equal(r.status, 422);
});

test("Validierung: Fehlerformat, leere optionale Felder erlaubt, ungültige E-Mail abgelehnt", async () => {
    const bad = await post("kontakt", form({ from: "kein-mail", subject: "x", body: "kurz" }));
    assert.equal(bad.status, 422);
    const json = await bad.json();
    assert.equal(json.error, "validation_error");
    const byField = Object.fromEntries(json.problems.map((p) => [p.field, p]));
    assert.equal(byField.from.violated, "email");
    assert.equal(byField.subject.violated, "length");
    assert.deepEqual(byField.subject.expect, { minimum: 2 });
    assert.equal(byField.body.violated, "length");

    mails = [];
    const ok = await post("kontakt", form({ from: "", firstName: "", lastName: "", subject: "Leere Felder", body: "Optional leer" }));
    assert.equal(ok.status, 200);
    assert.equal(mails.length, 1);
});

test("healthz antwortet", async () => {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
});

test("SIGHUP lädt neue Ziele ohne Neustart, ungültige Konfiguration wird abgelehnt", async () => {
    assert.equal((await post("neu", form({ subject: "Neu", body: "noch nicht da" }))).status, 404);

    writeTarget("neu");
    proc.kill("SIGHUP");
    await wait(400);
    assert.match(log, /Targets reloaded/);
    assert.equal((await post("neu", form({ subject: "Neu", body: "jetzt da" }))).status, 200);

    fs.writeFileSync(path.join(dir, "defekt.json"), "{ das ist kein json");
    proc.kill("SIGHUP");
    await wait(400);
    assert.match(log, /Reload failed/);
    assert.equal((await post("neu", form({ subject: "Neu", body: "alter Stand bleibt" }))).status, 200);

    fs.writeFileSync(path.join(dir, "defekt.json"), JSON.stringify({ smtp: "http://x", recipients: [], rateLimit: { timespan: "60" } }));
    proc.kill("SIGHUP");
    await wait(400);
    assert.match(log, /Target defekt is invalid: smtp: .*recipients: .*rateLimit\.timespan/s);
    fs.rmSync(path.join(dir, "defekt.json"));
});
