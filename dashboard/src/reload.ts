import { execFile } from "child_process";
import { promisify } from "util";
import { maskSmtp } from "./targets";
import type { ReloadMode } from "./config";

const execFileAsync = promisify(execFile);

export type Docker = (...args: string[]) => Promise<{ stdout: string; stderr: string }>;

export const dockerCli: Docker = (...args) => execFileAsync("docker", args, { maxBuffer: 16 * 1024 * 1024 });

const RELOAD_OK = "Targets reloaded";
const RELOAD_FAILED = "Reload failed";

interface Attempt {
    ok: boolean;
    error?: string;
    crashed?: boolean;
}

export interface ApplyResult {
    ok: boolean;
    action?: string;
    error?: string;
}

export interface ContainerStatus {
    state: string;
    health: string;
}

export interface ReloaderOptions {
    mode: ReloadMode;
    container: string;
    docker?: Docker;
    sleep?: (ms: number) => Promise<void>;
    /** How often and how often to look for the result in the container log (hup) / container state (restart) */
    pollMs?: number;
    hupPolls?: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Makes Mailform pick up changed target files and checks that it worked.
 * - restart: `docker restart`, then the container must stay `running`.
 * - hup: SIGHUP, then the result is read from the container log.
 *   Only for an image that has the SIGHUP handler: an older one exits on SIGHUP.
 */
export class Reloader {
    private readonly docker: Docker;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly pollMs: number;
    private readonly hupPolls: number;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly options: ReloaderOptions) {
        this.docker = options.docker ?? dockerCli;
        this.sleep = options.sleep ?? realSleep;
        this.pollMs = options.pollMs ?? 250;
        this.hupPolls = options.hupPolls ?? 20;
    }

    get mode(): ReloadMode {
        return this.options.mode;
    }

    /** State of the Mailform container, for display. Never throws. */
    async status(): Promise<ContainerStatus> {
        try {
            const { stdout } = await this.docker(
                "inspect", "-f", "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}", this.options.container
            );
            const [state, health] = stdout.trim().split("|");
            return { state: state || "unknown", health: health || "" };
        } catch {
            return { state: "unknown", health: "" };
        }
    }

    /**
     * Apply a change and verify it. If that fails, `undo` restores the old files and Mailform reloads again,
     * so one bad target can't take down every form. Calls are serialized, so log lines of one reload are
     * never attributed to another.
     */
    apply(undo?: () => void): Promise<ApplyResult> {
        const run = this.queue.then(() => this.applyNow(undo));
        this.queue = run.catch(() => undefined);
        return run;
    }

    private async applyNow(undo?: () => void): Promise<ApplyResult> {
        const hup = this.options.mode === "hup";
        const result = await this.reload();
        if (result.ok) return { ok: true, action: hup ? "neu geladen" : "neu gestartet" };

        let rollbackNote = "";
        if (undo) {
            try {
                undo();
                const again = await this.reload();
                if (!again.ok) rollbackNote = " ACHTUNG: Auch das Neuladen nach dem Zurückrollen ist fehlgeschlagen, bitte Mailform prüfen.";
            } catch {
                rollbackNote = " ACHTUNG: Zurückrollen fehlgeschlagen, bitte Zieldateien prüfen.";
            }
        }

        const detail = hup
            ? `Mailform hat die Änderung nicht übernommen (${result.error}) - die Änderung wurde zurückgerollt.`
            : result.crashed
              ? "Mailform ist nach dieser Änderung abgestürzt (ungültiges Target) - die Änderung wurde automatisch zurückgerollt."
              : `Mailform konnte nicht neu gestartet werden (${result.error}) - die Änderung wurde zurückgerollt.`;

        return { ok: false, error: detail + rollbackNote };
    }

    private reload(): Promise<Attempt> {
        return this.options.mode === "hup" ? this.sendHup() : this.restart();
    }

    private async restart(): Promise<Attempt> {
        try {
            await this.docker("restart", this.options.container);
        } catch (e) {
            return { ok: false, error: (e as Error).message };
        }

        // Give the process a moment to either start cleanly or crash-loop.
        for (let i = 0; i < 4; i++) {
            await this.sleep(750);
            try {
                const { stdout } = await this.docker("inspect", "-f", "{{.State.Status}}", this.options.container);
                const state = stdout.trim();
                if (state === "running") return { ok: true };
                if (state === "restarting" || state === "exited") return { ok: false, crashed: true };
            } catch (e) {
                return { ok: false, error: (e as Error).message };
            }
        }
        return { ok: false, crashed: true };
    }

    private async sendHup(): Promise<Attempt> {
        const since = new Date().toISOString();

        try {
            await this.docker("kill", "--signal=HUP", this.options.container);
        } catch (e) {
            return { ok: false, error: (e as Error).message };
        }

        for (let i = 0; i < this.hupPolls; i++) {
            await this.sleep(this.pollMs);

            let logs: string;
            try {
                const { stdout, stderr } = await this.docker("logs", "--since", since, this.options.container);
                logs = `${stdout}\n${stderr}`;
            } catch (e) {
                return { ok: false, error: (e as Error).message };
            }

            const failed = logs.split("\n").filter((line) => line.includes(RELOAD_FAILED)).pop();
            if (failed) {
                // The reason can contain parts of a target file, e.g. an SMTP URL with its password
                const reason = String(maskSmtp(failed.slice(failed.indexOf(RELOAD_FAILED)).trim()));
                return { ok: false, error: reason.replace(/smtps?:\/\/[^\s"']*/g, "smtp://***") };
            }
            if (logs.includes(RELOAD_OK)) return { ok: true };
        }

        return { ok: false, error: "Keine Rückmeldung von Mailform nach dem Neuladen (weder Erfolg noch Fehler im Log)" };
    }
}
