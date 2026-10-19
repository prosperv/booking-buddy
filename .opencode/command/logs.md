---
description: Summarize the newest bot run from log/ — the tally, and anything warn or error
agent: build
---

Answer "what happened on the last run?" from `log/`. The digest below is already in this prompt:

!`f=$(ls -t log/bot-*.log 2>/dev/null | head -1); echo "== log files =="; ls -1 log/bot-*.log 2>/dev/null; echo "== log/failures =="; ls -l log/failures/ 2>/dev/null; echo "== newest: $f =="; if [ -n "$f" ]; then grep -oh '"level":"[a-z]*"' "$f" | sort | uniq -c; grep -oh '"event":"[a-z0-9-]*"' "$f" | sort | uniq -c | sort -rn; grep -E '"event":"(run-start|run-end|doctor-end)"' "$f" | grep -o '"msg":"[^"]*"'; grep -E '"level":"(warn|error)"' "$f" | cut -c1-400; fi; true`

Read it as: one line per `run-start` … `run-end` pair (each is a separate invocation of `ensure-roster`), the event mix, then every `warn`/`error` line verbatim.

Then report, in a few lines:

1. **How many runs, and each one's `ok` flag.** `run-end ok=true` is **not** a clean run — `player-failed` and the other player-level problems are `warn`-level and never change `ok` (`bot/ensure-roster.ts:357`). Read the warn lines before calling a run clean.
2. **Anything that needs a human.** These are all `warn` or `error` and all silent in the exit code: `player-failed`, `empty-roster` (the courts get cleared of everyone not on the roster), `no-booking`, `filter-matched-nothing`, `save-unconfirmed`, `not-logged-in`, `init-failed`, `config-error`, `roster-error`, `no-rosters`, `job-error`, `navigate-timeout`, `doctor-finding`.
3. **`log/failures/`** — each file is a page snapshot taken on an `error`-level failure; the path is in that log line's `snapshot` field. Match a failure to its snapshot by timestamp, and only open one when the error is a scraping or layout problem.
4. The selected session per job (`roster-selected`) and its date, so the summary says which game was touched.

Notes:

- The bot log is JSON lines and **`jq` is not installed here** — use the grep patterns above. `log/bot-<date>.log` is written by the bot, `log/booking-buddy-<date>.log` by the library underneath it; for orchestration questions you want the former.
- If a **date** was given, skip the digest and `Read` `log/bot-<date>.log` directly, then grep that file for `"level":"(warn|error)"`.
- The newest local log can be a run from another branch. The deployed `getting-ready-for-deploying` branch has a `doctor` command that `cleanup` does not, so `doctor-*` events in a log are not evidence of a local bug.
- Logs contain **real roster names**. Summarize names if a specific player matters to the question, but never paste a whole log into a commit, an issue, or a message.
- If `log/` has no bot log at all, say so plainly — there has been no local run.
