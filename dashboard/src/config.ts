export type ReloadMode = "restart" | "hup";

export interface Config {
    port: number;
    targetsDir: string;
    container: string;
    reloadMode: ReloadMode;
    defaultSmtp: string;
    publicHost: string;
    user: string;
    pass: string;
    sessionSecret: string;
}

/** Read the configuration from environment variables. Throws a readable error if it is unusable. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
    const reloadMode = env.RELOAD_MODE || "restart";

    if (reloadMode !== "restart" && reloadMode !== "hup") {
        throw new Error(`RELOAD_MODE must be "restart" or "hup", got "${reloadMode}".`);
    }

    if (!env.DASH_PASS) throw new Error("DASH_PASS is not set. Refusing to start without a password.");
    if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not set. Refusing to start without one.");

    return {
        port: Number(env.PORT || 3006),
        targetsDir: env.TARGETS_DIR || "/opt/mailform/targets",
        container: env.MAILFORM_CONTAINER || "mailform",
        reloadMode,
        defaultSmtp: env.DEFAULT_SMTP || "",
        publicHost: env.PUBLIC_HOST || "",
        user: env.DASH_USER || "admin",
        pass: env.DASH_PASS,
        sessionSecret: env.SESSION_SECRET
    };
}
