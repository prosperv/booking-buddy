import type { BrowserContext, Page } from "playwright";

/**
 * CourtReserve's member search, as the server sees it.
 *
 * The member search is a request the page makes on its own — the Kendo
 * ComboBox behind `input[name="OwnersDropdown_input"]` filters as you type — so
 * the ids of the matching members are on the wire whether or not the bot looks
 * for them. This records them so a search can be resolved by member id rather
 * than by display name, which is the only way to pick between two members the
 * club's booking system lists under the same name.
 *
 * Selection otherwise reads the rendered `#OwnersDropdown_listbox li.k-list-item`
 * DOM, which is the stable surface. The payload here is the fragile one: it is
 * an undocumented endpoint whose records could reorder, drop a field, or
 * disappear entirely. So it is only ever used to *enrich* the DOM options, and
 * only when the two agree exactly on how many results there are — see
 * `memberSearchRecords`. When they disagree the ids are withheld and matching
 * falls back to names, which is a wrong answer for two same-named members
 * rather than the wrong person on a court.
 */

/** The member-search endpoint. Only its records are consumed, never its shape. */
const MEMBER_SEARCH_URL = /GetMembersToPlayWith/i;

/**
 * The subset of a member-search record this module reads. Everything else is
 * ignored so an added field cannot break parsing; a missing `MemberId` simply
 * yields an option with no id, which degrades to name matching.
 */
export type MemberSearchRecord = {
    MemberId?: number;
    DisplayName?: string;
};

/** Latest member-search records per page. A `WeakMap`, not module state: two clients can share a process. */
const recordsByPage = new WeakMap<Page, MemberSearchRecord[]>();

/**
 * Records member-search responses for every page in the context.
 *
 * Listens on the context rather than per page so later pages — `withEditModal`
 * opens a throwaway one per booking — are covered without threading anything
 * through. Idempotent, so it is safe to call from anywhere that has a context.
 */
export function attachMemberSearchCapture(context: BrowserContext): void {
    context.on("page", (page) => attachToPage(page));
    for (const page of context.pages()) attachToPage(page);
}

function attachToPage(page: Page): void {
    page.on("response", (response) => {
        if (!MEMBER_SEARCH_URL.test(response.url())) return;
        // Fire and forget: the listener cannot await, and a failed read only
        // costs the ids, so the parse is kept separate from the event handler.
        void response
            .text()
            .then((body) => {
                const parsed: unknown = JSON.parse(body);
                if (Array.isArray(parsed)) recordsByPage.set(page, parsed as MemberSearchRecord[]);
            })
            .catch(() => undefined);
    });
}

/**
 * The member-search records last returned for `page`, or `undefined` when the
 * page has not made one. The dropdown cannot render before its response lands,
 * so by the time the DOM is ready this is the search the caller is looking at.
 */
export function memberSearchRecords(page: Page): MemberSearchRecord[] | undefined {
    return recordsByPage.get(page);
}