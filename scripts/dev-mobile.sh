#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cache_dir="${RUBICKS_SOLVER_CACHE_DIR:-$project_dir/.cache}"
cert_path="$project_dir/.certs/mobile.pem"
key_path="$project_dir/.certs/mobile-key.pem"

detect_lan_ip() {
  local interface_name=""
  if command -v ipconfig >/dev/null 2>&1; then
    interface_name="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
    [[ -n "$interface_name" ]] && ipconfig getifaddr "$interface_name" 2>/dev/null && return
    ipconfig getifaddr en0 2>/dev/null && return
    ipconfig getifaddr en1 2>/dev/null && return
  fi
  hostname -I 2>/dev/null | awk '{print $1}'
}

lan_ip="$(detect_lan_ip)"
if [[ -z "$lan_ip" ]]; then
  echo "Could not detect an active LAN IPv4 address. Connect to Wi-Fi and retry." >&2
  exit 1
fi
if [[ ! -f "$cert_path" || ! -f "$key_path" ]]; then
  echo "Mobile certificates are missing. Run: make mobile-cert" >&2
  exit 1
fi
if ! openssl x509 -in "$cert_path" -noout -text | grep -Fq "IP Address:$lan_ip"; then
  echo "The LAN address changed to $lan_ip. Regenerate the certificate with: make mobile-cert" >&2
  exit 1
fi

cleanup() {
  if [[ -n "${backend_pid:-}" ]]; then
    kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

RUBICKS_SOLVER_CACHE_DIR="$cache_dir" uv run --project "$project_dir/backend" \
  uvicorn app.main:app --app-dir "$project_dir/backend" --host 127.0.0.1 --port 8000 --reload &
backend_pid=$!

mobile_url="https://$lan_ip:5173"
echo
echo "Open on an iPhone connected to this Wi-Fi: $mobile_url"
if command -v qrencode >/dev/null 2>&1; then
  qrencode -t ANSIUTF8 "$mobile_url"
else
  echo "Optional terminal QR code: brew install qrencode"
fi
echo

MOBILE_HTTPS=1 MOBILE_CERT_PATH="$cert_path" MOBILE_KEY_PATH="$key_path" \
  npm --prefix "$project_dir/frontend" run dev
