# Contributing

## Getting it running

```sh
cp .env.example .env      # set WT_PASSWORD
docker compose up -d --build
```

The front end is plain ES modules and CSS under `web/`, with no build step: edit,
rebuild the image, reload. The server is `server/src/`, Node with `express`,
`ws` and `node-pty`.

| Path | What lives there |
|---|---|
| `server/src/index.js` | HTTP, WebSocket upgrade, socket lifecycle |
| `server/src/sessions.js` | pty lifecycle, replay ring buffer, attach/detach |
| `server/src/auth.js` | login, tokens, timing-safe comparison |
| `server/src/config.js` | every environment variable |
| `server/src/system.js` | host metrics, read from cgroups |
| `web/js/app.js` | tabs, xterm, socket, hotkey bar, IME field, settings |
| `web/js/keys.js` | hotkey definitions, escape-sequence parsing |
| `docker/zshrc` | shell profile seeded into `$HOME` |

## Before opening a pull request

- `docker compose build` has to succeed.
- The container has to come up healthy and answer `/healthz`.
- If you touched the gesture, IME or hotkey code, try it on a real phone. The
  emulator does not reproduce soft-keyboard or composition behaviour.
- CI runs Hadolint, Gitleaks, `npm audit` and Trivy; see
  [SECURITY.md](SECURITY.md) for what gates a merge.

## House style

Comments explain *why*, not *what* — the surrounding code already says what it
does. Several of the trickier behaviours here (scroll routing, the IME field, the
tmux copy-mode path) exist because of a specific browser or terminal quirk, and
the comment that records the quirk is the valuable part. Match the density and
tone of the code you are editing.

Everything is in English: UI strings, comments, documentation and commit
messages.

## Commits

One logical change per commit. Write the message as prose explaining the reason
for the change, not a restatement of the diff.

## Adding a tool to the image

Pin the version as a build `ARG`, download from the vendor's own release
endpoint over HTTPS, and derive the architecture from `TARGETARCH` — the image
is built for both `amd64` and `arm64`, and vendors spell architectures three
different ways. The existing entries in the Dockerfile show the pattern.
