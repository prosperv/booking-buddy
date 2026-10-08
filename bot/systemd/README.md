# systemd units

Daily `ensure-roster` run on the Raspberry Pi. The job is idempotent (players
already on a booking are reported as skipped), so a daily timer is safe and
catches bookings as they appear.

## Install

`booking-buddy.service.in` is a template with `@REPO_DIR@`, `@USER@`,
`@GROUP@`, and `@HOME@` placeholders; `install.sh` substitutes them, installs
the units, and enables the timer. It takes the repo path as an optional argument
and otherwise infers it from its own location.

```bash
sudo ./bot/systemd/install.sh            # auto-detect repo path
# or, to install from a different checkout:
sudo ./bot/systemd/install.sh /path/to/booking-buddy
# or, to pin the account the service runs as:
sudo ./bot/systemd/install.sh --user "$USER" /path/to/booking-buddy
```

1. Ensure a valid session exists at `<repo>/auth.json` (run `npm start` once
   from a machine with a display to log in, then copy it to the Pi). A
   `my-profile/` copied over from that machine is optional — Chromium creates it
   on the first run if it isn't there.
2. Optionally add credentials, so the run can recover by itself when that
   session expires (see below).
3. Run the installer.

This substitutes the placeholders in `booking-buddy.service.in`, copies both
units to `/etc/systemd/system/`, then runs `systemctl daemon-reload` and
`systemctl enable --now booking-buddy.timer`.

## Unattended login (optional)

CourtReserve drops a saved session every few weeks. Without credentials the next
run falls through to `init()`'s interactive manual-login prompt, which a
`Type=oneshot` unit has no TTY for — so the run hangs until `TimeoutStartSec`
kills it. With the account credentials in a root-owned env file, the run logs
itself back in instead:

```bash
sudo install -d -m 700 -o root -g root /etc/booking-buddy
sudoedit /etc/booking-buddy/credentials.env   # then: chmod 600 /etc/booking-buddy/credentials.env
```

```ini
COURTRESERVE_USERNAME=you@example.com
COURTRESERVE_PASSWORD=your-password
```

The unit references it as `EnvironmentFile=-/etc/booking-buddy/credentials.env`.
The leading `-` is what keeps the file optional: a checkout without it installs
and runs exactly as before. systemd reads that file as root before dropping
privileges, so its contents are not exposed by `systemctl show` the way an inline
`Environment=` line would be — but the password is in the service process's
environment, so it is readable by anyone who can read that account's processes,
same as any other env secret. Only the username is ever logged.

Rotate the password by editing that file and restarting the service
(`sudo systemctl restart booking-buddy.service`); the next run uses the new one.
If the credentials stop working, the run fails with `credential-login-failed` —
the log says so, and `check-auth` exits non-zero. It does *not* fall back to the
interactive prompt, which could not help here anyway.

`install.sh` warns (never fails) if that file exists but is not root-owned mode
600, and if `auth.json` is world-readable — both hold secrets of the same
practical exposure.

## The account it runs as

The service runs as an unprivileged account, never root — it drives a browser
holding live session state, and needs write access to the checkout. `install.sh`
resolves it from `--user`, else `$SUDO_USER`, else the owner of the checkout,
and substitutes that account plus its group and home directory. `HOME` is set in
the unit because Chromium keeps its cache and crash dumps there.

The only hard requirement is that the checkout is writable by that account:
`log/` and `my-profile/` don't exist until the first run and are created there
(pino's `mkdir: true`, and Playwright's persistent-context directory).

`install.sh` checks that and three other things that would otherwise fail at
run time — an unexecutable `node_modules/.bin/tsx`, a read-only `auth.json`
(the run re-writes it with refreshed cookies on close), and a `my-profile/`
copied in root-owned — but only ever **warns**, printing the exact remedy. A
root-run `npm install` is what usually causes them; install as the run user and
then run the installer. It also warns about the two secret files' ownership and
mode (see "Unattended login" above), and reports when there is no credentials
file at all.

It also checks the system clock is NTP-synced, enabling NTP once if it isn't,
and warns (never fails) if it still isn't: the timer's `OnCalendar` and the
bot's "next upcoming session" pick are both clock-sensitive, and a drifted clock
produces plausible wrong dates rather than an error. Fix it with
`timedatectl set-ntp true` or `apt install chrony`.

`TimeoutStartSec=3600` bounds a single run. Without it, a missing `auth.json`
would hang forever — `init()` falls through to the interactive manual-login
prompt, and a `Type=oneshot` unit has no TTY to press Enter on — leaving the
unit `activating` and piling up every later timer fire. Configuring the
credentials above removes the cause rather than just bounding it.

## Ops

- Trigger a run now: `sudo systemctl start booking-buddy.service`
- Inspect output: `journalctl -u booking-buddy.service -n 50 --no-pager`
- Next scheduled run: `systemctl list-timers booking-buddy.timer`
- Account it runs as: `systemctl show booking-buddy.service -p User`

Each run also writes two JSON-lines logs under `<repo>/log/` (library +
bot, date-stamped); see the parent `bot/README.md` "Logging" section. Nothing
currently rotates them — see the "Pi / ops" section of the repo's `TODO`.

The service logs structured per-job output (roster count, booking count, per
booking adds/skips/failures) and a single `run-end` tally, e.g.

```
ensure-roster done (ok=true) — 1 session(s), 2 court(s) edited, 7 added, 1 removed, 3 skipped, 0 failed
```

which is `warn`-level when anything needs a human (a player failed, a session
had no booking, no upcoming session, or an empty roster cleared the courts).
That line is the quickest answer to "did anything happen last night":
`grep '"event":"run-end"' log/bot-*.log | tail -1`. Player-level failures
(`not-found`, `ambiguous`) are reported but do not fail the unit; a non-zero
exit means a config/data problem (e.g. a missing roster CSV), which `journalctl`
will show.

If the credentials are configured, a run that had to re-login says so in the
library log — `grep '"event":"credential-login"' log/booking-buddy-*.log`. The
first one is expected (the session expired); a long run of them means the saved
session is not being refreshed and something is off with `auth.json`.
