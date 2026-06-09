import fs from "node:fs/promises";
import { maxActionDelay, minActionDelay } from "./constants";

export function randomDelay(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pauseForAction(): Promise<void> {
    const waitMs = randomDelay(minActionDelay, maxActionDelay);
    await delay(waitMs);
}

export async function fileExists(path: string): Promise<boolean> {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

export async function waitForEnter(): Promise<void> {
    console.log("Press Enter after you have logged in successfully.");
    return new Promise((resolve) => {
        process.stdin.resume();
        process.stdin.setEncoding("utf8");
        process.stdin.once("data", () => {
            process.stdin.pause();
            resolve();
        });
    });
}
