#!/bin/bash
# Install a login LaunchAgent that re-applies an onboard layer each time you log in.
#
#   scripts/install-launchagent.sh [profile.cmf]
#
# Without an argument the agent targets your most-recently used onboard layer
# (ModeIndex 3 if present, else the highest onboard layer 1..4 found in
# ~/GK6XPlus-CMS). Override the data dir with GK6_DATA.
#
# Uninstall:  launchctl bootout "gui/$(id -u)/com.tfsoares.gk6ctl.ensure" \
#             && rm ~/Library/LaunchAgents/com.tfsoares.gk6ctl.ensure.plist
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CTL="$REPO/bin/gk6ctl"
LOG="$REPO/logs/ensure.log"
LABEL="com.tfsoares.gk6ctl.ensure"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
WRAPPER="$REPO/.runtime/ensure-at-login.sh"

PROFILE="${1:-}"
if [ -z "$PROFILE" ]; then
    PROFILE="$(cd "$REPO" && node -e '
const fs = require("fs"), path = require("path"), cmf = require("./lib/cmf");
const root = path.join(process.env.HOME, "GK6XPlus-CMS", "Account", "0", "Devices");
if (!fs.existsSync(root)) process.exit(0);
let best = null, bestScore = 0;
for (const m of fs.readdirSync(root)) {
  const dir = path.join(root, m);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".cmf")) continue;
    try {
      const { body } = cmf.decodeFile(path.join(dir, f));
      const mode = JSON.parse(body).ModeIndex * 1;
      if (mode < 1 || mode > 4) continue;
      const score = (mode === 3 ? 30 : mode); // prefer layer 3, else highest onboard layer
      if (!best || score > bestScore) { best = path.join(dir, f); bestScore = score; }
    } catch (e) { /* skip undecodable */ }
  }
}
if (best) console.log(best);
' 2>/dev/null || true)"
fi

if [ -z "$PROFILE" ] || [ ! -f "$PROFILE" ]; then
    echo "error: no profile to target (pass one: scripts/install-launchagent.sh <profile.cmf>)" >&2
    exit 1
fi

if [ ! -x "$CTL" ]; then
    echo "error: gk6ctl not found at $CTL (run 'npm install' first)" >&2
    exit 1
fi

mkdir -p "$(dirname "$LOG")" "$(dirname "$WRAPPER")"

# 1) materialize the wrapper with absolute paths (from the template)
sed -e "s|%%GK6CTL%%|$CTL|g" -e "s|%%PROFILE%%|$PROFILE|g" -e "s|%%LOG%%|$LOG|g" \
    "$REPO/scripts/ensure-at-login.sh" > "$WRAPPER"
chmod +x "$WRAPPER"

# 2) write the LaunchAgent
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$WRAPPER</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG</string>
    <key>StandardErrorPath</key>
    <string>$LOG</string>
</dict>
</plist>
EOF

# 3) (re)load it
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "installed: $PLIST"
echo "  wrapper: $WRAPPER"
echo "  profile: $PROFILE"
echo "  log:     $LOG"
echo "run now (login dry-run): bash $WRAPPER"
echo "remove:  launchctl bootout \"gui/\$(id -u)/$LABEL\" && rm \"$PLIST\""