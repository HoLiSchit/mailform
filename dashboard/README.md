# Mailform Admin Dashboard

A minimal, self-hosted admin UI for managing Mailform targets without touching
JSON files or SSH. Manage recipients, SMTP settings, API keys, rate limits and
the `fixedFrom` option through a small web UI, protected by a session-based
login.

Mailform loads targets from `TARGETS_DIR`, so an invalid target file must
never reach a running service. This dashboard guards against that: after every
create/edit/delete it makes Mailform pick up the change and verifies that this
worked - if not, the change is rolled back automatically and Mailform is told
to load the old state again. There are two ways to do that, see `RELOAD_MODE`.

## Requirements
- Node.js 20+
- Docker, with the dashboard process able to run `docker restart <container>`
  (e.g. running as root or a user in the `docker` group)
- Mailform running as a Docker container, with its `targets` directory
  bind-mounted from the host (the dashboard writes directly into that
  directory)

## Setup

```shell
cd dashboard
npm ci
npm run build        # TypeScript -> dist/
npm prune --omit=dev # optional: drop build tools on the server
```

`server.js` stays the entry point (`node server.js`), it starts `dist/main.js`. Re-run `npm run build` after every update.

Configure via environment variables:

| Variable | Description | Default |
|---|---|---|
| `PORT` | Port the dashboard listens on | `3006` |
| `TARGETS_DIR` | Path to Mailform's targets directory (same path on the host as mounted into the Mailform container) | `/opt/mailform/targets` |
| `MAILFORM_CONTAINER` | Name of the Mailform Docker container to restart/signal after changes | `mailform` |
| `RELOAD_MODE` | `restart` or `hup`, see below | `restart` |
| `DASH_USER` | Dashboard login username | `admin` |
| `DASH_PASS` | Dashboard login password *(required)* | - |
| `SESSION_SECRET` | Random secret used to sign the session cookie *(required)* | - |
| `DEFAULT_SMTP` | SMTP URL pre-filled when creating a new target | *(empty)* |
| `PUBLIC_HOST` | Public base URL Mailform is reachable at (e.g. `https://forms.example.com`), shown in the UI as the endpoint for each target. Leave empty to just show the relative path (`/<target>`). | *(empty)* |

Generate `DASH_PASS` and `SESSION_SECRET` yourself, e.g.:

```shell
openssl rand -hex 32
```

Start it (directly, or with a process manager like pm2):

```shell
PORT=3006 TARGETS_DIR=/opt/mailform/targets DASH_USER=admin \
  DASH_PASS=... SESSION_SECRET=... node server.js
```

Put it behind a reverse proxy with TLS (nginx/Apache/Caddy) - the dashboard
itself only binds to `127.0.0.1` and has no TLS of its own.

## Reload mode

- `restart` (default): `docker restart <container>`, then checks that the
  container stays `running`. A bad target means a short crash-loop and a
  restart for the rollback; all forms are down during each restart.
- `hup`: `docker kill --signal=HUP <container>`. Mailform reloads the targets
  without a restart and logs `Targets reloaded` or `Reload failed: <reason>`.
  The dashboard reads that line with `docker logs --since <timestamp>` (waits up
  to 5 s). On `Reload failed` the change is rolled back, the error text is shown
  in the dashboard and another HUP restores the old state. If neither line
  appears, the dashboard reports an error and rolls back as well. A bad target
  never interrupts the running service.

**Warning: use `RELOAD_MODE=hup` only with a Mailform image that contains the
SIGHUP handler** (this repository's current `Dockerfile`, started with
`CMD ["node", "dist/main.js"]`). A container from an older image has no handler,
and SIGHUP terminates the process. Update the image and recreate the container
first, then switch the mode.

## Development

```shell
npm test   # builds, then runs test/dashboard.test.js (reload logic with a fake docker, API, rollback, masking, 0600)
```

The UI is plain HTML/CSS/JS in `public/` without a build step (self-hosted fonts: Hanken Grotesk and JetBrains Mono, SIL OFL, licenses in `public/fonts/`). It follows the system light/dark setting. The header shows the container state (`docker inspect`) and the reload mode.

## Reverse proxy and domain

The dashboard works best on its **own subdomain** (e.g. `forms-admin.example.com`), separate from the Mailform endpoint host. Reasons: the session cookie and the CSP stay isolated from the public form endpoints, the login can be additionally protected at the proxy (IP allow-list, basic auth) without touching form traffic, and there is no clash between a dashboard path and a target name. Serving it under a path of the Mailform host (e.g. `/admin`) is possible with a proxy rule, but it needs path handling in the dashboard (all asset and API URLs are absolute, `/login`, `/api/...`) and makes a target named `admin` unusable, so it is not supported.

## Notes
- Secrets (SMTP password, captcha secret) are never sent to the browser. The UI shows `********`; leaving it unchanged keeps the stored password.
- Target files are written with mode `0600` because they contain credentials.
- Editing a target in the UI keeps fields it does not manage (`redirect`, `captcha`, `maxFileSizeMb`).
- The dashboard writes target files directly and does not itself send mail;
  Mailform reads them exactly as before.
- Deleting or invalidating the only target that made Mailform crash-loop is
  handled the same way as any other change: verified, and rolled back if the
  container doesn't come back up.
