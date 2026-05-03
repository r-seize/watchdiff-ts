/**
 * WatchDiff TypeScript - unit tests (vitest)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Cleaner } from "./cleaner/index.js";
import { Parser, ParserError } from "./parser/index.js";
import { DiffEngine } from "./diff/index.js";
import { Store } from "./store/index.js";
import {
    makeSnapshot,
    makeWatchConfig,
    reportHasChanges,
    reportSummary,
} from "./models.js";

// ---------------------------------------------------------------------------
// Cleaner
// ---------------------------------------------------------------------------

describe("Cleaner", () => {
    const cleaner = new Cleaner();

    it("strips script tags", () => {
        const html = "<html><body><script>alert(1)</script><p>Hello</p></body></html>";
        const text = cleaner.cleanToText(html);
        expect(text).not.toContain("alert");
        expect(text).toContain("Hello");
    });

    it("strips style tags", () => {
        const html = "<html><body><style>body{color:red}</style><p>World</p></body></html>";
        const text = cleaner.cleanToText(html);
        expect(text).not.toContain("color");
        expect(text).toContain("World");
    });

    it("strips extra CSS selectors", () => {
        const html = '<html><body><div class="ads">Buy now!</div><p>Content</p></body></html>';
        const text = new Cleaner({ extraSelectors: [".ads"] }).cleanToText(html);
        expect(text).not.toContain("Buy now");
        expect(text).toContain("Content");
    });

    it("normalises whitespace", () => {
        const html = "<html><body><p>Hello   World</p></body></html>";
        const text = cleaner.cleanToText(html);
        expect(text).not.toMatch(/  /);
    });
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("Parser", () => {
    const parser    = new Parser();
    const cleaner   = new Cleaner();

    it("extracts full page when no target", () => {
        const html      = "<html><body><p>Hello World</p></body></html>";
        const $         = cleaner.clean(html);
        const snap      = parser.extract($, makeWatchConfig("https://example.com"));
        expect(snap.content).toContain("Hello World");
    });

    it("extracts targeted selector", () => {
        const html      = '<html><body><span class="price">19€</span><p>Other</p></body></html>';
        const $         = cleaner.clean(html);
        const snap      = parser.extract($, makeWatchConfig("https://example.com", { target: ".price" }));
        expect(snap.content).toContain("19€");
        expect(snap.content).not.toContain("Other");
    });

    it("throws ParserError for missing selector", () => {
        const html      = "<html><body><p>Hello</p></body></html>";
        const $         = cleaner.clean(html);
        expect(() =>
            parser.extract($, makeWatchConfig("https://example.com", { target: ".missing" }))
        ).toThrow(ParserError);
    });
});

// ---------------------------------------------------------------------------
// DiffEngine
// ---------------------------------------------------------------------------

describe("DiffEngine", () => {
    const engine = new DiffEngine();
    const config = makeWatchConfig("https://example.com", { label: "test" });

    it("returns no changes when content is identical", () => {
        const snap      = makeSnapshot("https://example.com", undefined, "Hello World", "");
        const report    = engine.compare(snap, snap, config);
        expect(reportHasChanges(report)).toBe(false);
    });

    it("detects added lines", () => {
        const before    = makeSnapshot("https://example.com", undefined, "Hello", "");
        const after     = makeSnapshot("https://example.com", undefined, "Hello\nNew line here", "");
        const report    = engine.compare(before, after, config);
        expect(reportHasChanges(report)).toBe(true);
        expect(report.changes.some((c) => c.kind === "added")).toBe(true);
    });

    it("detects removed lines", () => {
        const before    = makeSnapshot("https://example.com", undefined, "Hello\nGoodbye", "");
        const after     = makeSnapshot("https://example.com", undefined, "Hello", "");
        const report    = engine.compare(before, after, config);
        expect(report.changes.some((c) => c.kind === "removed")).toBe(true);
    });

    it("detects modifications", () => {
        const before    = makeSnapshot("https://example.com", undefined, "Price: 19€", "");
        const after     = makeSnapshot("https://example.com", undefined, "Price: 24€", "");
        const report    = engine.compare(before, after, config);
        expect(reportHasChanges(report)).toBe(true);
        const mod = report.changes.filter((c) => c.kind === "modified");
        expect(mod.length).toBeGreaterThan(0);
        expect(mod[0]?.before).toContain("19€");
        expect(mod[0]?.after).toContain("24€");
    });

    it("summary says no changes when identical", () => {
        const snap = makeSnapshot("https://example.com", undefined, "Same", "");
        const report = engine.compare(snap, snap, config);
        expect(reportSummary(report)).toContain("No changes");
    });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

describe("Store", () => {
    let tmpDir: string;
    let store: Store;

    beforeEach(() => {
        tmpDir  = mkdtempSync(join(tmpdir(), "watchdiff-test-"));
        store   = new Store(tmpDir);
    });

    it("saves and loads latest snapshot", () => {
        const snap = makeSnapshot("https://example.com", undefined, "v1", "");
        store.saveSnapshot(snap);
        const loaded = store.loadLatest("https://example.com", undefined);
        expect(loaded).not.toBeNull();
        expect(loaded!.content).toBe("v1");
    });

    it("returns null when no snapshots exist", () => {
        expect(store.loadLatest("https://unknown.com", undefined)).toBeNull();
    });

    it("respects history limit", () => {
        for (let i = 0; i < 5; i++) {
            store.saveSnapshot(makeSnapshot("https://example.com", undefined, `v${i}`, ""));
        }
        const history = store.loadHistory("https://example.com", undefined, 3);
        expect(history).toHaveLength(3);
    });

    it("clears history", () => {
        store.saveSnapshot(makeSnapshot("https://example.com", undefined, "v1", ""));
        store.clearHistory("https://example.com", undefined);
        expect(store.loadLatest("https://example.com", undefined)).toBeNull();
    });

    it("saves and loads reports", () => {
        const before    = makeSnapshot("https://example.com", undefined, "A", "");
        const after     = makeSnapshot("https://example.com", undefined, "B", "");
        const config    = makeWatchConfig("https://example.com", { label: "test" });
        const engine    = new DiffEngine();
        const report    = engine.compare(before, after, config);
        store.saveReport(report);
        const reports = store.loadReports("https://example.com", undefined);
        expect(reports).toHaveLength(1);
    });
});