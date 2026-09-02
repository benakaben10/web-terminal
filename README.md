# web-terminal

A lightweight bastion you drive from your phone. A root shell in the browser with
`zsh` + `oh-my-zsh`, a customisable hotkey bar, a full DevOps toolchain, and
sessions that survive losing the network. One container, `linux/amd64` and
`linux/arm64`.

[![docker](https://github.com/benakaben10/web-terminal/actions/workflows/docker.yml/badge.svg)](https://github.com/benakaben10/web-terminal/actions/workflows/docker.yml)
[![security](https://github.com/benakaben10/web-terminal/actions/workflows/security.yml/badge.svg)](https://github.com/benakaben10/web-terminal/actions/workflows/security.yml)
[![docker pulls](https://img.shields.io/docker/pulls/benakaben24/web-terminal)](https://hub.docker.com/r/benakaben24/web-terminal)
[![image size](https://img.shields.io/docker/image-size/benakaben24/web-terminal/latest)](https://hub.docker.com/r/benakaben24/web-terminal)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/benakaben10/web-terminal/blob/master/LICENSE)

```sh
docker pull benakaben24/web-terminal
```

## Why

Fixing a server from a phone is normally miserable. There is no `Ctrl`, no `Esc`
and no arrow keys on a soft keyboard; scrolling back through output either does
nothing or walks your command history instead; and anything typed with a
Vietnamese or other IME keyboard arrives mangled, because mobile keyboards commit
whole words rather than keystrokes. Existing web terminals inherit these problems
from the emulator they wrap.

This one owns the whole keyboard path — `node-pty` + `ws` on the server, xterm.js
driven directly in the browser — which is what makes the fixes below possible.

## As a lightweight bastion

Put this on the one host allowed to reach your private network and it becomes a
bastion you can work from without a laptop. The DevOps toolchain is already in
the image, so `kubectl`, `terraform`, `aws` and `ssh` run **on the bastion**, not
on the device in your pocket. The phone is a screen and a keyboard: no
credentials, no kubeconfig and no private keys ever land on it, and there is no
client to install beyond a browser — optionally saved to the home screen as a PWA.

**Pair it with a VPN, and do not skip that part.** WireGuard or Tailscale in
front of the terminal is what makes the combination both convenient and
defensible:

- The terminal listens on the VPN interface or on loopback only, so the login
  page is not reachable from the internet at all. Nothing to scan, nothing to
  brute-force, and no exposure the day a CVE lands in a dependency.
- Authentication becomes two independent layers: the VPN's keys, then
  `WT_PASSWORD`. Neither one alone gets anybody a shell.
- The phone needs a single VPN profile, and every mobile OS has a first-party
  client for it. After that, any browser works.

That is the intended deployment. Exposing the login page straight to the internet
is possible, but then a root shell stands behind one password — read
[Before exposing it](#before-exposing-it), and prefer the VPN.

## What you get

**A usable keyboard.** Five groups of on-screen keys: navigation, Ctrl combos,
symbols, F1–F12 and quick commands. Sticky modifiers: tap `Ctrl`, and the next
key — including one from the OS keyboard — becomes `Ctrl+…`; tap twice to lock.
Every key's label and sequence is editable in the UI, and layouts export as JSON.

**Scrolling that works.** Drag to scroll, with inertia. The gesture is routed to
whatever the running program can actually accept: the terminal's scrollback, real
mouse-wheel notches for `vim`/`less`/`htop`, or page keys for pagers that ignore
the mouse. Shells running inside `tmux` are handled too — optional, since it means
driving tmux copy-mode on your behalf. Arrow keys are never emitted, so the wheel
never turns into command-history browsing.

**Text you can copy.** Long-press and drag to select across lines. Selecting never
copies by itself; a copy button appears while a selection stands. Pasting uses
bracketed paste, so a multi-line paste does not execute line by line.

**IME input.** A dedicated input field, so Gboard Telex and other
composition-based keyboards commit correctly instead of dropping tone marks. Two
presentations: an invisible overlay, or a visible compose bar for iOS/Safari where
tapping a canvas does not open the keyboard.

**Sessions that outlive the browser.** The server owns the session list, not the
tab. Reconnect from another device, clear browser data, or log out and back in,
and every running shell is still there with its scrollback replayed and its
environment intact. Automatic reconnection with backoff. They do not survive
restarting the container — run `tmux` inside for that.

**An admin panel.** Hostname, OS, CPU, load, uptime, RAM and disk (read from
cgroups, so container limits are respected), plus list, open, rename and kill for
every session. Password login with expiring tokens.

**A DevOps toolbox, preinstalled.** Terraform, Terramate, tflint, terraform-docs,
kubectl, Helm, k9s, kubectx/kubens, aws-cli v2 with the Session Manager plugin,
Go, Python, uv, Neovim, and the everyday set — ripgrep, fd, bat, fzf, zoxide, yq,
jq, nmap, tcpdump. The list follows the `full` profile of
[thanos-bootstrap](https://github.com/nghiadaulau/thanos-bootstrap), installed
straight from each vendor's release endpoint at pinned versions you can override
as build args. The Docker CLI is there without an engine; mount the host's
`/var/run/docker.sock` to use it.

**Room to spread out on a desktop.** A browser window has space a phone does
not, so the ▦ button in the toolbar splits it into four terminals, opening
shells to fill any pane that has none. Each pane carries its own header: the
shell's title, a picker to swap a different session into that pane, a `+` that
opens a new one right there, and an `✕` that closes it — leaving the pane
offering to open another. Click a pane to give it the keyboard; the
wheel goes to whichever pane is under the pointer. Two panes are available in
settings as well. Off on touch devices, where a quarter of the screen is too
few columns to be worth anything.

**A real shell.** `zsh` with `oh-my-zsh`, autosuggestions, syntax highlighting and
the usual plugins. `powerlevel10k` is installed and a Nerd Font is bundled as a
webfont, so a powerline theme renders on a phone with no fonts installed.

## Quick start

```sh
git clone https://github.com/benakaben10/web-terminal.git
cd web-terminal
cp .env.example .env
$EDITOR .env            # WT_PASSWORD must be changed
docker compose up -d
```

Then open `http://<host>:7681`. Compose binds `127.0.0.1` on purpose, expecting a
VPN interface or a reverse proxy in front; change the port mapping only if you
mean to expose it.

Images for `linux/amd64` and `linux/arm64` (Apple Silicon) are published to
[`benakaben24/web-terminal`](https://hub.docker.com/r/benakaben24/web-terminal)
on every push to `master`. Each architecture also gets a prefixed tag of its own
(`amd64-latest`, `arm64-latest`) for pinning; the unprefixed tags are a manifest
list, so a plain `docker pull` resolves the right architecture by itself. Nothing
32-bit is published. Add `--build` to the compose command to build locally
instead.

Every setting is an environment variable, and `.env.example` documents the ones
worth touching. `$HOME` lives in a named volume, so history and dotfiles survive
a rebuild.

## Before exposing it

This is an unrestricted root shell. The supported deployment is behind a VPN, as
[described above](#as-a-lightweight-bastion). If you put it on a public address
anyway:

1. Set a strong `WT_PASSWORD`. An empty one disables authentication entirely and
   hands a shell to anyone who reaches the port.
2. Serve it over HTTPS. On plain HTTP the password and the session token travel
   in the clear, and the browser also refuses clipboard reads outside a secure
   context.
3. Restrict the source addresses — `allow`/`deny` in nginx, a security group, or
   a host firewall.
4. Only mount `/var/run/docker.sock` if you actually need it. That socket is root
   on the host and it escapes the container.
5. Keep the compose binding on `127.0.0.1`, so the container cannot bypass
   whatever you put in front of it.

Every push is scanned: Trivy over the image and the source tree, Hadolint on the
Dockerfile, Gitleaks for committed secrets, and `npm audit` for dependencies.
Results go to GitHub code scanning. To report a vulnerability, see
[SECURITY.md](https://github.com/benakaben10/web-terminal/blob/master/SECURITY.md).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](https://github.com/benakaben10/web-terminal/blob/master/CONTRIBUTING.md).

## License

[Apache License 2.0](https://github.com/benakaben10/web-terminal/blob/master/LICENSE)
