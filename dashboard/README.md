# Mailform Admin Dashboard

A minimal, self-hosted admin UI for managing Mailform targets without touching
JSON files or SSH. Manage recipients, SMTP settings, API keys, rate limits and
the `fixedFrom` option through a small web UI, protected by a session-based
login.

Mailform only loads targets from `TARGETS_DIR` once at startup, so an invalid
target file would normally crash-loop the whole service. This dashboard
guards against that: after every create/edit/delete it restarts the Mailform
container and verifies it actually stayed up - if not, the change is rolled
back automatically and the container is restarted again.

## Requirements
- Node.js 18+
- Docker, with the dashboard process able to run `docker restart <container>`
  (e.g. running as root or a user in the `docker` group)
- Mailform running as a Docker container, with its `targets` directory
  bind-mounted from the host (the dashboard writes directly into that
  directory)

## Setup

```shell
cd dashboard
npm install --omit=dev
```

Configure via environment variables:

| Variable | Description | Default |
|---|---|---|
| `PORT` | Port the dashboard listens on | `3006` |
| `TARGETS_DIR` | Path to Mailform's targets directory (same path on the host as mounted into the Mailform container) | `/opt/mailform/targets` |
| `MAILFORM_CONTAINER` | Name of the Mailform Docker container to restart after changes | `mailform` |
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

## Notes
- The dashboard writes target files directly and does not itself send mail;
  Mailform reads them exactly as before.
- Deleting or invalidating the only target that made Mailform crash-loop is
  handled the same way as any other change: verified, and rolled back if the
  container doesn't come back up.
