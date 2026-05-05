/**
 * Parser - extracts the content zone the user wants to monitor.
 *
 * Supports both CSS selectors and XPath expressions as target.
 * XPath is detected automatically when target starts with "/" or "./".
 *
 * CSS path:  cheerio DOM traversal (default)
 * XPath path: @xmldom/xmldom + xpath for W3C-compliant evaluation
 */

import { DOMParser } from "@xmldom/xmldom";
import * as xpathLib from "xpath";
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
     * When config.target starts with "/" or "./" it is treated as an XPath
     * expression; otherwise it is a CSS selector.
     *
     * @param $ - Cleaned cheerio root (output of Cleaner.clean)
     * @param config - WatchConfig describing what to monitor
     * @throws ParserError if the target selector/expression matched nothing
     */
    extract($: CheerioAPI, config: WatchConfig): Snapshot {
        if (config.target && isXPath(config.target)) {
            return this.extractXPath($.html(), config);
        }
        return this.extractCss($, config);
    }

    // ------------------------------------------------------------------
    // CSS extraction (default)
    // ------------------------------------------------------------------

    private extractCss($: CheerioAPI, config: WatchConfig): Snapshot {
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
            const body = $("body");
            rawHtml    = body.html() ?? $.html();
            content    = body.text();
        }

        content = collapseWhitespace(content);
        return makeSnapshot(config.url, config.target, content, rawHtml);
    }

    // ------------------------------------------------------------------
    // XPath extraction
    // ------------------------------------------------------------------

    private extractXPath(html: string, config: WatchConfig): Snapshot {
        // errorHandler is a single function (level, msg, context) - suppress all warnings
        const doc = new DOMParser({
            errorHandler: () => {},
        }).parseFromString(html, "text/html");

        // any: xpath and @xmldom/xmldom use compatible but distinct Node typings
        const result = xpathLib.select(config.target!, doc as unknown as Node);

        if (!Array.isArray(result) || result.length === 0) {
            throw new ParserError(
                `XPath ${JSON.stringify(config.target)} matched nothing on ${config.url}`
            );
        }

        const nodes = result as unknown as Array<{ textContent?: string | null; toString(): string }>;

        const content = collapseWhitespace(
            nodes
                .map((n) => n.textContent?.replace(/\s+/g, " ").trim() ?? "")
                .filter(Boolean)
                .join("\n")
        );

        const rawHtml = nodes.map((n) => n.toString()).join("\n");

        return makeSnapshot(config.url, config.target, content, rawHtml);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Detect XPath expressions - they start with "/" or "./" */
export function isXPath(selector: string): boolean {
    return selector.startsWith("/") || selector.startsWith("./");
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
