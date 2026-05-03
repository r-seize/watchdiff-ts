/**
 * Fetcher - retrieves raw HTML from a URL using the native fetch API (Node 18+).
 */

import type { WatchConfig } from "../models.js";

const DEFAULT_HEADERS: Record<string, string> = {
    "User-Agent":
        "Mozilla/5.0 (compatible; WatchDiff/0.1; +https://github.com/watchdiff/watchdiff)",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
};

export class FetchError extends Error {
    constructor(
        message: string,
        public readonly statusCode?: number
    ) {
        super(message);
        this.name = "FetchError";
    }
}

export class Fetcher {
    async fetch(config: WatchConfig): Promise<string> {
        const headers       = { ...DEFAULT_HEADERS, ...config.headers };
        const controller    = new AbortController();
        const timer         = setTimeout(() => controller.abort(), config.timeout);

        try {
            const response = await globalThis.fetch(config.url, {
                headers,
                signal: controller.signal,
                redirect: "follow",
            });

            if (!response.ok) {
                throw new FetchError(
                    `HTTP ${response.status} for ${config.url}`,
                    response.status
                );
            }

            return await response.text();
        } catch (err) {
            if (err instanceof FetchError) throw err;
            if (err instanceof Error && err.name === "AbortError") {
                throw new FetchError(`Request timeout for ${config.url}`);
            }
            throw new FetchError(
                `Request error for ${config.url}: ${err instanceof Error ? err.message : String(err)}`
            );
        } finally {
            clearTimeout(timer);
        }
    }
}