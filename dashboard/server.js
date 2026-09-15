const express = require("express");
const cookieSession = require("cookie-session");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

const PORT = process.env.PORT || 3006;
const TARGETS_DIR = process.env.TARGETS_DIR || "/opt/mailform/targets";
const CONTAINER_NAME = process.env.MAILFORM_CONTAINER || "mailform";
const DEFAULT_SMTP = process.env.DEFAULT_SMTP || "";
const PUBLIC_HOST = process.env.PUBLIC_HOST || "";
const DASH_USER = process.env.DASH_USER || "admin";
const DASH_PASS = process.env.DASH_PASS || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";

if (!DASH_PASS) {
  console.error("DASH_PASS is not set. Refusing to start without a password.");
  process.exit(1);
}

if (!SESSION_SECRET) {
  console.error("SESSION_SECRET is not set. Refusing to start without one.");
  process.exit(1);
}

const NAME_RE = /^[a-z0-9][a-z0-9-_]{1,63}$/;

// simple in-memory brute-force guard: max 8 failed attempts per IP per 15min
const failedAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

function isLockedOut(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    failedAttempts.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) {
    failedAttempts.set(ip, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // still run a compare of equal length to avoid trivial timing leak on length
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

const app = express();
app.set("trust proxy", true);
app.use(express.json());
app.use(
  cookieSession({
    name: "mfsession",
    keys: [SESSION_SECRET],
    maxAge: 12 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
  })
);

app.post("/api/login", (req, res) => {
  const ip = req.ip;
  if (isLockedOut(ip)) {
    return res.status(429).json({ error: "Zu viele Fehlversuche. Bitte später erneut versuchen." });
  }

  const { username, password } = req.body || {};
  const userOk = typeof username === "string" && timingSafeEqual(username, DASH_USER);
  const passOk = typeof password === "string" && timingSafeEqual(password, DASH_PASS);

  if (!userOk || !passOk) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: "Benutzername oder Passwort falsch" });
  }

  failedAttempts.delete(ip);
  req.session.authed = true;
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "not authenticated" });
  return res.redirect("/login");
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, "public")));

function targetPath(name) {
  return path.join(TARGETS_DIR, `${name}.json`);
}

