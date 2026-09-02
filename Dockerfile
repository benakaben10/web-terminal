# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# web-terminal — mobile-first web terminal admin, zsh + oh-my-zsh by default,
# with a DevOps toolchain baked in (the "full" tool list of
# github.com/nghiadaulau/thanos-bootstrap, installed directly here).
# 64-bit only: linux/amd64 and linux/arm64 (Apple Silicon under Docker
# Desktop). Any other TARGETARCH fails the build rather than guessing.
#
# The base is Ubuntu rather than Alpine because the bootstrap supports apt and
# dnf only, and because several of the tools it installs — aws-cli v2 and
# session-manager-plugin in particular — publish glibc-only builds.
# ---------------------------------------------------------------------------

ARG UBUNTU_VERSION=24.04
ARG NODE_MAJOR=24

# ------------------------------------------------------ 0. ubuntu with node
# Shared by the build and the runtime stage, so both run the exact same Node
# and a native module built below keeps its ABI at runtime.
FROM ubuntu:${UBUNTU_VERSION} AS node-base

ARG NODE_MAJOR
ENV DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# --------------------------------------------------------------- 1. backend
FROM node-base AS deps

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY server/package.json ./
RUN npm install --no-audit --no-fund

# Lift the xterm.js UMD bundles out of node_modules; the browser loads them
# directly, so the image ships no bundler and no CDN dependency.
RUN mkdir -p /vendor && \
    cp node_modules/@xterm/xterm/lib/xterm.js                       /vendor/ && \
    cp node_modules/@xterm/xterm/css/xterm.css                      /vendor/ && \
    cp node_modules/@xterm/addon-fit/lib/addon-fit.js               /vendor/ && \
    cp node_modules/@xterm/addon-web-links/lib/addon-web-links.js   /vendor/ && \
    cp node_modules/@xterm/addon-unicode11/lib/addon-unicode11.js   /vendor/ && \
    cp node_modules/@xterm/addon-webgl/lib/addon-webgl.js           /vendor/ && \
    cp node_modules/@xterm/addon-canvas/lib/addon-canvas.js         /vendor/

# Drop dev deps so only express/ws/node-pty reach the runtime image.
RUN npm prune --omit=dev

# ---------------------------------------------------------- 2. shell assets
FROM ubuntu:${UBUNTU_VERSION} AS shell-assets

