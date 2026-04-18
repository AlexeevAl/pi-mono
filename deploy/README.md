# Deploy — Linda Agent on a VPS

Target: Ubuntu 24.04 LTS, root SSH, Node 20 + systemd (no Docker).
Engine runs on Vercel; agent is an outbound-only worker (no inbound ports).

## One-time bootstrap

All commands run on the VPS. Replace `<IP>` with your server IP.

```bash
ssh root@<IP>

# 1. Create app user
adduser --disabled-password --gecos "" linda

# 2. Generate a deploy key for GitHub
sudo -iu linda ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""
sudo -iu linda cat ~/.ssh/id_ed25519.pub
# → Copy the output and add it at
#   https://github.com/AlexeevAl/pi-mono/settings/keys
#   (Deploy keys → Add deploy key, read-only is fine)

# 3. Clone the repo as `linda`
sudo -iu linda bash -lc '
  mkdir -p ~/apps && cd ~/apps
  ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
  git clone git@github.com:AlexeevAl/pi-mono.git
  cd pi-mono && git checkout feat/linda-integrated
'

# 4. Run the installer (Node + pnpm + build + systemd + firewall)
cd /home/linda/apps/pi-mono
sudo bash deploy/install.sh
```

## Configure secrets

```bash
sudoedit /etc/linda/linda.env
```

Fill in:
- `PSF_ENGINE_URL` — your Vercel URL.
- `FIRM_SHARED_SECRET` — must match `BRIDGE_SHARED_SECRET` on the engine.
- `ANTHROPIC_API_KEY` — LLM provider key.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `ALLOWED_ADMIN_IDS`.

## Start (Telegram only, for smoke test)

```bash
sudo systemctl start linda-agent
sudo journalctl -u linda-agent -f
```

Message the bot on Telegram — you should see it reach the engine in the logs.

## Enable WhatsApp

Only after the Telegram channel works end-to-end:

1. Stop the service so the QR scan doesn't race with it:
   ```bash
   sudo systemctl stop linda-agent
   ```
2. Set `WHATSAPP_ENABLED=true` and fill `WHATSAPP_ALLOWED_USER_IDS` in `/etc/linda/linda.env`.
3. Run once interactively to scan the QR (phone → Linked devices → Link a device):
   ```bash
   sudo -iu linda bash -lc '
     cd ~/apps/pi-mono/packages/linda-agent
     set -a; . /etc/linda/linda.env; set +a
     node dist/main.js
   '
   ```
   Wait for "connection open", then `Ctrl+C`. Session is saved in
   `packages/linda-agent/.linda/auth/<firmId>-whatsapp/`.
4. Start the service:
   ```bash
   sudo systemctl start linda-agent
   ```

## Update

```bash
sudo -iu linda bash -lc 'cd ~/apps/pi-mono && git pull && pnpm install && pnpm build'
sudo systemctl restart linda-agent
```

## Backup WhatsApp session (recommended)

Losing `packages/linda-agent/.linda/auth/` means a fresh QR scan. Minimal daily backup:

```bash
sudo crontab -e
# Add:
0 3 * * * tar czf /root/linda-wa-$(date +\%F).tgz -C /home/linda/apps/pi-mono/packages/linda-agent .linda/auth && find /root -name 'linda-wa-*.tgz' -mtime +7 -delete
```

## Troubleshooting

- `systemctl status linda-agent` — current state and last log lines.
- `journalctl -u linda-agent -n 200 --no-pager` — recent logs.
- Unit fails on start → `sudoedit /etc/linda/linda.env`, check required vars are set.
- Build fails → run the build manually as `linda` to see the full error:
  ```bash
  sudo -iu linda bash -lc 'cd ~/apps/pi-mono && pnpm build'
  ```
