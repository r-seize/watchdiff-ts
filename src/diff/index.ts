/**
 * Diff Engine - compares two Snapshots and produces a human-readable DiffReport.
 *
 * Two modes:
 *   "line"     - Myers line diff on plain text (default)
 *   "semantic" - Myers array diff on semantic blocks (p, h1-h6, li, td, th)
 *                extracted from rawHtml - gives paragraph-level granularity
 */

import * as cheerio from "cheerio";
import { diffLines, diffArrays } from "diff";
import type { Change, DiffReport, Snapshot, WatchConfig } from "../models.js";
import { reportHasChanges, snapshotsIdentical } from "../models.js";

const SEMANTIC_SELECTORS = "p, h1, h2, h3, h4, h5, h6, td, th, li, blockquote";

export class DiffEngine {
    compare(
        before: Snapshot,
        after: Snapshot,
        config: WatchConfig
    ): DiffReport {
        const report: DiffReport = {
            url:        config.url,
            target:     config.target,
            label:      config.label,
            before,
            after,
            changes:    [],
            comparedAt: new Date(),
        };

        if (snapshotsIdentical(before, after)) {
            return report;
        }

        if (config.diffMode === "semantic") {
            return this.compareSemanticBlocks(before, after, report);
        }

        return this.compareLines(before, after, report);
    }

    // ------------------------------------------------------------------
    // Line diff (default)
    // ------------------------------------------------------------------

    private compareLines(before: Snapshot, after: Snapshot, report: DiffReport): DiffReport {
        const hunks = diffLines(before.content, after.content, {
            ignoreWhitespace: false,
        });

        for (const hunk of hunks) {
            const value = hunk.value.trim();
            if (!value) continue;

            if (hunk.added) {
                for (const line of hunk.value.split("\n").map((l) => l.trim()).filter(Boolean)) {
                    report.changes.push({ kind: "added", after: line });
                }
            } else if (hunk.removed) {
                for (const line of hunk.value.split("\n").map((l) => l.trim()).filter(Boolean)) {
                    report.changes.push({ kind: "removed", before: line });
                }
            }
        }

        report.changes = coalescePairs(report.changes);
        return report;
    }

    // ------------------------------------------------------------------
    // Semantic block diff
    // ------------------------------------------------------------------

    private compareSemanticBlocks(before: Snapshot, after: Snapshot, report: DiffReport): DiffReport {
        const beforeBlocks = extractSemanticBlocks(before.rawHtml) ??
            before.content.split("\n").filter(Boolean);
        const afterBlocks  = extractSemanticBlocks(after.rawHtml) ??
            after.content.split("\n").filter(Boolean);

        const hunks = diffArrays(beforeBlocks, afterBlocks);

        for (const hunk of hunks) {
            if (hunk.added) {
                for (const block of hunk.value) {
                    report.changes.push({ kind: "added", after: block });
                }
            } else if (hunk.removed) {
                for (const block of hunk.value) {
                    report.changes.push({ kind: "removed", before: block });
                }
            }
        }

        report.changes = coalescePairs(report.changes);
        return report;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract semantic text blocks from HTML using cheerio.
 * Skips elements that are descendants of other semantic elements to avoid
 * double-counting (e.g. a <p> inside a <li> is deduplicated).
 * Falls back to null when no blocks are found.
 */
function extractSemanticBlocks(html: string): string[] | null {
    if (!html.trim()) return null;

    const $      = cheerio.load(html);
    const blocks: string[] = [];

    $(SEMANTIC_SELECTORS).each((_, el) => {
        if ($(el).parents(SEMANTIC_SELECTORS).length > 0) return;
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (text) blocks.push(text);
    });

    return blocks.length > 0 ? blocks : null;
}

/**
 * Coalesce adjacent removed+added pairs into a single "modified" change
 * when they appear to represent a value replacement rather than a true
 * insert+delete (heuristic: both sides are short enough to be a "value").
 */
function coalescePairs(changes: Change[]): Change[] {
    const result: Change[] = [];
    let i = 0;

    while (i < changes.length) {
        const cur  = changes[i];
        const next = changes[i + 1];

        if (
            cur !== undefined &&
            next !== undefined &&
            cur.kind === "removed" &&
            next.kind === "added" &&
            (cur.before?.length ?? 0) < 200 &&
            (next.after?.length ?? 0) < 200
        ) {
            result.push({ kind: "modified", before: cur.before, after: next.after });
            i += 2;
        } else {
            if (cur !== undefined) result.push(cur);
            i += 1;
        }
    }

    return result;
}
