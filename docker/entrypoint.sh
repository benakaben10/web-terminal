#!/bin/sh
set -e

: "${WT_HOME:=/root}"
: "${WT_SHELL:=/bin/zsh}"

# Make zsh the login shell for whichever account we ended up running as.
CURRENT_USER="$(id -un)"
if [ -w /etc/passwd ]; then
  sed -i "s|^\(${CURRENT_USER}:.*\):[^:]*$|\1:${WT_SHELL}|" /etc/passwd || true
fi

# A bind-mounted $HOME arrives empty — seed the zsh profile into it so the
# oh-my-zsh experience survives `-v ./data:/root`.
if [ ! -f "${WT_HOME}/.zshrc" ] && [ -f /etc/skel/.zshrc ]; then
  cp /etc/skel/.zshrc "${WT_HOME}/.zshrc"
fi
if [ ! -f "${WT_HOME}/.vimrc" ] && [ -f /etc/skel/.vimrc ]; then
  cp /etc/skel/.vimrc "${WT_HOME}/.vimrc"
fi
if [ ! -d "${WT_HOME}/.oh-my-zsh" ] && [ -d /opt/oh-my-zsh ]; then
  ln -sfn /opt/oh-my-zsh "${WT_HOME}/.oh-my-zsh"
fi

if [ -n "${WT_TZ}" ] && [ -f "/usr/share/zoneinfo/${WT_TZ}" ]; then
  ln -sf "/usr/share/zoneinfo/${WT_TZ}" /etc/localtime
  echo "${WT_TZ}" > /etc/timezone
fi

# Run anything an operator dropped in, before the server comes up.
if [ -d /docker-entrypoint.d ]; then
  for script in /docker-entrypoint.d/*.sh; do
    [ -r "$script" ] || continue
    echo "[entrypoint] running $script"
    # shellcheck disable=SC1090
    . "$script"
  done
fi

exec "$@"
