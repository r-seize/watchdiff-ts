/**
 * Parser - extracts the content zone the user wants to monitor.
 *
 * If a CSS selector (target) is provided, only that zone is extracted.
 * Otherwise the full body text is used.
 */

import type { CheerioAPI } from "cheerio";
import { makeSnapshot, type Snapshot, type WatchConfig } from "../models.js";

export class ParserError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ParserError";
    }
}

export class Parser {
    /**
     * Extract a Snapshot from a cleaned cheerio document.
     *
     * @param $ - Cleaned cheerio root (output of Cleaner.clean)
     * @param config - WatchConfig describing what to monitor
     * @throws ParserError if the target selector matched nothing
     */
    extract($: CheerioAPI, config: WatchConfig): Snapshot {
        let rawHtml: string;
        let content: string;

        if (config.target) {
            const els = $(config.target);
            if (els.length === 0) {
                throw new ParserError(
                    `Selector ${JSON.stringify(config.target)} matched nothing on ${config.url}`
                );
            }
            rawHtml = els
                .map((_, el) => $.html(el))
                .get()
                .join("\n");
            content = els
                .map((_, el) => $(el).text().trim())
                .get()
                .join("\n");
        } else {
            const body  = $("body");
            rawHtml     = body.html() ?? $.html();
            content     = body.text();
        }

        content = collapseWhitespace(content);

        return makeSnapshot(config.url, config.target, content, rawHtml);
    }
}

function collapseWhitespace(text: string): string {
    return text
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n");
}