---
description: Dry-run ensure-roster — plan the roster split against live bookings without editing any court
agent: build
---

Plan what `ensure-roster` would do, without touching a court.

```
cfg=/home/pvan/bot.test.config.json; [ -f "$cfg" ] || cfg=bot.config.json
npx tsx bot/index.ts ensure-roster --dry-run --config "$cfg" [--job <name>]
```

`$1`, if given, is the job name for `--job`. Do not invent one: get the list from `npx tsx bot/index.ts roster-test --config "$cfg"` (no browser).

The default config is the machine-local `/home/pvan/bot.test.config.json` outside the repo — the same one `.vscode/launch.json` uses — falling back to the repo's gitignored `bot.config.json` so this works on a fresh clone and on the Pi.

Rules:

- **Never drop `--dry-run`.** Without it the run edits live courts. This is the one irreversible command in the repo.
- `--headed` only if asked; the default headless run is the one the systemd timer uses.
- **Never read** `bot.config.json`, `auth.json`, `credentials.env`, or anything under `my-profile/`. They are secrets; the permission block is a guardrail, not a boundary.

What the dry run does and does not do: it loads every job's roster, opens a browser, and reads live bookings (`bot/ensure-roster.ts:233`), then plans the split and skips only the save loop. So it needs `auth.json` and network, but it cannot change a court.

Report:

1. The `run-start` line — mode `DRY-RUN` and the job count.
2. The session each job selected (`roster-selected`, with its date and time) and any deferred rosters.
3. The per-court plan: which names would be added and which removed, and the resulting split.
4. `overflow` and `waitlisted` — names with no room. Both are hypothetical, both are `warn`-level, and neither is added.
5. `run-end ok`, plus every `warn`/`error` line verbatim.

On a non-zero exit, the events that explain it are `config-error`, `roster-error`, `init-failed`, `not-logged-in`, and `job-error` — the same triage `/logs` does.
