#!/usr/bin/env bash
#
# Start the Expo dev server and open the reader in an iPhone *and* an iPad
# simulator at once, so a layout change can be checked at both widths without
# restarting anything.
#
# Override the devices by name if you want a different pair:
#   PHONE_SIM="iPhone 17e" TABLET_SIM="iPad mini (A17 Pro)" pnpm dev:mobile:sims
#
set -euo pipefail

PHONE_SIM="${PHONE_SIM:-iPhone 17 Pro}"
TABLET_SIM="${TABLET_SIM:-iPad Pro 11-inch (M5)}"
PORT="${PORT:-8081}"

# The Command Line Tools install has no simctl, so point xcrun at Xcode itself
# when the active developer directory is the CLT one.
if ! xcrun --find simctl >/dev/null 2>&1; then
  export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
  if ! xcrun --find simctl >/dev/null 2>&1; then
    echo "error: simctl not found — install Xcode, or run: sudo xcode-select -s /Applications/Xcode.app" >&2
    exit 1
  fi
fi

udid_for() {
  # Lines look like: "    iPhone 17 Pro (UDID) (Shutdown)". Anchor on the exact
  # name so "iPhone 17 Pro" does not match "iPhone 17 Pro Max".
  xcrun simctl list devices available |
    sed -n "s/^ *$1 (\([0-9A-F-]\{36\}\)) .*/\1/p" |
    head -n 1
}

expo_go_glob() {
  echo "$HOME/Library/Developer/CoreSimulator/Devices/$1/data/Containers/Bundle/Application/*/$2"
}

has_expo_go() {
  # Check the installed bundles on disk rather than asking `simctl listapps`,
  # which returns an incomplete list for a device that has only just booted and
  # would have us reinstall — wiping the stored session every launch.
  compgen -G "$(expo_go_glob "$1" 'Expo-Go-*.app')" >/dev/null ||
    compgen -G "$(expo_go_glob "$1" 'Exponent.app')" >/dev/null ||
    xcrun simctl listapps "$1" 2>/dev/null | grep -q "host.exp.Exponent"
}

# Expo Go is what actually renders the app (this is a managed project, no
# native build). A simulator that has never run `pnpm dev:mobile:ios` will not
# have it, so copy the bundle from a simulator that does.
ensure_expo_go() {
  local udid="$1" name="$2"
  if has_expo_go "$udid"; then
    return
  fi
  local bundle
  bundle=$(find ~/Library/Developer/CoreSimulator/Devices/*/data/Containers/Bundle/Application \
    -maxdepth 2 \( -name "Expo-Go-*.app" -o -name "Exponent.app" \) -print -quit 2>/dev/null || true)
  if [[ -z "$bundle" ]]; then
    echo "error: Expo Go is not installed on \"$name\" and no copy was found on another" >&2
    echo "       simulator. Run \`pnpm dev:mobile:ios\` once with that device selected first." >&2
    exit 1
  fi
  echo "Installing Expo Go on \"$name\"…" >&2
  xcrun simctl install "$udid" "$bundle"
}

boot() {
  local name="$1" udid
  udid=$(udid_for "$name")
  if [[ -z "$udid" ]]; then
    echo "error: no available simulator named \"$name\" (see: xcrun simctl list devices available)" >&2
    exit 1
  fi
  # `boot` exits 149 when the device is already booted, which is fine here.
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  ensure_expo_go "$udid" "$name"
  echo "$udid"
}

echo "Booting \"$PHONE_SIM\" and \"$TABLET_SIM\"…"
PHONE_UDID=$(boot "$PHONE_SIM")
TABLET_UDID=$(boot "$TABLET_SIM")
open -a Simulator

# Hand both simulators the dev server URL once Metro is actually serving.
# 127.0.0.1 resolves to this machine from inside a simulator.
(
  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:${PORT}/status" >/dev/null 2>&1; then
      for udid in "$PHONE_UDID" "$TABLET_UDID"; do
        xcrun simctl openurl "$udid" "exp://127.0.0.1:${PORT}" || true
      done
      exit 0
    fi
    sleep 1
  done
  echo "warning: dev server never came up on port ${PORT}; press i in the Expo prompt instead" >&2
) &
OPENER_PID=$!
trap 'kill "$OPENER_PID" 2>/dev/null || true' EXIT

exec npx expo start --port "$PORT"
