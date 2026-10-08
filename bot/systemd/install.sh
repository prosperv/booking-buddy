#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    cat <<EOF
Usage: $0 [--user NAME] [REPO_DIR]

Installs and enables the booking-buddy systemd service and timer.

  --user NAME  Account the service runs as. Defaults to \$SUDO_USER, then to the
               owner of REPO_DIR. Must be able to write the checkout, because
               log/ and my-profile/ are created on the first run.
  REPO_DIR     Checkout to run from (default: the one containing this script).
EOF
}

WARNINGS=()

warn() {
    WARNINGS+=("$1")
    echo "WARN: $1" >&2
}

REPO_DIR=""
RUN_USER=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        --user)
            if [ "$#" -lt 2 ]; then
                echo "error: --user requires an argument" >&2
                usage >&2
                exit 2
            fi
            RUN_USER="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        -*)
            echo "error: unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
        *)
            if [ -n "$REPO_DIR" ]; then
                echo "error: unexpected argument: $1" >&2
                usage >&2
                exit 2
            fi
            REPO_DIR="$1"
            shift
            ;;
    esac
done

if [ -z "$REPO_DIR" ]; then
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

# The account is whatever owns the checkout, unless told otherwise. $SUDO_USER is
# the useful form of "the user I'm acting for" — plain $USER is root in here,
# since the script refuses to run as anyone else.
if [ -z "$RUN_USER" ]; then
    if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
        RUN_USER="$SUDO_USER"
    else
        RUN_USER="$(stat -c %U "$REPO_DIR")"
    fi
fi

if ! RUN_GROUP="$(id -gn "$RUN_USER" 2>/dev/null)"; then
    echo "error: run user does not exist: $RUN_USER" >&2
    exit 1
fi

if ! RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)" || [ -z "$RUN_HOME" ]; then
    echo "error: could not resolve a home directory for $RUN_USER" >&2
    exit 1
fi

echo "repo:  $REPO_DIR"
echo "user:  $RUN_USER (group $RUN_GROUP, home $RUN_HOME)"

# Permissions the service needs at runtime, none of which this script creates:
# pino makes log/ on its first write (mkdir: true) and Playwright makes
# my-profile/ when it opens the persistent context, so the only hard requirement
# is that the checkout itself is writable by the run user. Everything below is a
# warning rather than a failure — an install you can finish is more useful than
# one you can't — but each one makes a run fail on its first write.
check_as_user() {
    local test_flag="$1" word="$2" target="$3" remedy="$4"
    if [ ! -e "$target" ]; then
        return
    fi
    if ! runuser -u "$RUN_USER" -- test "$test_flag" "$target"; then
        warn "$target is not $word by $RUN_USER — $remedy"
    fi
}

if command -v runuser >/dev/null 2>&1; then
    check_as_user w writable "$REPO_DIR" "log/ and my-profile/ are created here on the first run; chown the checkout to $RUN_USER:$RUN_GROUP"
    check_as_user x executable "$REPO_DIR/node_modules/.bin/tsx" "run 'npm install' as $RUN_USER, not as root"
    # auth.json is re-written with refreshed cookies when the run closes, so a
    # read-only copy only surfaces as a `save-auth-failed` warning and the saved
    # session quietly stops refreshing until it expires.
    check_as_user w writable "$REPO_DIR/auth.json" "chown $RUN_USER:$RUN_GROUP auth.json, or the saved session never refreshes"
    check_as_user w writable "$REPO_DIR/my-profile" "chown -R $RUN_USER:$RUN_GROUP my-profile, or Chromium cannot write its profile"
else
    warn "runuser not found (util-linux) — skipping the permission checks a run needs"
fi

# The timer's OnCalendar and the bot's "next upcoming session" pick are both
# clock-sensitive, and an unsynced clock produces plausible-looking wrong dates
# rather than an error. Try once, then warn and carry on.
check_clock() {
    if ! command -v timedatectl >/dev/null 2>&1; then
        warn "timedatectl not found — cannot check whether the system clock is NTP-synced"
        return
    fi
    if [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" != "yes" ]; then
        timedatectl set-ntp true >/dev/null 2>&1 || true
        sleep 2
    fi
    if [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" != "yes" ]; then
        warn "system clock is not NTP-synced (date: $(date)) — schedule and session matching depend on it; fix with 'timedatectl set-ntp true' or 'apt install chrony'"
    else
        echo "clock: NTP synchronized ($(date))"
    fi
}

check_clock

UNIT_DIR="/etc/systemd/system"
SERVICE_SRC="$SCRIPT_DIR/booking-buddy.service.in"
TIMER_SRC="$SCRIPT_DIR/booking-buddy.timer"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

sed -e "s|@REPO_DIR@|$REPO_DIR|g" \
    -e "s|@USER@|$RUN_USER|g" \
    -e "s|@GROUP@|$RUN_GROUP|g" \
    -e "s|@HOME@|$RUN_HOME|g" \
    "$SERVICE_SRC" > "$workdir/booking-buddy.service"

install -m 644 "$workdir/booking-buddy.service" "$UNIT_DIR/booking-buddy.service"
install -m 644 "$TIMER_SRC" "$UNIT_DIR/booking-buddy.timer"

systemctl daemon-reload
systemctl enable --now booking-buddy.timer

echo "installed booking-buddy.service and booking-buddy.timer, running as $RUN_USER"
if [ "${#WARNINGS[@]}" -gt 0 ]; then
    echo "${#WARNINGS[@]} warning(s) above — a run may fail until they are fixed"
fi
