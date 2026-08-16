import { Locator } from "playwright";
import { pauseForAction } from "./utils";

/**
 * Clicks an element the way a person would: scroll it into view, then move
 * the mouse to its center (with a small trajectory) and press/release.
 * Deliberately emits real mouse events — plus a random anti-bot pause —
 * rather than dispatching a synthetic click.
 *
 * Falls back to `locator.click()` when the element has no usable bounding
 * box (null or zero-sized). That keeps the flow working against the CSS-less
 * test fixtures (which have no real layout) and against oddly laid-out
 * elements on the live site.
 */
export async function humanClick(locator: Locator): Promise<void> {
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
