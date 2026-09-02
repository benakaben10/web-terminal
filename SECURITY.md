# Security policy

## Reporting a vulnerability

Report privately through GitHub's
[security advisory form](https://github.com/benakaben10/web-terminal/security/advisories/new).
Please do not open a public issue for a vulnerability.

Include what you need to describe the problem: affected version or image tag, a
reproduction, and what an attacker gains. You should get an acknowledgement
within a few days. Fixes are released as a new image tag, and the advisory is
published once the fix is available.

## What this project is

web-terminal gives a browser an unrestricted root shell inside its container.
That is the feature, not a flaw. The following are therefore **not**
vulnerabilities:

- A user of the terminal running privileged commands, or escaping to the host
  through a `/var/run/docker.sock` that the operator chose to mount.
- Anything reachable only after a successful login, when the operator set a weak
  or empty `WT_PASSWORD`.
- Traffic being readable when the operator serves the terminal over plain HTTP.

What *is* in scope: anything that gets a shell, a session, or a token **without
valid credentials** — authentication bypass, session hijacking or fixation,
reading another session's output, token forgery, path traversal in the static
file server, and injection through the WebSocket control protocol.

## How it is meant to be deployed

Behind a VPN, listening on the VPN interface or loopback only, so the login page
is never reachable from the internet. The README explains why. A public
deployment is one password away from a root shell and should be treated
accordingly.

## Scanning

Every push and a weekly schedule run:

- **Trivy** over the image and the source tree, results uploaded to GitHub code
  scanning.
- **Hadolint** on the Dockerfile.
- **Gitleaks** over the full history.
- **npm audit** on the runtime dependencies.

CI fails on fixable HIGH/CRITICAL findings in the base image's own packages, on
HIGH findings in our Node dependencies, on Dockerfile warnings, and on any
detected secret.

CI does **not** fail on CVEs inside third-party release binaries — `terraform`,
`helm`, `k9s`, `kubectl`, the Docker CLI and the rest carry whatever Go standard
library their vendor compiled them against. Nothing in this repository can patch
those; the only remedy is a vendor release, which the pinned version arguments in
the Dockerfile make easy to take. They are still scanned and still reported.
