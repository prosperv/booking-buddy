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

# Seed bot.config.json from the committed example on a fresh install, so setting
# up a new host is copy-the-repo and run this rather than also hand-assembling the
# config. An existing file is never touched — it holds a live Google service
# account key, and re-running the installer must not clobber or re-own it.
CONFIG_FILE="$REPO_DIR/bot.config.json"
CONFIG_EXAMPLE="$REPO_DIR/bot/bot.config.example.json"
CONFIG_SEEDED=no

if [ -e "$CONFIG_FILE" ]; then
    echo "config: $CONFIG_FILE (existing, left as is)"
else
    if [ -f "$CONFIG_EXAMPLE" ]; then
        install -m 600 -o "$RUN_USER" -g "$RUN_GROUP" "$CONFIG_EXAMPLE" "$CONFIG_FILE" || \
            warn "$CONFIG_FILE could not be created from the example — copy it yourself and chown it $RUN_USER:$RUN_GROUP"
        if [ -e "$CONFIG_FILE" ]; then
            CONFIG_SEEDED=yes
            echo "config: created $CONFIG_FILE from the example (mode 600, owned by $RUN_USER)"
        fi
    else
        warn "$CONFIG_EXAMPLE is missing — copy bot/bot.config.example.json to $CONFIG_FILE and chown it $RUN_USER:$RUN_GROUP"
    fi
fi

# Permissions the service needs at runtime, none of which this script creates:
# pino makes log/ on its first write (mkdir: true) and Playwright makes
# my-profile/ when it opens the persistent context, so the only hard requirement
# is that the checkout itself is writable by the run user. Everything below is a
# warning rather than a failure — an install you can finish is more useful than
# one you can't — but each one makes a run fail on its first write.
# runuser drops to the account that will actually do the writing, since root can
# write anything. $test_flag is the bare test operator (w, x) — the leading "-" is
# added here, so a call site passing it wrong is a syntax error, not a check that
# silently fails.
check_as_user() {
    local test_flag="$1" word="$2" target="$3" remedy="$4"
    if [ ! -e "$target" ]; then
        return
    fi
    if ! runuser -u "$RUN_USER" -- test "-$test_flag" "$target"; then
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

# Two files hold secrets of the same practical exposure — the saved session
# cookies and the account password — so both are checked here as root rather
# than as the run user, which is not the one that can read them. A
# world-readable one is readable by every local account.
CREDENTIALS_FILE=/etc/booking-buddy/credentials.env

check_secret_file() {
    local target="$1" remedy="$2" owner mode
    if [ ! -e "$target" ]; then
        return
    fi
    owner="$(stat -c %U "$target")"
    mode="$(stat -c %a "$target")"
    if [ "$owner" != "root" ] || [ "$mode" != "600" ]; then
        warn "$target is $owner mode $mode — $remedy"
    fi
}

# The same exposure, but a file the service itself reads as the unprivileged run
# user: the bot process opens bot.config.json and auth.json directly, so they must
# stay owned by $RUN_USER. Root-owned mode 600 would be unreadable and every run
# would fail with a config-error, which is the opposite of what check_secret_file
# is guarding. Mode 600 is the part that matters here — it keeps either file off
# every other local account — and a world-readable one is the same leak.
check_secret_file_for_user() {
    local target="$1" remedy="$2" owner mode
    if [ ! -e "$target" ]; then
        return
    fi
    owner="$(stat -c %U "$target")"
    mode="$(stat -c %a "$target")"
    if [ "$owner" != "$RUN_USER" ] || [ "$mode" != "600" ]; then
        warn "$target is $owner mode $mode — $remedy"
    fi
}

check_secret_file "$CREDENTIALS_FILE" "chown root:root $CREDENTIALS_FILE && chmod 600 $CREDENTIALS_FILE"
check_secret_file_for_user "$REPO_DIR/auth.json" "chown $RUN_USER:$RUN_GROUP $REPO_DIR/auth.json && chmod 600 $REPO_DIR/auth.json, keeping it owned by $RUN_USER, which rewrites it on every run"
check_secret_file_for_user "$CONFIG_FILE" "chown $RUN_USER:$RUN_GROUP $CONFIG_FILE && chmod 600 $CONFIG_FILE"
if [ ! -e "$CREDENTIALS_FILE" ]; then
    echo "creds: none at $CREDENTIALS_FILE — a run whose auth.json has gone stale blocks on the manual-login prompt"
fi

# A seeded config is a working shell, not a working config: the placeholders are
# still in it, so the first scheduled run would fail on the service account or the
# sheet. Say so now rather than letting a 14:00 timer discover it.
if [ "$CONFIG_SEEDED" = yes ] && grep -q "REPLACE_ME" "$CONFIG_FILE"; then
    warn "$CONFIG_FILE still contains REPLACE_ME placeholders — fill in google.serviceAccount and each job's roster sheet before the first run, then verify with 'npx tsx bot/index.ts doctor --live'"
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

# CourtReserve is behind Cloudflare, which hard-403s the `HeadlessChrome`
# user-agent, so the unit runs a headed browser on a virtual display. Resolve
# the wrapper to an absolute path (systemd would search only a fixed set of
# directories for a bare name) and warn rather than fail when it is missing: the
# install is still worth completing, because installing the package afterwards is
# enough — the unit only needs a `daemon-reload`, not another install.sh run.
XVFB_RUN="$(command -v xvfb-run 2>/dev/null || true)"
if [ -z "$XVFB_RUN" ]; then
    XVFB_RUN="xvfb-run"
    warn "xvfb-run not found — every run will be blocked by Cloudflare (it 403s the HeadlessChrome user-agent a headless browser sends); fix with 'apt install xvfb' then 'systemctl daemon-reload'"
else
    echo "xvfb: $XVFB_RUN"
fi

UNIT_DIR="/etc/systemd/system"
SERVICE_SRC="$SCRIPT_DIR/booking-buddy.service.in"
TIMER_SRC="$SCRIPT_DIR/booking-buddy.timer"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

sed -e "s|@REPO_DIR@|$REPO_DIR|g" \
    -e "s|@USER@|$RUN_USER|g" \
    -e "s|@GROUP@|$RUN_GROUP|g" \
    -e "s|@HOME@|$RUN_HOME|g" \
    -e "s|@XVFB_RUN@|$XVFB_RUN|g" \
    "$SERVICE_SRC" > "$workdir/booking-buddy.service"

install -m 644 "$workdir/booking-buddy.service" "$UNIT_DIR/booking-buddy.service"
install -m 644 "$TIMER_SRC" "$UNIT_DIR/booking-buddy.timer"

systemctl daemon-reload
systemctl enable --now booking-buddy.timer

echo "installed booking-buddy.service and booking-buddy.timer, running as $RUN_USER"
if [ "${#WARNINGS[@]}" -gt 0 ]; then
    echo "${#WARNINGS[@]} warning(s) above — a run may fail until they are fixed"
fi

# Installation only proves the units exist and the files are arranged; whether a
# run will actually work is a question about the service account key, the sheet
# share, and the saved session — none of which this script can check. Point at the
# one command that answers it instead of leaving a failed 14:00 run to discover it.
echo "next: run 'npx tsx $REPO_DIR/bot/index.ts doctor --live' as $RUN_USER to confirm the config, the sheet, and auth.json before the first scheduled run"