ARG OMZ_REF=master
ARG NERD_FONTS_VERSION=v3.4.0
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl ca-certificates unzip && \
    rm -rf /var/lib/apt/lists/*

# oh-my-zsh + the plugins referenced by docker/zshrc.
RUN git clone --depth=1 -b ${OMZ_REF} https://github.com/ohmyzsh/ohmyzsh.git /opt/oh-my-zsh && \
    git clone --depth=1 https://github.com/zsh-users/zsh-autosuggestions     /opt/oh-my-zsh/custom/plugins/zsh-autosuggestions && \
    git clone --depth=1 https://github.com/zsh-users/zsh-syntax-highlighting /opt/oh-my-zsh/custom/plugins/zsh-syntax-highlighting && \
    git clone --depth=1 https://github.com/zsh-users/zsh-completions         /opt/oh-my-zsh/custom/plugins/zsh-completions && \
    git clone --depth=1 https://github.com/romkatv/powerlevel10k             /opt/oh-my-zsh/custom/themes/powerlevel10k && \
    find /opt/oh-my-zsh -name .git -type d -prune -exec rm -rf {} + && \
    rm -rf /opt/oh-my-zsh/.github

# Nerd Font symbols, served as a webfont so powerline/devicon glyphs render on
# phones that have no such font installed. Optional: a failure must not break
# the build, the CSS stack falls back to the system monospace font.
RUN mkdir -p /opt/fonts && \
    (curl -fsSL -o /tmp/symbols.zip \
      "https://github.com/ryanoasis/nerd-fonts/releases/download/${NERD_FONTS_VERSION}/NerdFontsSymbolsOnly.zip" && \
     unzip -j -o /tmp/symbols.zip 'SymbolsNerdFontMono-Regular.ttf' -d /opt/fonts && \
     rm -f /tmp/symbols.zip) || echo "[warn] nerd font download skipped"

# --------------------------------------------------------------- 3. runtime
FROM node-base AS runtime

LABEL org.opencontainers.image.title="web-terminal" \
      org.opencontainers.image.description="Mobile-first web terminal admin with zsh + oh-my-zsh and a DevOps toolchain" \
      org.opencontainers.image.source="https://github.com/benakaben10/web-terminal"

# Shell plus the tooling an admin reaches for from a phone.
#
# npm is deleted: the server is started with `node` and never shells out to it,
# but the copy NodeSource installs bundles its own dependency tree, and that is
# where every Node-side CVE in this image came from. The build stage keeps its
# own npm; this is the runtime.
#
# python3 is installed here rather than left to the bootstrap on purpose: the
# bootstrap asks apt for a package literally named "python", which does not
# exist on Ubuntu 24.04, and it skips the tool cleanly once python3 is already
# on PATH ("supplied by the system outside the managed package database").
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      tini zsh bash sudo \
      ca-certificates tzdata ncurses-base ncurses-term \
      coreutils findutils grep sed gawk procps util-linux passwd \
      git curl wget openssh-client rsync socat \
      vim nano less tree jq unzip tar xz-utils \
      htop tmux ncdu \
      dnsutils iputils-ping iproute2 net-tools \
      python3 python3-pip && \
    rm -rf /var/lib/apt/lists/* && \
    rm -rf /usr/lib/node_modules/npm /usr/bin/npm /usr/bin/npx

# Docker CLI without the engine. The daemon is the host's, reached through the
# /var/run/docker.sock mount that docker-compose.yml offers.
ARG TARGETARCH
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc && \
    chmod a+r /etc/apt/keyrings/docker.asc && \
    . /etc/os-release && \
    echo "deb [arch=${TARGETARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*

# --- devops toolchain ------------------------------------------------------
# The tool list is the "full" profile of github.com/nghiadaulau/thanos-bootstrap,
# but installed here directly from each vendor's own release endpoint rather than
# by cloning and running that bootstrap: the image then owns its versions and its
# download steps, and a build cannot change underneath it because an upstream
# script resolved a different "latest".
#
# Everything lands under /usr/local. /root is a volume at runtime, and a volume
# that already has content hides whatever the image left underneath it, so no
# tool may be installed into $HOME.

ARG TERRAFORM_VERSION=1.16.0
ARG TERRAMATE_VERSION=0.17.2
ARG TFLINT_VERSION=0.64.0
ARG TERRAFORM_DOCS_VERSION=0.24.0
ARG KUBECTL_VERSION=1.37.0
ARG HELM_VERSION=4.2.4
ARG K9S_VERSION=0.51.0
ARG KUBECTX_VERSION=0.11.0
ARG YQ_VERSION=4.53.6
ARG UV_VERSION=0.12.9
ARG NEOVIM_VERSION=0.12.5
ARG GO_VERSION=1.27.1

# The utilities Ubuntu already ships at a usable version. Debian renames two of
# them to avoid clashes, so the usual names are symlinked back.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      make openssl ripgrep fd-find bat fzf zoxide nmap tcpdump && \
    rm -rf /var/lib/apt/lists/* && \
    ln -sf "$(command -v fdfind)" /usr/local/bin/fd && \
    ln -sf "$(command -v batcat)" /usr/local/bin/bat

# Release binaries. Each archive is unpacked into a scratch directory and the
# binary is picked out by name, so a vendor changing its archive layout fails
# the build loudly instead of installing nothing.
# Vendors disagree on how to spell an architecture, so three names are derived
# from the one Buildx supplies: amd64/arm64, x86_64/arm64, and x86_64/aarch64.
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) ARCH_X=x86_64; ARCH_GNU=x86_64 ;; \
      arm64) ARCH_X=arm64;  ARCH_GNU=aarch64 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    tmp="$(mktemp -d)"; cd "$tmp"; \
    get() { curl -fsSL --proto '=https' --tlsv1.2 -o "$1" "$2"; }; \
    pick() { found="$(find "$1" -type f -name "$2" -print -quit)"; \
             [ -n "$found" ] || { echo "missing $2 in $1" >&2; exit 1; }; \
             install -m 0755 "$found" "/usr/local/bin/$2"; }; \
    \
    get terraform.zip "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_${TARGETARCH}.zip"; \
    mkdir tf && unzip -q terraform.zip -d tf && pick tf terraform; \
    \
    get terramate.tgz "https://github.com/terramate-io/terramate/releases/download/v${TERRAMATE_VERSION}/terramate_${TERRAMATE_VERSION}_linux_${ARCH_X}.tar.gz"; \
    mkdir tm && tar -xzf terramate.tgz -C tm && pick tm terramate; \
    \
    get tflint.zip "https://github.com/terraform-linters/tflint/releases/download/v${TFLINT_VERSION}/tflint_linux_${TARGETARCH}.zip"; \
    mkdir tl && unzip -q tflint.zip -d tl && pick tl tflint; \
    \
    get tfdocs.tgz "https://github.com/terraform-docs/terraform-docs/releases/download/v${TERRAFORM_DOCS_VERSION}/terraform-docs-v${TERRAFORM_DOCS_VERSION}-linux-${TARGETARCH}.tar.gz"; \
    mkdir td && tar -xzf tfdocs.tgz -C td && pick td terraform-docs; \
    \
    get kubectl "https://dl.k8s.io/release/v${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl"; \
    install -m 0755 kubectl /usr/local/bin/kubectl; \
    \
    get helm.tgz "https://get.helm.sh/helm-v${HELM_VERSION}-linux-${TARGETARCH}.tar.gz"; \
    mkdir hm && tar -xzf helm.tgz -C hm && pick hm helm; \
    \
    get k9s.tgz "https://github.com/derailed/k9s/releases/download/v${K9S_VERSION}/k9s_Linux_${TARGETARCH}.tar.gz"; \
    mkdir k9 && tar -xzf k9s.tgz -C k9 && pick k9 k9s; \
    \
    get kubectx.tgz "https://github.com/ahmetb/kubectx/releases/download/v${KUBECTX_VERSION}/kubectx_v${KUBECTX_VERSION}_linux_${ARCH_X}.tar.gz"; \
    mkdir kx && tar -xzf kubectx.tgz -C kx && pick kx kubectx; \
    get kubens.tgz "https://github.com/ahmetb/kubectx/releases/download/v${KUBECTX_VERSION}/kubens_v${KUBECTX_VERSION}_linux_${ARCH_X}.tar.gz"; \
    mkdir kn && tar -xzf kubens.tgz -C kn && pick kn kubens; \
    \
    get yq "https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_${TARGETARCH}"; \
    install -m 0755 yq /usr/local/bin/yq; \
    \
    get uv.tgz "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${ARCH_GNU}-unknown-linux-gnu.tar.gz"; \
    mkdir uvd && tar -xzf uv.tgz -C uvd && pick uvd uv && pick uvd uvx; \
    \
    cd / && rm -rf "$tmp"

# Neovim and Go ship whole trees, not single binaries, so they keep their own
# prefix with only the entry points on PATH.
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) ARCH_X=x86_64 ;; \
      arm64) ARCH_X=arm64 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    tmp="$(mktemp -d)"; cd "$tmp"; \
    curl -fsSL --proto '=https' --tlsv1.2 -o nvim.tgz \
      "https://github.com/neovim/neovim/releases/download/v${NEOVIM_VERSION}/nvim-linux-${ARCH_X}.tar.gz"; \
    tar -xzf nvim.tgz && mv "nvim-linux-${ARCH_X}" /usr/local/nvim && \
    ln -sf /usr/local/nvim/bin/nvim /usr/local/bin/nvim; \
    curl -fsSL --proto '=https' --tlsv1.2 -o go.tgz \
      "https://go.dev/dl/go${GO_VERSION}.linux-${TARGETARCH}.tar.gz"; \
    tar -xzf go.tgz -C /usr/local && \
    ln -sf /usr/local/go/bin/go /usr/local/bin/go && \
    ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt; \
    cd / && rm -rf "$tmp"

# aws-cli v2 keeps its own runtime tree and installs its own symlinks; the
# session-manager-plugin ships only as a .deb and has no dependencies of its own.
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) ARCH_GNU=x86_64;  SSM_DIR=ubuntu_64bit ;; \
      arm64) ARCH_GNU=aarch64; SSM_DIR=ubuntu_arm64 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    tmp="$(mktemp -d)"; cd "$tmp"; \
    curl -fsSL --proto '=https' --tlsv1.2 -o awscli.zip \
      "https://awscli.amazonaws.com/awscli-exe-linux-${ARCH_GNU}.zip"; \
    unzip -q awscli.zip && ./aws/install -i /usr/local/aws-cli -b /usr/local/bin; \
    curl -fsSL --proto '=https' --tlsv1.2 -o ssm.deb \
      "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/${SSM_DIR}/session-manager-plugin.deb"; \
    dpkg -i ssm.deb; \
    cd / && rm -rf "$tmp"

# --- shell profile ---------------------------------------------------------
COPY --from=shell-assets /opt/oh-my-zsh /opt/oh-my-zsh
COPY --from=shell-assets /opt/fonts /opt/fonts
COPY docker/zshrc /etc/skel/.zshrc
COPY docker/vimrc /etc/skel/.vimrc

RUN ln -sfn /opt/oh-my-zsh /root/.oh-my-zsh && \
    cp /etc/skel/.zshrc /root/.zshrc && \
    cp /etc/skel/.vimrc /root/.vimrc && \
    usermod -s /bin/zsh root && \
    grep -qxF /bin/zsh /etc/shells || echo /bin/zsh >> /etc/shells && \
    mkdir -p /docker-entrypoint.d

# --- application -----------------------------------------------------------
WORKDIR /app
COPY --from=deps /build/node_modules ./server/node_modules
COPY server/package.json ./server/package.json
COPY server/src ./server/src
COPY web ./web
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

COPY --from=deps /vendor/ /app/web/vendor/

# Publish the Nerd Font symbols to the web root if the download succeeded, and
# only then append the @font-face rule that points at them.
RUN chmod +x /usr/local/bin/entrypoint.sh && \
    if [ -f /opt/fonts/SymbolsNerdFontMono-Regular.ttf ]; then \
      mkdir -p /app/web/vendor/fonts && \
      cp /opt/fonts/SymbolsNerdFontMono-Regular.ttf /app/web/vendor/fonts/ && \
      printf '\n%s\n' \
        '@font-face {' \
        '  font-family: "Symbols Nerd Font Mono";' \
        '  src: url("fonts/SymbolsNerdFontMono-Regular.ttf") format("truetype");' \
        '  font-display: swap;' \
        '}' >> /app/web/vendor/xterm.css ; \
    fi && \
    rm -rf /opt/fonts

ENV WT_PORT=7681 \
    WT_HOST=0.0.0.0 \
    WT_SHELL=/bin/zsh \
    WT_HOME=/root \
    HOME=/root \
    SHELL=/bin/zsh \
    TERM=xterm-256color \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NODE_ENV=production \
    TINI_KILL_PROCESS_GROUP=1

WORKDIR /root
EXPOSE 7681

HEALTHCHECK --interval=30s --timeout=4s --start-period=8s --retries=3 \
  CMD ["/bin/sh", "-c", "wget -qO- \"http://127.0.0.1:${WT_PORT}/healthz\" >/dev/null 2>&1 || exit 1"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "/app/server/src/index.js"]
