#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$#" -gt 1 ]; then
    echo "Usage: $0 [REPO_DIR]" >&2
    exit 2
fi

if [ "$#" -eq 1 ]; then
    REPO_DIR="$1"
else
    REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

if [ ! -d "$REPO_DIR" ]; then
    echo "error: repo directory does not exist: $REPO_DIR" >&2
    exit 1
fi
REPO_DIR="$(cd "$REPO_DIR" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
    echo "error: must run as root (sudo)" >&2
    exit 1
fi

UNIT_DIR="/etc/systemd/system"
SERVICE_SRC="$SCRIPT_DIR/booking-buddy.service.in"
TIMER_SRC="$SCRIPT_DIR/booking-buddy.timer"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

sed "s|@REPO_DIR@|$REPO_DIR|g" "$SERVICE_SRC" > "$tmp"
install -m 644 "$tmp" "$UNIT_DIR/booking-buddy.service"
install -m 644 "$TIMER_SRC" "$UNIT_DIR/booking-buddy.timer"

systemctl daemon-reload
systemctl enable --now booking-buddy.timer

echo "installed booking-buddy.service and booking-buddy.timer for $REPO_DIR"
