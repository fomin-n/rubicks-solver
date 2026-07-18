#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cert_dir="$project_dir/.certs"

detect_lan_ip() {
  local interface_name=""
  if command -v ipconfig >/dev/null 2>&1; then
    interface_name="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
    [[ -n "$interface_name" ]] && ipconfig getifaddr "$interface_name" 2>/dev/null && return
    ipconfig getifaddr en0 2>/dev/null && return
    ipconfig getifaddr en1 2>/dev/null && return
  fi
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}'
  fi
}

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is required. On macOS, install it with: brew install mkcert" >&2
  exit 1
fi

lan_ip="$(detect_lan_ip)"
if [[ -z "$lan_ip" ]]; then
  echo "Could not detect an active LAN IPv4 address. Connect to Wi-Fi and retry." >&2
  exit 1
fi
local_name="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"
mkdir -p "$cert_dir"

if ! mkcert -install; then
  echo "Warning: macOS did not allow non-interactive trust installation." >&2
  echo "Run 'mkcert -install' in your own terminal and enter the administrator password." >&2
  echo "Continuing with certificate generation so the iPhone setup can proceed." >&2
fi
mkcert -cert-file "$cert_dir/mobile.pem" -key-file "$cert_dir/mobile-key.pem" \
  localhost 127.0.0.1 ::1 "$local_name.local" "$lan_ip"
printf '%s\n' "$lan_ip" > "$cert_dir/lan-ip"

caroot="$(mkcert -CAROOT)"
echo
echo "Mobile certificate created for https://$lan_ip:5173"
echo "Transfer only this public CA certificate to the iPhone: $caroot/rootCA.pem"
echo "NEVER transfer or share: $caroot/rootCA-key.pem"
echo "Then install the profile and enable full trust in iOS Certificate Trust Settings."
