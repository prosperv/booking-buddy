import { normalizePlayerName } from "../src/players";

/**
 * Roster name -> CourtReserve member name, as configured in `bot.config.json`.
 *
 * Some members have names common enough that the club's booking system can't
 * tell them apart in the member search, so they register under a modified name
 * that is unique instead. The roster still carries the name people recognise,
 * so the bot has to translate before it can search. Keys are
 * `normalizePlayerName`-normalized by `validateConfig` so lookups are plain
 * property reads; values are the member name as written, because that is what
 * gets typed into the member search and logged.
 */
export type NameMap = Readonly<Record<string, string>>;

/**
 * The name to type into the member search: the mapped CourtReserve name, or
 * the name itself when it isn't mapped. With no map configured this is the
 * identity function, so an unconfigured run behaves exactly as before.
 */
export function mappedName(map: NameMap | undefined, name: string): string {
    if (!map) return name;
    return map[normalizePlayerName(name)] ?? name;
}

/**
 * The canonical identity of a name under `map` — the name everyone in an alias
 * chain resolves to, normalized. Two names with the same identity are the same
 * player, whichever side of a mapping each one came from, so a court holding
 * either spelling still matches the roster.
 *
 * Chains are followed to their end (`a` -> `b` -> `c` gives `a`, `b` and `c`
 * the same identity), and a cycle — which `validateConfig` does not rule out —
 * resolves to the smallest normalized name in it, so the answer does not depend
 * on which side of the cycle the name started from. With no map configured this
 * is just `normalizePlayerName(name)`.
 */
export function playerIdentity(map: NameMap | undefined, name: string): string {
    const start = normalizePlayerName(name);
    if (!map) return start;

    const seen = new Set([start]);
    let current = start;
    for (;;) {
        const next = map[current];
        if (next === undefined) return current;
        // The map's values are display names, so each hop is normalized on the
        // way past rather than being assumed normalized already.
        const identity = normalizePlayerName(next);
        if (seen.has(identity)) {
            let smallest = current;
            for (const visited of seen) if (visited < smallest) smallest = visited;
            return smallest;
        }
        seen.add(identity);
        current = identity;
    }
}