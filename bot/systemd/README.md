# systemd units

Daily `ensure-roster` run on the Raspberry Pi. The job is idempotent (players
already on a booking are reported as skipped), so a daily timer is safe and
catches bookings as they appear.

## Why the run is headed

The unit runs the browser headed, on a virtual display, and this is not a
preference — it is the only configuration that works.

CourtReserve sits behind Cloudflare, which **hard-403s any request whose
user-agent contains `HeadlessChrome`**. That is precisely the agent Playwright's
headless shell sends. A headless run therefore never sees a booking list, and
it never sees a 403 either: the WAF block page carries neither readiness
selector, so `navigateTo` burns two 60-second attempts against markup that was
never going to appear and the run fails with a `locator.waitFor` timeout that
points at nothing useful. The `init-failed` snapshot in `log/failures/` is the
tell — an HTML page titled `Attention Required! | Cloudflare` whose body reads
"Sorry, you have been blocked".

A headed Chromium sends the ordinary Chrome agent and passes. On a host with no
display, `xvfb-run` supplies a virtual one:

```
ExecStart=/usr/bin/xvfb-run -a --server-args="-screen 0 1280x1024x24" .../tsx .../bot/index.ts ensure-roster --headed
```

Three details are load-bearing:

- **`--headed` is not interchangeable with `Environment=HEADLESS=false`.**
  `bot/index.ts` defaults `headless` to `true` and only that flag clears it, then
  passes `options.headless ?? true` straight to the client — overriding the
  `HEADLESS` read in `src/constants.ts`. The CLI never sees that variable, so
  setting it in the unit changes nothing and the run is silently headless again.
- **`-a` picks a free display**, so a stale one from a killed run cannot make the
  next one fail.
- **The explicit screen size** is what `viewport: null` resolves against. Under a
  default Xvfb screen that is the window size rather than a fixed viewport, and
  too small a screen makes real clicks land outside an element.

`install.sh` resolves `xvfb-run` to an absolute path (systemd would otherwise
search only a fixed set of directories for a bare name) and **warns rather than
fails** when it is missing, so an install you can finish is still an install you
can finish — the unit needs only `systemctl daemon-reload` once `apt install
xvfb` has run. `doctor` reports the same thing as an advisory finding; it is
advisory because an interactive run on a machine with a real display never needs
it.

## Install

`booking-buddy.service.in` is a template with `@REPO_DIR@`, `@USER@`,
`@GROUP@`, `@HOME@`, and `@XVFB_RUN@` placeholders; `install.sh` substitutes them,
installs the units, and enables the timer. It takes the repo path as an optional
argument and otherwise infers it from its own location.

```bash
sudo ./bot/systemd/install.sh            # auto-detect repo path
# or, to install from a different checkout:
sudo ./bot/systemd/install.sh /path/to/booking-buddy
# or, to pin the account the service runs as:
sudo ./bot/systemd/install.sh --user "$USER" /path/to/booking-buddy
```

