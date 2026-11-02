import {NextFunction, Request, Response, Router} from "express";
import formidable, {Files} from "formidable";
import { firstValues } from 'formidable/src/helpers/firstValues.js';
import {TargetManager} from "./services/targetManager";
import {Target} from "./@types/target";
import {RateLimiter} from "./services/rateLimiter";
import validate from "./services/validate";
import {postBody} from "./models/post";
import {EmailService} from "./services/email";
import {CaptchaService} from "./services/captcha";
import getRedirectUrl from "./util/redirect";

const router: Router = Router();

/**
 * Return the allowed origin that matches the request, or null.
 * `origin` in a target can be a single string or a list of strings.
 */
function matchOrigin(target: Target, requestOrigin: string | undefined): string | null {
    const allowed = ([] as string[]).concat(target.origin ?? []);

    if(allowed.length < 1) return "*";
    if(requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;

    return null;
}

/**
 * Check if target exist, validate origin and send CORS headers.
 */
router.use("/:target", async (req: Request, res: Response, next: NextFunction) => {

    // Check if target exist
    if(!TargetManager.targets.has(req.params.target)) {
        return res.sendStatus(404);
    }

    let target: Target = TargetManager.targets.get(req.params.target);

    // CORS: answer with the matching origin only, never a list
    const origin = matchOrigin(target, req.header("origin"));

    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Origin", origin ?? ([] as string[]).concat(target.origin)[0]);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    if(req.method === "OPTIONS") {
        return res.status(200).end();
    }

    // Check origin
    if(!origin) {
        if(target.redirect?.error) return res.redirect(getRedirectUrl(req, target.redirect.error));
        return res.status(403).end();
    }

    // Authentication
    if(target.key) {
        let bearer = /Bearer (.+)/.exec(req.headers.authorization);

        if(!bearer || bearer[1] !== target.key) {
            if(target.redirect?.error) return res.redirect(getRedirectUrl(req, target.redirect.error));
            return res.status(401).end();
        }
    }

    return next();

});

router.post("/:target", async (req: Request, res: Response) => {

    // Check rate limit
    if(!await RateLimiter.consume(req.params.target, req.ip)) {
        return res.status(429).end();
    }

    let target: Target = TargetManager.targets.get(req.params.target);
    let files: Files = {};

    // Uploads are off unless the target allows them; the size is capped either way
    const form = formidable({
        maxFileSize: (target.maxFileSizeMb ?? 5) * 1024 * 1024,
        maxFiles: target.allowUploads ? 5 : 0
    });

    try {
        let fields: any;

        if(req.is("application/json")) {
            // express.json() has already consumed the stream, so formidable cannot parse it
            fields = req.body ?? {};
        } else {
            const [fieldsMultiple, parsedFiles] = await form.parse(req);
            files = parsedFiles;
            fields = firstValues(form, fieldsMultiple, []);
        }

        // Honeypot: a filled hidden field means a bot. Pretend success, send nothing.
        if(target.honeypot && fields[target.honeypot]) {
            if(target.redirect?.success) return res.redirect(getRedirectUrl(req, target.redirect.success));
            return res.status(200).end();
        }

        const validationResult = validate(fields, postBody);

        // validate fields
        if(validationResult.error) {
            return res.status(422).json(validationResult);
        }

        // Check captcha
        if(target.captcha) {
            let userCaptchaResponse = fields["g-recaptcha-response"] || fields["h-captcha-response"] || null;
            userCaptchaResponse = userCaptchaResponse instanceof Array ? userCaptchaResponse[0] : userCaptchaResponse
            let verified = await CaptchaService.verifyCaptcha(target.captcha, userCaptchaResponse);

            if(!verified) {
                if(target.redirect?.error) return res.redirect(getRedirectUrl(req, target.redirect.error));
                return res.status(400).send({ message: "captcha verification failed" }).end();
            }
        }

        // extract fields
        const fieldFrom = fields["from"] instanceof Array ? fields["from"][0] : fields["from"]
        const fieldFirstName = fields["firstName"] instanceof Array ? fields["firstName"][0] : fields["firstName"]
        const fieldLastName = fields["lastName"] instanceof Array ? fields["lastName"][0] : fields["lastName"]
        const fieldSubjectPrefix = fields["subjectPrefix"] instanceof Array ? fields["subjectPrefix"][0] : fields["subjectPrefix"] ?? ""
        const subject = (target.subjectPrefix ?? "") + fieldSubjectPrefix + (fields["subject"] instanceof Array ? fields["subject"][0] : fields["subject"])
        const fieldBody = fields["body"] instanceof Array ? fields["body"][0] : fields["body"]

        // send email
        // With `fixedFrom`, the header/envelope "from" always stays the target's
        // own address (some SMTP providers reject a "from" they don't own),
        // while the visitor's address is only used as Reply-To.
        const sender = EmailService.formatFromField(fieldFrom ?? target.from, fieldFirstName, fieldLastName);
        let from;
        let replyTo;

        if (target.fixedFrom) {
            from = EmailService.formatFromField(target.from, fieldFirstName, fieldLastName);
            replyTo = fieldFrom ? sender : from;
        } else {
            from = sender;
            replyTo = sender;
        }

        let sent = await EmailService.sendMail(req.params.target, from, replyTo, subject, fieldBody, files);

        if(sent instanceof Error || !sent) {
            if(target.redirect?.error) return res.redirect(getRedirectUrl(req, target.redirect.error));
            // The SMTP error stays in the log; the visitor only gets a generic message
            return res.status(500).send({ message: "Sending the email failed" }).end();
        }

        if(target.redirect?.success) {
            return res.redirect(getRedirectUrl(req, target.redirect.success));
        }

        return res.status(200).end();
    } catch (err) {
        // Too many or too large files (or any other parse problem)
        const code = (err as any)?.httpCode;
        if(target.redirect?.error) return res.redirect(getRedirectUrl(req, target.redirect.error));
        return res.status(code === 413 || code === 400 ? code : 500).send({ message: "Parse Error" }).end();
    } finally {
        EmailService.removeTempFiles(files);
    }
});

router.all('/{*splat}', (req: Request, res: Response) => res.status(404).end());

export default router;
