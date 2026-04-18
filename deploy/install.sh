#!/usr/bin/env bash
# Linda Agent — VPS installer (Ubuntu 24.04, systemd, no Docker).
# Run as root from INSIDE the cloned repo:
#   sudo bash deploy/install.sh
# Prerequisites: repo cloned to /home/linda/apps/pi-mono, owned by user `linda`.

set -euo pipefail

APP_USER="linda"
APP_HOME="/home/${APP_USER}"
REPO_DIR="${APP_HOME}/apps/pi-mono"
AGENT_DIR="${REPO_DIR}/packages/linda-agent"
ENV_DIR="/etc/linda"
ENV_FILE="${ENV_DIR}/linda.env"
SERVICE_FILE="/etc/systemd/system/linda-agent.service"
NODE_MAJOR="20"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/install.sh" >&2
  exit 1
fi

if [[ ! -d "${AGENT_DIR}" ]]; then
  echo "Expected repo at ${REPO_DIR}. Clone it first as user '${APP_USER}':" >&2
  echo "  sudo -iu ${APP_USER}" >&2
  echo "  mkdir -p ~/apps && cd ~/apps && git clone git@github.com:AlexeevAl/pi-mono.git" >&2
  exit 1
fi

echo "==> Installing system packages"
apt-get update -qq
apt-get install -y -qq curl git build-essential ca-certificates ufw

if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt "${NODE_MAJOR}" ]]; then
  echo "==> Installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi

if ! command -v pnpm >/dev/null; then
  echo "==> Installing pnpm"
  npm i -g pnpm@9
fi

echo "==> Building linda-agent (as ${APP_USER})"
sudo -iu "${APP_USER}" bash -lc "cd '${REPO_DIR}' && git checkout feat/linda-integrated && git pull && pnpm install --frozen-lockfile=false && pnpm build"

echo "==> Preparing env dir at ${ENV_DIR}"
install -d -m 0750 -o "${APP_USER}" -g "${APP_USER}" "${ENV_DIR}"
if [[ ! -f "${ENV_FILE}" ]]; then
  install -m 0600 -o "${APP_USER}" -g "${APP_USER}" \
    "${REPO_DIR}/deploy/linda.env.example" "${ENV_FILE}"
  echo "    Created ${ENV_FILE} — edit it before starting the service."
else
  echo "    ${ENV_FILE} already exists — leaving as is."
fi

echo "==> Installing systemd unit"
install -m 0644 "${REPO_DIR}/deploy/linda-agent.service" "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable linda-agent >/dev/null

echo "==> Configuring firewall (SSH only)"
ufw allow OpenSSH >/dev/null
yes | ufw enable >/dev/null || true

cat <<EOF

=========================================================
 Linda Agent installed.

 Next steps:
   1. Fill in credentials:     sudoedit ${ENV_FILE}
   2. (Optional WhatsApp) First-run QR scan:
        sudo -iu ${APP_USER}
        cd ${AGENT_DIR}
        set -a; . ${ENV_FILE}; set +a
        node dist/main.js      # scan QR, then Ctrl+C
   3. Start service:           sudo systemctl start linda-agent
   4. Tail logs:               sudo journalctl -u linda-agent -f

 Update later:
   sudo -iu ${APP_USER} 'cd ${REPO_DIR} && git pull && pnpm install && pnpm build'
   sudo systemctl restart linda-agent
=========================================================
EOF