1. Ensure a valid session exists at `<repo>/auth.json` (see
   [Auth transfer](#auth-transfer) below). A `my-profile/` copied over from the
   desktop is not needed — Chromium creates it on the first run.
2. Optionally add credentials, so the run can recover by itself when that
   session expires (see [Unattended login](#unattended-login-optional) below).
3. Run the installer. It creates `<repo>/bot.config.json` from
   `bot/bot.config.example.json` if it isn't there, so there is nothing to copy
   by hand — but the seeded file still contains `REPLACE_ME` placeholders and
   the installer warns about that.
4. Fill in `bot.config.json` (see
   [Configuring the Google service account](#configuring-the-google-service-account))
   and confirm with `doctor` (see below).

This substitutes the placeholders in `booking-buddy.service.in`, copies both
units to `/etc/systemd/system/`, then runs `systemctl daemon-reload` and
`systemctl enable --now booking-buddy.timer`.

An existing `bot.config.json` is never overwritten, re-owned, or re-permissioned
by a re-run — it holds a live service-account key. Only a *missing* one is seeded
from the example, at mode 600 owned by the run user.

## Auth transfer

`auth.json` is usually produced somewhere else, because logging in needs a
display. On a machine with one:

```bash
npm start            # forces headless: false and waits for Enter after you log in
npm start -- --force # re-login instead of restoring an existing session
```

Then copy just that file across:

```bash
scp auth.json <pi>:<repo>/auth.json
ssh <pi> 'chmod 600 <repo>/auth.json && chown <user>:<user> <repo>/auth.json'
```

It must be **owned by the run user and mode 600**. The run re-writes it with
refreshed cookies on close, so a read-only copy shows up as a `save-auth-failed`
warning and the session quietly stops refreshing.

Do **not** copy `my-profile/`. The session lives in `auth.json`; the profile is
Chromium state underneath it, and a profile from another host carries that host's
`SingletonLock`/`SingletonSocket` and a `Last Version` pinned to the Chromium
build that wrote it. Chromium creates a fresh one on the Pi's first run.

## Configuring the Google service account

A sheet-backed roster needs a service account, which is the most manual part of
setting up:

1. Create a service account in GCP and generate a JSON key. The downloaded file
   contains `client_email` and `private_key`.
2. Copy both into `google.serviceAccount` in `bot.config.json`. **Paste the key
   exactly as it appears in that file**, with one `\n` escape per line break.
   Escaping it twice on the way in (out of a shell heredoc, an env dump, or a
   copy already round-tripped through JSON) leaves the two characters `\n` in
   the value the API signs with, which it rejects as an opaque `400`.
3. Share the spreadsheet with that `client_email` as a Viewer.
4. Give it a tab per month, named like `Sept-2026` or `Oct 2026` — the first
   three letters and a 4-digit year anywhere in the title is enough.

`bot.config.json` holds a private key, so it is created and kept at mode 600.
The installer checks that, and warns (never fails) if it is otherwise.

## Checking the setup (`doctor`)

Before trusting a schedule, ask what the installer cannot:

```bash
npx tsx bot/index.ts doctor         # local files only, no browser, no network
npx tsx bot/index.ts doctor --live  # also probe each sheet roster
```

It reports every problem it finds, each with the fix, and exits non-zero if any
is blocking: the config missing, unparseable, or still holding `REPLACE_ME`; a
mangled `private_key`; a roster file that isn't where the config says; and an
`auth.json` that is missing, truncated by a bad copy, or carries no cookies.

Missing credentials are advisory — runs work until the session expires. Run by
hand, `doctor` sees neither `COURTRESERVE_*` nor the file the unit loads them
from, because systemd reads it as root before dropping privileges; so it checks
whether `/etc/booking-buddy/credentials.env` is there and says which of the two
cases you are in. Only the missing-file one needs anything from you, and neither
is ever fatal to the check.

`--live` additionally reads each spreadsheet with the same call a real run makes,
which is the only way to prove the key authenticates *and* the sheet is shared
with it. Without it the sheet is reported as unverified. Neither mode opens a
browser: that is [`check-auth`](#ops), kept separate so this stays fast and
usable with no Chromium.

## Unattended login (optional)

CourtReserve drops a saved session every few weeks. Without credentials the next
run falls through to `init()`'s interactive manual-login prompt, which a
`Type=oneshot` unit has no TTY for — so the run hangs until `TimeoutStartSec`
kills it. With the account credentials in a root-owned env file, the run logs
itself back in instead:

```bash
sudo install -d -m 700 -o root -g root /etc/booking-buddy
sudo install -m 600 -o root -g root credentials.env /etc/booking-buddy/credentials.env
sudoedit /etc/booking-buddy/credentials.env
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
600, and if `auth.json` or `bot.config.json` is not owned by the run user at mode
600 — all three hold secrets of the same practical exposure. The two checkout
files are checked against the *run user* rather than root, unlike the env file
above: the bot process reads both itself, so root-owned mode 600 would make them
unreadable and fail every run with a config error.

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
then run the installer. It also warns about the ownership and mode of the three
secret files (see "Unattended login" above), reports when there is no credentials
file at all, and warns if a freshly seeded `bot.config.json` still contains
`REPLACE_ME` — a first install is expected to need that edit, and the timer
would otherwise discover it.

None of these checks prove a run will work; they prove the machine is arranged
for one. The installer says so and points at `doctor`, which answers the rest.

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
