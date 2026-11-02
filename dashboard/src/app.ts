import express, { NextFunction, Request, Response } from "express";
import cookieSession from "cookie-session";
import path from "path";
import crypto from "crypto";
import type { Config } from "./config";
import { Reloader } from "./reload";
import {
    NAME_RE, TargetStore, buildTargetObject, maskTarget, mergeEdit, validateTargetBody
} from "./targets";

// simple in-memory brute-force guard: max 8 failed attempts per IP per 15min
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

function timingSafeEqual(a: unknown, b: unknown): boolean {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) {
        // still run a compare of equal length to avoid a trivial timing leak on length
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

declare module "express-serve-static-core" {
    interface Request {
        session?: { authed?: boolean } | null;
    }
}

export function createApp(config: Config, store: TargetStore, reloader: Reloader) {
    const publicDir = path.join(__dirname, "..", "public");
    const failedAttempts = new Map<string, { count: number; first: number }>();

    const isLockedOut = (ip: string) => {
        const entry = failedAttempts.get(ip);
        if (!entry) return false;
        if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
            failedAttempts.delete(ip);
            return false;
        }
        return entry.count >= LOGIN_MAX_ATTEMPTS;
    };

    const recordFailedAttempt = (ip: string) => {
        const entry = failedAttempts.get(ip);
        if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) failedAttempts.set(ip, { count: 1, first: Date.now() });
        else entry.count += 1;
    };

    const app = express();
    // Only the local reverse proxy is trusted: req.ip is the address it appended, a client-supplied X-Forwarded-For prefix is ignored
    app.set("trust proxy", "loopback");
    app.disable("x-powered-by");

    app.use((_req, res, next) => {
        res.setHeader(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "same-origin");
        res.setHeader("Cache-Control", "no-store");
        next();
    });

    app.use(express.json());
    app.use((err: Error & { status?: number }, _req: Request, res: Response, next: NextFunction) => {
        if (res.headersSent) return next(err);
        res.status(err.status && err.status < 500 ? err.status : 500).json({ error: "Ungültige Anfrage" });
    });
    app.use(
        cookieSession({
            name: "mfsession",
            keys: [config.sessionSecret],
            maxAge: 12 * 60 * 60 * 1000,
            httpOnly: true,
            sameSite: "lax"
        })
    );

    app.post("/api/login", (req, res) => {
        const ip = req.ip ?? "";
        if (isLockedOut(ip)) {
            return res.status(429).json({ error: "Zu viele Fehlversuche. Bitte später erneut versuchen." });
        }

        const { username, password } = req.body || {};
        const userOk = typeof username === "string" && timingSafeEqual(username, config.user);
        const passOk = typeof password === "string" && timingSafeEqual(password, config.pass);

        if (!userOk || !passOk) {
            recordFailedAttempt(ip);
            return res.status(401).json({ error: "Benutzername oder Passwort falsch" });
        }

        failedAttempts.delete(ip);
        req.session!.authed = true;
        res.json({ ok: true });
    });

    app.post("/api/logout", (req, res) => {
        req.session = null;
        res.json({ ok: true });
    });

    app.get("/api/session", (req, res) => {
        res.json({ authed: !!(req.session && req.session.authed) });
    });

    // The login page and its assets are the only public files
    const publicFile = (file: string) => (_req: Request, res: Response) => res.sendFile(file, { root: publicDir });
    app.get("/login", publicFile("login.html"));
    app.get("/login.js", publicFile("login.js"));
    app.get("/app.css", publicFile("app.css"));
    app.get("/theme.js", publicFile("theme.js"));
    app.get("/fonts/:file", (req, res) => res.sendFile(path.basename(String(req.params.file)), { root: path.join(publicDir, "fonts") }));

    const requireAuth = (req: Request, res: Response, next: NextFunction) => {
        if (req.session && req.session.authed) return next();
        if (req.path.startsWith("/api/")) return res.status(401).json({ error: "not authenticated" });
        return res.redirect("/login");
    };

    app.use(requireAuth);
    app.use(express.static(publicDir));

    app.get("/api/config", async (_req, res) => {
        res.json({ defaultSmtp: config.defaultSmtp, publicHost: config.publicHost, reloadMode: reloader.mode });
    });

    app.get("/api/status", async (_req, res) => {
        res.json({ reloadMode: reloader.mode, ...(await reloader.status()) });
    });

    app.get("/api/generate-key", (_req, res) => {
        res.json({ key: crypto.randomBytes(24).toString("hex") });
    });

    app.get("/api/targets", (_req, res) => {
        res.json(store.list().map(({ name, target, error }) => (target ? { name, ...maskTarget(target) } : { name, error })));
    });

    const validName = (req: Request, res: Response): string | null => {
        const name = String(req.params.name);
        if (!NAME_RE.test(name)) {
            res.status(400).json({ error: "invalid name" });
            return null;
        }
        return name;
    };

    app.get("/api/targets/:name", (req, res) => {
        const name = validName(req, res);
        if (!name) return;
        if (!store.exists(name)) return res.status(404).json({ error: "not found" });
        res.json({ name, ...maskTarget(store.read(name)) });
    });

    app.post("/api/targets", async (req, res) => {
        const { name, ...body } = req.body ?? {};

        if (!name || !NAME_RE.test(name)) {
            return res.status(400).json({
                error: "Ungültiger Name. Nur Kleinbuchstaben, Zahlen, '-' und '_', 2-64 Zeichen, muss mit Buchstabe/Zahl beginnen."
            });
        }

        if (store.exists(name)) {
            return res.status(409).json({ error: "Ein Target mit diesem Namen existiert bereits" });
        }

        const errors = validateTargetBody(body);
        if (errors.length) return res.status(422).json({ errors });

        store.write(name, buildTargetObject(body));

        // A new target that breaks Mailform has no earlier version to restore: just remove it.
        const result = await reloader.apply(() => store.remove(name));

        if (!result.ok) return res.status(422).json({ error: result.error });
        res.json({ ok: true, name, restart: result });
    });

    app.put("/api/targets/:name", async (req, res) => {
        const name = validName(req, res);
        if (!name) return;
        if (!store.exists(name)) return res.status(404).json({ error: "not found" });

        const errors = validateTargetBody(req.body ?? {});
        if (errors.length) return res.status(422).json({ errors });

        const previousContent = store.readRaw(name);
        store.write(name, mergeEdit(req.body, JSON.parse(previousContent)));

        const result = await reloader.apply(() => store.writeRaw(name, previousContent));

        if (!result.ok) return res.status(422).json({ error: result.error });
        res.json({ ok: true, name, restart: result });
    });

    app.delete("/api/targets/:name", async (req, res) => {
        const name = validName(req, res);
        if (!name) return;
        if (!store.exists(name)) return res.status(404).json({ error: "not found" });

        const previousContent = store.readRaw(name);
        store.remove(name);

        const result = await reloader.apply(() => store.writeRaw(name, previousContent));

        if (!result.ok) return res.status(422).json({ error: result.error });
        res.json({ ok: true, restart: result });
    });

    return app;
}
