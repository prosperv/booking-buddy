import { normalizePlayerName } from "../src/players";

/**
 * Roster name -> how to find that member on CourtReserve, as configured in
 * `bot.config.json`.
 *
 * A **string** value is the member name as written, for the members whose own
 * name is not unique enough for the booking system's member search to tell them
 * apart and who registered under a modified one instead ("Brian Lim" -> "Brian
 * Lim (Superior)"). The roster still carries the name people recognise, so the
 * bot has to translate before it can search.
 *
 * A **number** value is a CourtReserve `MemberId`, for two distinct members who
 * share a name outright — the search returns both and nothing in the display
 * names separates them. There is no name to type, so the roster name is used as
 * the query and the id picks the option. Getting the id: a run that hits the
 * ambiguity logs every candidate as `DisplayName=MemberId`.
 *
 * Keys are `normalizePlayerName`-normalized by `validateConfig` so lookups are
 * plain property reads; string values are stored as written, because that is
 * what gets typed into the member search and logged.
 */
export type NameMap = Readonly<Record<string, string | number>>;

/** A roster name resolved against `nameMap`: the query to search, plus the id to pick if one is configured. */
export type NameMapping = { name: string; memberId?: number };

/**
 * Resolves a roster name to what the bot should search for and, when the config
 * pins the member by id, which one to pick.
 *
 * An id mapping keeps the roster name as the query rather than inventing one:
 * the member search is a case-insensitive substring match, so the roster name is
 * what brings both same-named members back to choose between. With no map
 * configured this is the identity function, so an unconfigured run behaves
 * exactly as before.
 */
export function resolveMapping(map: NameMap | undefined, name: string): NameMapping {
    if (!map) return { name };
    const mapped = map[normalizePlayerName(name)];
    if (mapped === undefined) return { name };
    if (typeof mapped === "number") return { name, memberId: mapped };
    return { name: mapped };
}

/**
 * The name to type into the member search: the mapped CourtReserve name, or the
 * name itself when it isn't mapped or is mapped by id.
 */
export function mappedName(map: NameMap | undefined, name: string): string {
    return resolveMapping(map, name).name;
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
 *
 * An **id** mapping ends the chain instead of extending it. An id selects a
 * member from search results; it is not another spelling of the name, so there
 * is nothing to normalize and nothing to alias. Two members who share a name
 * therefore keep separate identities only by accident of their spellings —
 * which is why booking cards carrying no ids is the reason identity stays
 * name-based, and why an id mapping must not pretend to be an alias.
 */
export function playerIdentity(map: NameMap | undefined, name: string): string {
    const start = normalizePlayerName(name);
    if (!map) return start;

    const seen = new Set([start]);
    let current = start;
    for (;;) {
        const next = map[current];
        if (next === undefined) return current;
        if (typeof next === "number") return current;
        // The map's string values are display names, so each hop is normalized
        // on the way past rather than being assumed normalized already.
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