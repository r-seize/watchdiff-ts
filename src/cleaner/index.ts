/**
 * Cleaner - strips scripts, styles, ads and noise from raw HTML.
 * Uses cheerio (server-side jQuery-like API) for DOM manipulation.
 */

import * as cheerio from "cheerio";

const NOISE_TAGS = [
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "canvas",
    "video",
    "audio",
    "link",
    "meta",
    "head",
] as const;

const AD_PATTERNS = [
    "ad",
    "ads",
    "advertisement",
    "banner",
    "cookie",
    "gdpr",
    "popup",
    "overlay",
    "modal",
    "newsletter",
    "promo",
    "tracking",
    "analytics",
];

export interface CleanerOptions {
    /** Extra CSS selectors to remove. */
    extraSelectors?: string[];
    /** Extra regex patterns applied to the final text. */
    extraPatterns?: RegExp[];
}

export class Cleaner {
    private readonly extraSelectors: string[];
    private readonly extraPatterns: RegExp[];

    constructor(opts: CleanerOptions = {}) {
        this.extraSelectors     = opts.extraSelectors ?? [];
        this.extraPatterns      = opts.extraPatterns ?? [];
    }

    /**
     * Parse the HTML and strip all noisy elements.
     * Returns a cheerio root for further processing.
     */
    clean(html: string): cheerio.CheerioAPI {
        const $ = cheerio.load(html);

        // 1. Strip known noise tags
        $(NOISE_TAGS.join(",")).remove();

        // 2. Strip ad/tracking containers
        $("*").each((_, el) => {
            if (el.type !== "tag") return;
            const classes       = ($(el).attr("class") ?? "").toLowerCase();
            const id            = ($(el).attr("id") ?? "").toLowerCase();
            const combined      = `${classes} ${id}`;
            if (AD_PATTERNS.some((p) => combined.includes(p))) {
                $(el).remove();
            }
        });

        // 3. User-specified selectors
        for (const selector of this.extraSelectors) {
            $(selector).remove();
        }

        return $;
    }

    /** Clean the HTML and return normalised plain text. */
    cleanToText(html: string): string {
        const $     = this.clean(html);
        const raw   = $("body").text() || $.root().text();
        return this.normaliseText(raw);
    }

    /** Clean the HTML and return simplified HTML string. */
    cleanToHtml(html: string): string {
        const $ = this.clean(html);
        return $.html();
    }

    private normaliseText(text: string): string {
        // Collapse horizontal whitespace
        let t = text.replace(/[ \t]+/g, " ");
        // Collapse blank lines
        t = t.replace(/\n{3,}/g, "\n\n");
        // Strip leading/trailing space per line, remove empty lines
        const lines = t
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
        t = lines.join("\n");

        // Apply user-defined patterns
        for (const pat of this.extraPatterns) {
            t = t.replace(pat, "");
        }

        return t.trim();
    }
}