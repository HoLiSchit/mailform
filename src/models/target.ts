import {z} from "zod";

export const targetSchema = z.looseObject({
    smtp: z.url({protocol: /^smtps?$/}),
    /** One allowed origin or a list. Empty/missing = all. */
    origin: z.union([z.string(), z.array(z.string())]).optional(),
    honeypot: z.string().optional(),
    allowHtml: z.boolean().optional(),
    allowUploads: z.boolean().optional(),
    maxFileSizeMb: z.number().positive().optional(),
    recipients: z.array(z.string()).min(1),
    from: z.string().optional(),
    subjectPrefix: z.string().optional(),
    redirect: z.looseObject({
        success: z.string().optional(),
        error: z.string().optional()
    }).optional(),
    key: z.string().optional(),
    fixedFrom: z.boolean().optional(),
    rateLimit: z.looseObject({
        timespan: z.number(),
        requests: z.number()
    }),
    captcha: z.looseObject({
        provider: z.enum(["recaptcha", "hcaptcha"])
    }).optional()
});
