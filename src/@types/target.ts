export interface Target {
    smtp: string;
    origin: string;
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