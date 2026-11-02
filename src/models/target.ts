export const targetModel = {
    smtp: {
        type: "string",
        presence: { allowEmpty: false },
        url: {
            schemes: ["smtp", "smtps"],
            allowLocal: true
        }
    },
    origin: {
        presence: false
    },
    honeypot: {
        type: "string",
        presence: false
    },
    allowHtml: {
        type: "boolean",
        presence: false
    },
    allowUploads: {
        type: "boolean",
        presence: false
    },
    maxFileSizeMb: {
        type: "number",
        presence: false
    },
    recipients: {
        type: "array",
        presence: { allowEmpty: false }
    },
    from: {
        type: "string",
        presence: false
    },
    subjectPrefix: {
        type: "string",
        presence: false
    },
    redirect: {
        type: "object",
        presence: false
    },
    "redirect.success": {
        type: "string",
        presence: false
    },
    "redirect.error": {
        type: "string",
        presence: false
    },
    key: {
        type: "string",
        presence: false
    },
    fixedFrom: {
        type: "boolean",
        presence: false
    },
    rateLimit: {
        type: "object",
        presence: { allowEmpty: false }
    },
    "rateLimit.timespan": {
        type: "number",
        presence: true
    },
    "rateLimit.requests": {
        type: "number",
        presence: true
    },
    captcha: {
        type: "object",
        presence: false
    },
    "captcha.provider": {
        type: "string",
        inclusion: ["recaptcha", "hcaptcha"]
    }
}