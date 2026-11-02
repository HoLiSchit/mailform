# 📨 MailForm
> The lightweight email service for contact forms and more!

This is basically a minimal self-hosted open source alternative to [Formspree](https://formspree.io/) and [SendGrid](https://sendgrid.com/).

Unlike other mail services (that often gives you an API key for backends), this self-hosted mail service is designed to be accessed directly from a frontend, but also offers you the option to use it as a mail service with configurable API keys.

### Features
- Access via API or HTML form with redirects
- Configurable CORS and Origin restriction
- ReCaptcha and hCaptcha support
- Custom rate limits for every target
- Optional API keys

### Planned features
- [ ] Email Templates
- [x] File Uploads for attachments
- [x] ReCaptcha and hCaptcha support

### Used frameworks & libraries
- [Express](https://expressjs.com/)
- [Typescript](https://www.typescriptlang.org/)
- [Nodemailer](https://nodemailer.com/about/)
- [zod](https://zod.dev/)
- [rate-limiter-flexible](https://www.npmjs.com/package/rate-limiter-flexible)
- [axios](https://github.com/axios/axios)

## 💽 Installation
### Docker
```shell
git clone https://github.com/Feuerhamster/mailform.git
cd mailform
docker build -t Feuerhamster/mailform .
docker run Feuerhamster/mailform
  -e PORT=3000
  -e PROXY=true
  -v /your/custom/path /app/targets
```

The image runs `node dist/main.js` directly (so signals reach the process) as the non-root user `node` (uid 1000) and has a `HEALTHCHECK` against `/healthz`.

**Hardened Compose setup:** see [docker-compose.example.yml](docker-compose.example.yml): `init`, read-only root filesystem with `tmpfs: /tmp` (uploads), all capabilities dropped, `no-new-privileges`, port bound to `127.0.0.1`, targets mounted read-only, log rotation (3 x 10 MB).

**File permissions:** target files contain SMTP passwords and should be mode `0600`. The container user must be able to read them: set `user: "<uid>:<gid>"` in Compose (or `docker run --user`) to the owner of the files (`id mailform` on the host), or `chown`/`chgrp` the files to uid/gid 1000. Otherwise Mailform cannot read the targets and does not start.

### Manually
*Requires NodeJS 20 or higher*

```shell
git clone https://github.com/Feuerhamster/mailform.git
cd mailform
npm install
npm run build
npm run start
```

## ⚙️Configuration
### Application
MailForm can be configured using environment variables.

**Environment variables:**
- `PORT` The port on which the application starts. If not provided, a random port will be selected.
- `TARGETS_DIR` Path to the directory with your target files. Default is `/targets` of the project root.
- `PROXY` A boolean that enables the "trust proxy" option of Express. **Enable this if you're using MailForm behind a reverse proxy like NGINX!** Default value is false.

### Reloading targets, health check
Targets are read at startup. To apply changes **without a restart**, send `SIGHUP`:

```shell
kill -HUP <pid>
docker kill --signal=HUP mailform
```

Mailform logs `Targets reloaded` on success. If a target is invalid it logs `Reload failed: <reason>` and keeps running with the previous, working targets. **Only send SIGHUP to a version that contains this handler**, an older one exits on SIGHUP.

`GET /healthz` returns `200 ok` (used by the Docker `HEALTHCHECK`). `SIGTERM`/`SIGINT` finish running requests before exiting.

### Targets
Targets are your different endpoints each with its own rate limits and smtp provider.
They are JSON files placed in the `/targets` directory. 

**Example target:**
```json
{
    "smtp": "smtps://username:password@smtp.example.com",
    "origin": "my-website.com",
    "recipients": ["example@example.com"],
    "rateLimit": {
        "timespan": 300,
        "requests": 1
    },
    "captcha": {
        "provider": "hcaptcha",
        "secret": "xxx"
    }
}
```

**Available fields:**
- `smtp` *required* | A valid SMTP(S) url.
- `origin` *optional* | A HTTP origin (scheme + host, **no path**, e.g. `https://example.org`) or a list of origins that is used for CORS and to restrict access. Default is * if not set. The `Access-Control-Allow-Origin` header only ever contains the matching origin.
- `honeypot` *optional* | Name of a hidden form field. If a request fills it, it is treated as a bot: the response is a success, but no email is sent.
- `allowHtml` *optional* | Default `false`: the `body` is sent as plain text, line breaks are kept and HTML from visitors is not rendered. Set `true` to send the body as HTML.
- `allowUploads` *optional* | Default `false`: requests with files are rejected. Set `true` to allow up to 5 attachments. Temporary files are deleted after the request.
- `maxFileSizeMb` *optional* | Maximum size per file in MB when uploads are allowed. Default is 5.
- `recipients` *required* | An array of email addresses which should receive the email.
- `from` *optional* | The "from" field of an email. This is used as fallback if no "from" is provided in the request.
- `fixedFrom` *optional* | If `true`, the email's "from" header/envelope always uses this target's `from` address, even if the request provides its own `from`. The request's `from` is then only used as the `Reply-To` header instead. Useful for SMTP providers (e.g. Mailcow) that reject a "from" address the authenticated account doesn't own.
- `subjectPrefix` *optional* | A target-wide prefix for the email subject.
- `key` *optional* | A string used as API key if you want to restrict access to this target.
- `redirect` *optional*:
  - `success` *optional*: A valid relative or absolute URL to redirect the user if the mail was sent successful.
  - `error` *optional*: A valid relative or absolute URL to redirect the user if the mail can't be sent due to an error.
- `rateLimit` *required*:
    - `timespan` *required* | Timespan (in seconds) for the rate limiter to reset.
    - `requests` *required* | Allowed amount of requests in the given timespan.
- `captcha` *optional*:
  - `provider` *required if captcha* | The captcha provider ("recaptcha" or "hcaptcha").
  - `secret` *required if captcha* | Secret key for your captcha.

For the exact validations of the fields please see here: [target.ts](/src/models/target.ts)

## 📫 Usage
### Fields
Whether as formular data or json, the fields are the same.

- `from` *optional* | The email address of the sender. If this filed is not set, the "from" field of your target will be used.
- `firstName` *optional* | A classic first name filed which will be attached to the "from" field of the email.
- `lastName` *optional* | A classic last name filed which will be attached to the "from" field of the email.
- `subjectPrefix` *optional* | A Prefix for the email subject.
- `subject` *required* | The email subject.
- `body` *required* | The email body. Sent as plain text unless the target sets `allowHtml`.
  
- `g-recaptcha-response` *only required if target use captcha* | Field for ReCaptcha response.
- `h-captcha-response` *only required if target use captcha* | Field for hCaptcha response.

For the exact validations of the fields please see here: [posts.ts](/src/models/post.ts)

**Important info:** If a redirect is configured for your target, it will always return the redirect, even if you make an API call.
If no redirect is set, http status codes will be returned.

### Captchas
MailForm supports both [ReCaptcha](https://www.google.com/recaptcha/) and [hCaptcha](https://www.hcaptcha.com/).

To use captchas, you have to configure it in your target.

On a request, the corresponding field (`g-recaptcha-response` for ReCaptcha or `h-captcha-response` for hCaptcha) have to be filled for validation.
If you use the captcha widget in a form, this will happen automatically.
If you use an API request, you have to fill it manually.

### HTML Form

**Example html form:**
```html
<form method="post" action="https://mailform.yourserver.com/your-target-file-name">
    <input type="email" name="from" placeholder="Sender's email address"/>
    <input type="text" name="firstName" placeholder="First name" />
    <input type="text" name="lastName" placeholder="Last name" />
    <input type="hidden" name="subjectPrefix" value="[App-Question] " />
    <input type="text" name="subject" placeholder="Subject" />
    <div class="g-recaptcha" data-sitekey="your_site_key"></div>
    <textarea name="body" placeholder="Your message"></textarea>
</form>
```

To work properly, you may want to configure a redirect in the target.

### API
Simply make a request to `/:target` (replace with your target's file name).
If you have set an API key, add the HTTP Authorization header with type `Bearer` and then the key.
Make sure to also use the right origin (if not set automatically because the request is from a backend).

`application/json` requests work as well as multipart and urlencoded forms.

**Example request:** 
```http request
POST https://mailform.yourserver.com/your-target-file-name
Origin: your-configured-origin.com
Content-Type: application/json
Authorization: Bearer your-optional-api-key

{
  "from": "example@example.com",
  "subject": "your subect",
  "body": "your message",
}
```

**Possible status codes:**
- `200` Email was successfully sent.
- `401` Authentication failed: API key not present or wrong.
- `403` Forbidden because of wrong origin header.
- `404` Target not found.
- `500` Sending the email failed.

## 🖥️ Admin Dashboard
An optional, self-hosted web UI for managing targets (recipients, SMTP, API keys, rate limits) without editing JSON files by hand. See [dashboard/README.md](/dashboard/README.md).

## 🧪 Tests
```shell
npm test
```
Runs the integration tests (Node test runner, builds first).

## 🔒 Dependencies
`npm audit` reports 0 known vulnerabilities for the main project and for `dashboard/`. Request and target validation use [zod](https://zod.dev); mail is sent with [nodemailer](https://nodemailer.com) 10 (Node 20 or higher).

## 👋 Contribution
Feel free to create issues and pull requests if you want!

Please keep up with the code style and discuss new features beforehand with the project owner.
