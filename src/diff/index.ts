/**
 * Diff Engine - compares two Snapshots and produces a human-readable DiffReport.
 *
 * Uses the `diff` npm package (Myers diff algorithm) to compute line-level
 * changes on cleaned text content - identical strategy to the Python port.
 */

import { diffLines } from "diff";
import type { Change, DiffReport, Snapshot, WatchConfig } from "../models.js";
import { reportHasChanges, snapshotsIdentical } from "../models.js";

export class DiffEngine {
    compare(
        before: Snapshot,
        after: Snapshot,
        config: WatchConfig
    ): DiffReport {
        const report: DiffReport = {
            url: config.url,
            target: config.target,
            label: config.label,
            before,
            after,
            changes: [],
            comparedAt: new Date(),
        };

        if (snapshotsIdentical(before, after)) {
            return report;
        }

        const hunks = diffLines(before.content, after.content, {
            ignoreWhitespace: false,
        });

        for (const hunk of hunks) {
            const value = hunk.value.trim();
            if (!value) continue;

            if (hunk.added) {
                // Lines present in `after` but not in `before`
                for (const line of hunk.value.split("\n").map((l) => l.trim()).filter(Boolean)) {
                    report.changes.push({ kind: "added", after: line });
                }
            } else if (hunk.removed) {
                // Lines present in `before` but not in `after`
                for (const line of hunk.value.split("\n").map((l) => l.trim()).filter(Boolean)) {
                    report.changes.push({ kind: "removed", before: line });
                }
            }
            // equal hunks → no change recorded
        }

        // Post-process: pair consecutive removed+added into "modified" when they
        // look like a value replacement (same surrounding context, short lines).
        report.changes = coalescePairs(report.changes);

        return report;
    }
}

/**
 * Coalesce adjacent removed+added pairs into a single "modified" change
 * when they appear to represent a value replacement rather than a true
 * insert+delete (heuristic: both lines are short enough to be a "value").
 */
function coalescePairs(changes: Change[]): Change[] {
    const result: Change[] = [];
    let i = 0;

    while (i < changes.length) {
        const cur   = changes[i];
        const next  = changes[i + 1];

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