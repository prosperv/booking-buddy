import { chromium } from "playwright";
import type { TestProject } from "vitest/node";

declare module "vitest" {
    export interface ProvidedContext {
        wsEndpoint: string;
    }
}

export default async function setup(project: TestProject) {
    const server = await chromium.launchServer({ headless: true });
    project.provide("wsEndpoint", server.wsEndpoint());
    return async () => {
        await server.close();
    };
}
