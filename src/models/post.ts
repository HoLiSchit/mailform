import {z} from "zod";

/** Optional text fields: a form that submits an empty input counts as "not provided". */
const optional = <T extends z.ZodType>(schema: T) =>
    z.preprocess((value) => value === "" ? undefined : value, schema.optional());

export const postSchema = z.looseObject({
    from: optional(z.email()),
    firstName: optional(z.string().min(2).max(100)),
    lastName: optional(z.string().min(2).max(100)),
    subjectPrefix: optional(z.string().min(1).max(255)),
    subject: z.string().min(2).max(255),
    body: z.string().min(5).max(32000),
    "g-recaptcha-response": optional(z.string()),
    "h-captcha-response": optional(z.string())
});
