export interface Target {
    smtp: string;
    /** Erlaubte Origin(s), z. B. "https://example.org" oder eine Liste. Leer = alle. */
    origin?: string | string[];
    recipients: string[];
    from?: string;
    subjectPrefix?: string;
    redirect?: Redirects;
    key?: string;
    /**
     * If true, the header/envelope "from" always uses `from` (never the
     * request's own from field) - the request's from is used as Reply-To
     * instead. Needed for SMTP providers (e.g. Mailcow) that reject a
     * "from" address not owned by the authenticated account.
     */
    fixedFrom?: boolean;
    /**
     * Name eines Honeypot-Feldes. Ist es in der Anfrage gefüllt, wird die Anfrage
     * stillschweigend als Erfolg behandelt, aber keine Mail versendet.
     */
    honeypot?: string;
    /** Erlaubt HTML im Mail-Body. Standard: false, der Body wird als reiner Text versendet. */
    allowHtml?: boolean;
    /** Erlaubt Dateianhänge (Uploads). Standard: false, Anfragen mit Dateien werden abgelehnt. */
    allowUploads?: boolean;
    /** Maximale Größe je Datei in MB, wenn Uploads erlaubt sind. Standard: 5. */
    maxFileSizeMb?: number;
    rateLimit?: TargetRateLimit;
    captcha?: TargetCaptchaOptions
}

export interface Redirects {
    success?: string;
    error?: string
}

export interface TargetRateLimit {
    timespan: number;
    requests: number;
}

export interface TargetCaptchaOptions {
    provider: CaptchaProvider;
    secret: string;
}

export enum CaptchaProvider {
    RECAPTCHA = "recaptcha",
    HCAPTCHA = "hcaptcha"
}