function readTarget(name) {
  const raw = fs.readFileSync(targetPath(name), "utf8");
  return JSON.parse(raw);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dockerRestart() {
  await execAsync(`docker restart ${CONTAINER_NAME}`);
}

async function isContainerHealthy() {
  // Give the process a moment to either start cleanly or crash-loop.
  for (let i = 0; i < 4; i++) {
    await sleep(750);
    try {
      const { stdout } = await execAsync(`docker inspect -f "{{.State.Status}}" ${CONTAINER_NAME}`);
      const status = stdout.trim();
      if (status === "running") return true;
      if (status === "restarting" || status === "exited") return false;
    } catch (e) {
      return false;
    }
  }
  return false;
}

/**
 * Restart Mailform and verify it actually stayed up. If it crash-loops
 * (e.g. because of an invalid target file), run `onUnhealthy` to undo the
 * change and restart again, so one bad target can't take down every form.
 */
async function restartAndVerify(onUnhealthy) {
  try {
    await dockerRestart();
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const healthy = await isContainerHealthy();
  if (healthy) return { ok: true };

  if (onUnhealthy) {
    try {
      onUnhealthy();
      await dockerRestart();
    } catch (e) {
      // fallthrough - report original problem below
    }
  }

  return {
    ok: false,
    error:
      "Mailform ist nach dieser Änderung abgestürzt (ungültiges Target) - die Änderung wurde automatisch zurückgerollt.",
  };
}

function validateTargetBody(body) {
  const errors = [];

  if (!body.smtp || typeof body.smtp !== "string" || !/^smtps?:\/\/[^\s]+@[^\s@]+(:\d+)?\/?$/.test(body.smtp)) {
    errors.push("smtp muss eine gültige smtp(s)://user:pass@host[:port]-URL sein");
  }

  if (
    !Array.isArray(body.recipients) ||
    body.recipients.length === 0 ||
    !body.recipients.every((r) => typeof r === "string" && r.includes("@"))
  ) {
    errors.push("recipients muss ein Array mit mindestens einer gültigen E-Mail-Adresse sein");
  }

  if (
    !body.rateLimit ||
    typeof body.rateLimit.timespan !== "number" ||
    typeof body.rateLimit.requests !== "number"
  ) {
    errors.push("rateLimit.timespan und rateLimit.requests sind erforderlich (Zahlen)");
  }

  if (body.fixedFrom && !body.from) {
    errors.push("Absender-Adresse (from) ist erforderlich, wenn der Absender fest gesetzt werden soll");
  }

  if (body.captcha) {
    if (!["recaptcha", "hcaptcha"].includes(body.captcha.provider)) {
      errors.push("captcha.provider muss 'recaptcha' oder 'hcaptcha' sein");
    }
    if (!body.captcha.secret) {
      errors.push("captcha.secret ist erforderlich, wenn captcha gesetzt ist");
    }
  }

  return errors;
}

function buildTargetObject(body) {
  const target = {
    smtp: body.smtp,
    recipients: body.recipients,
    rateLimit: {
      timespan: Number(body.rateLimit.timespan),
      requests: Number(body.rateLimit.requests),
    },
  };

  if (body.origin) target.origin = body.origin;
  if (body.from) target.from = body.from;
  if (body.fixedFrom) target.fixedFrom = true;
  if (body.subjectPrefix) target.subjectPrefix = body.subjectPrefix;
  if (body.key) target.key = body.key;

  if (body.redirect && (body.redirect.success || body.redirect.error)) {
    target.redirect = {};
    if (body.redirect.success) target.redirect.success = body.redirect.success;
    if (body.redirect.error) target.redirect.error = body.redirect.error;
  }

  if (body.captcha && body.captcha.provider && body.captcha.secret) {
    target.captcha = {
      provider: body.captcha.provider,
      secret: body.captcha.secret,
    };
  }

  return target;
}

app.get("/api/config", (req, res) => {
  res.json({ defaultSmtp: DEFAULT_SMTP, publicHost: PUBLIC_HOST });
});

app.get("/api/generate-key", (req, res) => {
  res.json({ key: crypto.randomBytes(24).toString("hex") });
});

app.get("/api/targets", (req, res) => {
  fs.mkdirSync(TARGETS_DIR, { recursive: true });
  const files = fs.readdirSync(TARGETS_DIR).filter((f) => f.endsWith(".json"));
  const targets = files.map((f) => {
    const name = path.basename(f, ".json");
    try {
      return { name, ...readTarget(name) };
    } catch (e) {
      return { name, error: "invalid JSON: " + e.message };
    }
  });
  res.json(targets);
});

app.get("/api/targets/:name", (req, res) => {
  const { name } = req.params;
  if (!NAME_RE.test(name)) return res.status(400).json({ error: "invalid name" });
  if (!fs.existsSync(targetPath(name))) return res.status(404).json({ error: "not found" });
  res.json({ name, ...readTarget(name) });
});

app.post("/api/targets", async (req, res) => {
  const { name, ...body } = req.body;

  if (!name || !NAME_RE.test(name)) {
    return res.status(400).json({
      error:
        "Ungültiger Name. Nur Kleinbuchstaben, Zahlen, '-' und '_', 2-64 Zeichen, muss mit Buchstabe/Zahl beginnen.",
    });
  }

  if (fs.existsSync(targetPath(name))) {
    return res.status(409).json({ error: "Ein Target mit diesem Namen existiert bereits" });
  }

  const errors = validateTargetBody(body);
  if (errors.length) return res.status(422).json({ errors });

  fs.mkdirSync(TARGETS_DIR, { recursive: true });
  fs.writeFileSync(targetPath(name), JSON.stringify(buildTargetObject(body), null, 2));

  const restart = await restartAndVerify(() => {
    // New target caused a crash-loop: no prior version to restore, just remove it.
    if (fs.existsSync(targetPath(name))) fs.unlinkSync(targetPath(name));
  });

  if (!restart.ok) return res.status(422).json({ error: restart.error });
  res.json({ ok: true, name, restart });
});

app.put("/api/targets/:name", async (req, res) => {
  const { name } = req.params;
  if (!NAME_RE.test(name)) return res.status(400).json({ error: "invalid name" });
  if (!fs.existsSync(targetPath(name))) return res.status(404).json({ error: "not found" });

  const errors = validateTargetBody(req.body);
  if (errors.length) return res.status(422).json({ errors });

  const previousContent = fs.readFileSync(targetPath(name), "utf8");
  fs.writeFileSync(targetPath(name), JSON.stringify(buildTargetObject(req.body), null, 2));

  const restart = await restartAndVerify(() => {
    fs.writeFileSync(targetPath(name), previousContent);
  });

  if (!restart.ok) return res.status(422).json({ error: restart.error });
  res.json({ ok: true, name, restart });
});

app.delete("/api/targets/:name", async (req, res) => {
  const { name } = req.params;
  if (!NAME_RE.test(name)) return res.status(400).json({ error: "invalid name" });
  if (!fs.existsSync(targetPath(name))) return res.status(404).json({ error: "not found" });

  const previousContent = fs.readFileSync(targetPath(name), "utf8");
  fs.unlinkSync(targetPath(name));

  const restart = await restartAndVerify(() => {
    fs.writeFileSync(targetPath(name), previousContent);
  });

  if (!restart.ok) return res.status(422).json({ error: restart.error });
  res.json({ ok: true, restart });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`mailform-dashboard listening on 127.0.0.1:${PORT}`);
});
