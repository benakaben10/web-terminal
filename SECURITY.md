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
library their vendor compiled them against. They are still scanned and still
reported.

A scanner reports these as `golang / stdlib / 1.25.8`, `golang.org/x/crypto /
0.49.0` and so on, which reads like the image is carrying an old Go. It is not:
the toolchain here is current, and each of those versions is statically linked
*inside* one vendor's prebuilt binary. Upgrading the Go installed in the image
changes none of them, because nothing recompiles those binaries.

There are only three real remedies, in order of preference:

1. **Bump the tool.** Vendors rebuild against a patched Go eventually. Every tool
   is a pinned build argument in the Dockerfile, so taking a new release is a
   one-line change.
2. **Drop the tool.** A convenience that carries dozens of CVEs may not be worth
   its surface on a bastion.
3. **Rebuild it from source** with the current toolchain. This does fix `stdlib`
   findings, but not module ones — `go install tool@version` honours that
   module's own `go.mod`, so a pinned vulnerable `x/crypto` stays pinned unless
   the module is forked and patched. It also replaces a vendor-signed release
   artifact with a locally built one, which is its own trade-off.
