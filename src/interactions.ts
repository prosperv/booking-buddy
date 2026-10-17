import { Locator } from "playwright";
import { loggerFor } from "./log-context";
import { delay, pauseForAction } from "./utils";

/** How many times to re-resolve and re-click before giving up on a detached element. */
const CLICK_RETRIES = 3;

/** Pause between attempts, so the site's re-render can finish instead of losing the race again. */
const CLICK_RETRY_DELAY_MS = 750;

/**
 * Failures that mean "the element you were about to click moved", as opposed to
 * "the element is not there".
 *
 * CourtReserve's member table is re-rendered by its own cost recalculation
 * whenever a player is added or removed, which replaces the rows a moment after
 * a click has been aimed at one. Removing a player dropped the row and the
 * recalculation swapped the table out from under the in-flight action, so the
 * remove button went from attached to gone mid-click. Two live courts were lost
 * that way, and the site itself had already tried three times over 620ms before
 * Playwright gave up — the replacement had not arrived yet.
 *
 * Everything else must still fail immediately. A button that is genuinely absent
 * will not appear on a second attempt, and retrying those just turns a loud,
 * fast failure into a slow silent one.
 */
const TRANSIENT_CLICK_ERRORS = [
    "not attached to the dom",
    "element is not stable",
    "element is not visible",
    "intercepts pointer events",
];

/**
 * Whether a click failed because the target moved rather than because it is
 * missing. Exported for testing: this classification is the only thing standing
 * between a two-second failure and a silent multi-second stall, so it is worth
 * pinning rather than leaving to a live run.
 */
export function isTransientClickError(message: string): boolean {
    const lower = message.toLowerCase();
    return TRANSIENT_CLICK_ERRORS.some((pattern) => lower.includes(pattern));
}

/** One pass of the click. Split out so the retry wraps a whole attempt. */
async function clickOnce(locator: Locator): Promise<void> {
    await locator.scrollIntoViewIfNeeded();

    const box = await locator.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) {
        await locator.click();
        return;
    }

    await locator.page().mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
        steps: 10,
    });
    await pauseForAction();
    await locator.page().mouse.down();
    await locator.page().mouse.up();
}

/**
 * Clicks an element the way a person would: scroll it into view, then move the
 * mouse to its center (with a small trajectory) and press/release.
 * Deliberately emits real mouse events — plus a random anti-bot pause —
 * rather than dispatching a synthetic click.
 *
 * Falls back to `locator.click()` when the element has no usable bounding
 * box (null or zero-sized). That keeps the flow working against the CSS-less
 * test fixtures (which have no real layout) and against oddly laid-out
 * elements on the live site.
 *
 * Retries a target that moved out from under the action. This is safe, and
 * cheap, for two reasons. A Playwright `Locator` is a lazy query rather than a
 * captured element, so the next attempt resolves the row that replaced the
 * detached one — nothing has to be re-selected by name. And every failure this
 * retries on can only come from the two reads *before* the click is dispatched
 * (`scrollIntoViewIfNeeded`, `boundingBox`); once the mouse is committed,
 * nothing re-resolves and so nothing here can throw a second time. A click that
 * landed is never clicked twice.
 */
export async function humanClick(locator: Locator): Promise<void> {
    for (let attempt = 1; attempt <= CLICK_RETRIES + 1; attempt += 1) {
        try {
            await clickOnce(locator);
            return;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const last = attempt === CLICK_RETRIES + 1;
            if (last || !isTransientClickError(message)) throw err;
            loggerFor(locator.page()).debug("click target moved, retrying", {
                event: "click-retry",
                attempt,
                message,
            });
            await delay(CLICK_RETRY_DELAY_MS);
        }
    }
}