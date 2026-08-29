# systemd units

Daily `ensure-roster` run on the Raspberry Pi. The job is idempotent (players
already on a booking are reported as skipped), so a daily timer is safe and
catches bookings as they appear.

## Install

1. Edit `booking-buddy.service` and replace the three
   `/home/pi/booking-buddy` paths with the repo's real location.
2. Ensure a valid session exists at `<repo>/auth.json` and the persistent
   profile at `<repo>/my-profile/` (run `npm start` once from a machine with a
   display to log in, then copy both to the Pi).
3. Copy the units and enable the timer:

```bash
sudo cp bot/systemd/booking-buddy.service bot/systemd/booking-buddy.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now booking-buddy.timer
```

## Ops

- Trigger a run now: `sudo systemctl start booking-buddy.service`
- Inspect output: `journalctl -u booking-buddy.service -n 50 --no-pager`
- Next scheduled run: `systemctl list-timers booking-buddy.timer`

The service logs structured per-job output (roster count, booking count, per
booking adds/skips/failures). Player-level failures (`not-found`, `ambiguous`)
are reported but do not fail the unit; a non-zero exit means a config/data
problem (e.g. a missing roster CSV), which `journalctl` will show.
