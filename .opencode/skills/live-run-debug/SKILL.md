---
name: live-run-debug
description: Attach the V8 inspector to a live booking-buddy run. Use for bugs that only reproduce against the real CourtReserve site, for validating the residual risks in AGENTS.md (Kendo member-search debounce, the post-save readDetailPlayers race, loginWithCredentials redirect timing), or when asked to debug ensure-roster / check-auth / roster-test with the node-debugger MCP. Covers launching under tsx, finding the right session, breakpoints, logpoints for timing-sensitive flows, and teardown.
---

# Debugging a live run

Some behaviour here cannot be reproduced offline. The HTML fixtures have no
JavaScript, so the interactive chain (Kendo ComboBox, member-search XHR, the
save POST) exists only on the real site. This is how to put a breakpoint in it.

**Before anything else: the live site is the production site.** `ensure-roster`
without `--dry-run` adds and removes real players on real members'
reservations, and there is no undo path (the organizer is never auto-added, so
a wrong split is not self-correcting). Default to `--dry-run` and step up only
deliberately. See `/dryrun` for the same rule stated from the bot side.

## Launch

Node here is v20 — no native TypeScript — so tsx is required. Prefer one
process over three:

```
node-debugger_debug_launch({
  cwd: <repo root>,
  command: ["node", "--import", "./node_modules/tsx/dist/loader.mjs",
            "bot/index.ts", "<command>", "--config", "<cfg>"],
  env: { MIN_ACTION_DELAY_MS: "0", MAX_ACTION_DELAY_MS: "0", LOG_LEVEL: "debug" },
  stopOnEntry: false
})
```

- **`--import ./node_modules/tsx/dist/loader.mjs` is the whole trick.** The same
  module is tsx's `"."` export (`node_modules/tsx/package.json`), and spelling it
  out avoids bare-specifier resolution entirely.
- **`npx tsx` also works but costs you three sessions.** The tsx CLI re-spawns
  node via `child_process` (`node_modules/.bin/tsx` → `tsx/dist/cli.mjs`) and
  `npx` adds its own process on top. Measured: one root session plus three
  auto-attached children, with your code in exactly one of them. Every tool takes
  `sessionId`, so you would then have to find it — see "Finding your session".
- **`stopOnEntry: false` plus a real breakpoint.** The earliest pause lands inside
  tsx's own bundle, not your code.

Verified working (2026-10-20, against a throwaway TS probe): source maps come
through — the pause reports real TypeScript lines and original file URLs — and a
breakpoint on `src/<file>.ts` binds normally.

### Config and commands

Same machine-local config `/dryrun` uses:

```
cfg=/home/pvan/bot.test.config.json; [ -f "$cfg" ] || cfg=bot.config.json
```

Cheapest to most dangerous: `roster-test` (no browser at all) → `check-auth`
(smallest live run; exercises `isLoggedIn`, never edits) → `ensure-roster
--dry-run` (reads live bookings and plans; never opens the edit modal —
`bot/ensure-roster.ts:333`) → `ensure-roster` (real edits). Get `--job` values
from `roster-test`; never invent one. Never read `bot.config.json`,
`auth.json`, or `my-profile/` — the permission block is a guardrail, not a
boundary.

## Finding your session

- `debug_list_sessions({includeWrappers: true})` — then for each candidate
  `debug_list_scripts({sessionId, urlFilter: "bot/index"})`. The session whose
  scripts are your `.ts` files is the one to talk to. Script URLs look like
  `file:///home/pvan/booking-buddy/src/navigation.ts`.
- `debug_wait_for_any_pause` is the right tool when you have several children and
  don't know which one will hit first.

## Choosing the mechanism

A pause freezes **node only**; the browser keeps running. That makes a
breakpoint the wrong tool for the three timing-shaped residual risks:

| What you're validating | Use |
|---|---|
| `typePlayerSearch` vs the Kendo debounce (`src/players.ts:238`), the post-save `readDetailPlayers` race (`src/players.ts:222`), `loginWithCredentials` redirect timing (`src/login.ts:48`) | `debug_set_logpoint` + `debug_get_output`, or `debug_trace_start`/`_stop` — no pause, timing preserved |
| Structure: what did the page give us, which branch was taken | `debug_set_breakpoint`, then `debug_get_stack` / `get_scope` / `get_properties` |
| A stall with no error | `debug_eval` on `pendingRequests(page)` (`src/pending-requests.ts:56`) — the pending URLs are the only explanation for a `navigate-timeout` |
| Which paths actually ran | `debug_trace_start`/`_stop` or `debug_coverage` |

Caveat on the delay env vars: they zero the 1–3 s anti-bot pauses
(`src/constants.ts:14-15`), which is what makes stepping usable — but they are
read once at module load, so they must go in `debug_launch.env`, not a later
shell. They do **not** cover typing: `TYPING_DELAY_MS = 80`
(`src/players.ts:16`) is a constant. Set them to `1` rather than `0` when the
thing you're debugging *is* a race.

## Breakpoint map

Cite functions, not line numbers — they drift. Grep for the name, then set the
breakpoint. Remember the `line` argument is **0-indexed** (subtract 1 from the
editor line); the returned snippet is labelled 1-indexed, so `> 2:` is line 2.

- `src/utils.ts` `pauseForAction` — confirms delays are actually zeroed
- `src/navigation.ts` `navigateTo` — the readiness-selector wait and its timeout path
- `src/interactions.ts` `humanClick`
- `src/players.ts` `typePlayerSearch` (per-char typing), `readDetailPlayers`, `saveReservation`
- `src/client.ts` `getCurrentBookings`, `withEditModal`, `swapPlayersOnBooking`
- `src/login.ts` `isLoggedIn`, `loginWithCredentials`
- `src/booking.ts` `collectBookingSessions`
- `src/logger.ts` write path — for the unwritable-log-file failure mode

Also useful: `debug_set_exception_breakpoint({state: "uncaught", filter:
["TimeoutError"]})` to stop where a Playwright timeout is thrown rather than
several frames up. And `debug_get_output` mirrors the console alongside
`log/bot-<date>.log`, which `/logs` digests.

If a breakpoint refuses to resolve: `debug_list_scripts` to see the real URL,
then `urlRegex` instead of `file`, or `debug_break_on_load` for code that runs
before you can attach.

## Teardown

`debug_disconnect({sessionId, kill: true, cascade: true})` — cascade also kills
the auto-attached children. Do it every time: a leaked Chromium holds the
persistent `my-profile/` context, and every run mutates that profile whether or
not you paused anything.

## Troubleshooting

**Target is alive but no `src/*.ts` script ever loads** (the symptom: process
running, stdout empty, `debug_list_scripts` shows only tsx/esbuild internals).
tsx's loader runs in a worker thread whose inspector pauses at its own first
line; module loads block until someone attaches. Fix:
`debug_get_output({stream: "stderr"})`, find the *second*
`Debugger listening on ws://…` line, and `debug_attach({url: <that ws url>})`.
Confirmed to unblock immediately; it is intermittent, since a later worker in
the same run auto-attached on its own.

**`Can only perform operation while paused`** — you're talking to the wrong
session, or nothing has hit yet. Re-run `debug_list_sessions`.
