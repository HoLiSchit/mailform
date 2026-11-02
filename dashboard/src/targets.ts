import fs from "fs";
import path from "path";

export const NAME_RE = /^[a-z0-9][a-z0-9-_]{1,63}$/;

/** Secrets (SMTP password, captcha secret) never go to the browser */
export const MASK = "********";

export type Target = Record<string, any>;

/** Fields the form manages. Everything else (redirect, captcha, maxFileSizeMb ...) is kept when editing. */
const UI_FIELDS = ["smtp", "recipients", "rateLimit", "origin", "from", "fixedFrom", "subjectPrefix", "key", "honeypot", "allowHtml", "allowUploads"];

export function maskSmtp(url: unknown): unknown {
    return typeof url === "string" ? url.replace(/^(smtps?:\/\/[^:/@]+:)[^@]*(@)/, `$1${MASK}$2`) : url;
}

export function maskTarget(target: Target): Target {
    const out = { ...target };
    if (out.smtp) out.smtp = maskSmtp(out.smtp);
    if (out.captcha && out.captcha.secret) out.captcha = { ...out.captcha, secret: MASK };
    return out;
}

/** If the mask comes back, the stored password stays */
export function restoreSmtp(newUrl: unknown, previousUrl: unknown): unknown {
    if (typeof newUrl !== "string" || !newUrl.includes(`:${MASK}@`) || typeof previousUrl !== "string") return newUrl;
    const prev = /^(smtps?:\/\/[^:/@]+:)([^@]*)(@.*)$/.exec(previousUrl);
    return prev ? newUrl.replace(`:${MASK}@`, `:${prev[2]}@`) : newUrl;
}

export function validateTargetBody(body: Target): string[] {
    const errors: string[] = [];

    if (!body.smtp || typeof body.smtp !== "string" || !/^smtps?:\/\/[^\s]+@[^\s@]+(:\d+)?\/?$/.test(body.smtp)) {
        errors.push("smtp muss eine gültige smtp(s)://user:pass@host[:port]-URL sein");
    }

    if (
        !Array.isArray(body.recipients) ||
        body.recipients.length === 0 ||
        !body.recipients.every((r: unknown) => typeof r === "string" && r.includes("@"))
    ) {
        errors.push("recipients muss ein Array mit mindestens einer gültigen E-Mail-Adresse sein");
    }

    if (!body.rateLimit || typeof body.rateLimit.timespan !== "number" || typeof body.rateLimit.requests !== "number") {
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

export function buildTargetObject(body: Target): Target {
    const target: Target = {
        smtp: body.smtp,
        recipients: body.recipients,
        rateLimit: {
            timespan: Number(body.rateLimit.timespan),
            requests: Number(body.rateLimit.requests)
        }
    };

    const origins = ([] as unknown[]).concat(body.origin || []).map((o) => String(o).trim()).filter(Boolean);
    if (origins.length === 1) target.origin = origins[0];
    else if (origins.length > 1) target.origin = origins;
    if (body.honeypot) target.honeypot = String(body.honeypot).trim();
    if (body.allowHtml) target.allowHtml = true;
    if (body.allowUploads) target.allowUploads = true;
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
        target.captcha = { provider: body.captcha.provider, secret: body.captcha.secret };
    }

    return target;
}

/** The target as it will be written when `body` edits `previous`: form fields from the body, the rest from the old file. */
export function mergeEdit(body: Target, previous: Target): Target {
    const merged = { ...body, smtp: restoreSmtp(body.smtp, previous.smtp) };
    const kept = Object.fromEntries(Object.entries(previous).filter(([key]) => !UI_FIELDS.includes(key)));
    return { ...buildTargetObject(merged), ...kept };
}

/** Target files in a directory. They contain credentials, so they are only readable by their owner (0600). */
export class TargetStore {
    constructor(private readonly dir: string) {}

    private file(name: string): string {
        return path.join(this.dir, `${name}.json`);
    }

    exists(name: string): boolean {
        return fs.existsSync(this.file(name));
    }

    read(name: string): Target {
        return JSON.parse(this.readRaw(name));
    }

    readRaw(name: string): string {
        return fs.readFileSync(this.file(name), "utf8");
    }

    list(): { name: string; target?: Target; error?: string }[] {
        fs.mkdirSync(this.dir, { recursive: true });
        return fs
            .readdirSync(this.dir)
            .filter((f) => f.endsWith(".json"))
            .sort()
            .map((f) => {
                const name = path.basename(f, ".json");
                try {
                    return { name, target: this.read(name) };
                } catch (e) {
                    return { name, error: "invalid JSON: " + (e as Error).message };
                }
            });
    }

    write(name: string, target: Target): void {
        this.writeRaw(name, JSON.stringify(target, null, 2));
    }

    writeRaw(name: string, content: string): void {
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(this.file(name), content, { mode: 0o600 });
        fs.chmodSync(this.file(name), 0o600);
    }

    remove(name: string): void {
        fs.rmSync(this.file(name), { force: true });
    }
}
