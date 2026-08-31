# systemd units

Daily `ensure-roster` run on the Raspberry Pi. The job is idempotent (players
already on a booking are reported as skipped), so a daily timer is safe and
catches bookings as they appear.

## Install

`booking-buddy.service.in` is a template with a `@REPO_DIR@` placeholder;
`install.sh` substitutes the repo location, installs the units, and enables the
timer. It takes the repo path as an optional argument and otherwise infers it
from its own location.

1. Ensure a valid session exists at `<repo>/auth.json` and the persistent
   profile at `<repo>/my-profile/` (run `npm start` once from a machine with a
   display to log in, then copy both to the Pi).
2. Run the installer (defaults to the repo containing the script):

```bash
sudo ./bot/systemd/install.sh            # auto-detect repo path
# or, to install from a different checkout:
sudo ./bot/systemd/install.sh /path/to/booking-buddy
```

This substitutes `@REPO_DIR@` in `booking-buddy.service.in`, copies both units
to `/etc/systemd/system/`, then runs `systemctl daemon-reload` and
`systemctl enable --now booking-buddy.timer`.

## Ops

- Trigger a run now: `sudo systemctl start booking-buddy.service`
- Inspect output: `journalctl -u booking-buddy.service -n 50 --no-pager`
- Next scheduled run: `systemctl list-timers booking-buddy.timer`

The service logs structured per-job output (roster count, booking count, per
booking adds/skips/failures). Player-level failures (`not-found`, `ambiguous`)
are reported but do not fail the unit; a non-zero exit means a config/data
problem (e.g. a missing roster CSV), which `journalctl` will show.
