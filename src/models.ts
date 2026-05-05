/**
 * WatchDiff models - shared types used across all modules.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type ChangeType = "added" | "removed" | "modified" | "unchanged";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type DiffMode = "line" | "semantic";

export interface BrowserOptions {
    /** Navigation event to wait for before extracting content (default: "domcontentloaded"). */
    waitFor?: "load" | "domcontentloaded" | "networkidle";
    /** Additional CSS selector to wait for after navigation. */
    waitForSelector?: string;
    /** Browser executable path override. */
    executablePath?: string;
}

export interface AlertConfig {
    /** Callbacks invoked with a DiffReport on each change. */
    onChange: Array<(report: DiffReport) => void | Promise<void>>;
    /** Webhook URLs - Discord, Slack, or custom HTTP endpoints. */
    webhooks: string[];
    /** Minimum number of changes required to trigger an alert. */
    minChanges: number;
}

export interface WatchConfig {
    url: string;
    /** CSS selector or XPath expression to narrow monitoring. undefined = full page. */
    target?: string;
    /** Seconds between checks (default 300). */
    interval: number;
    /** Human-readable label shown in logs and reports. */
    label: string;
    /** Extra HTTP headers for this URL. */
    headers: Record<string, string>;
    /** HTTP timeout in milliseconds (default 15000). */
    timeout: number;
    /** CSS selectors to strip before diffing. */
    ignoreSelectors: string[];
    /** Regex patterns to strip from text before diffing. */
    ignorePatterns: RegExp[];
    /** Use a headless browser (Playwright) to render JS-heavy pages. */
    browser?: boolean;
    /** Options passed to the headless browser. */
    browserOptions?: BrowserOptions;
    /** List of proxy URLs to rotate through (e.g. "http://user:pass@host:port"). */
    proxies?: string[];
    /** List of User-Agent strings to rotate through on each request. */
    userAgents?: string[];
    /** "line" = line-by-line diff (default), "semantic" = diff by semantic blocks. */
    diffMode?: DiffMode;
    alert?: AlertConfig;
}

export function makeWatchConfig(
    url: string,
    opts: Partial<Omit<WatchConfig, "url">> = {}
): WatchConfig {
    return {
        url,
        target:           opts.target,
        interval:         opts.interval ?? 300,
        label:            opts.label ?? url,
        headers:          opts.headers ?? {},
        timeout:          opts.timeout ?? 15_000,
        ignoreSelectors:  opts.ignoreSelectors ?? [],
        ignorePatterns:   opts.ignorePatterns ?? [],
        browser:          opts.browser,
        browserOptions:   opts.browserOptions,
        proxies:          opts.proxies,
        userAgents:       opts.userAgents,
        diffMode:         opts.diffMode,
        alert:            opts.alert,
    };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface Snapshot {
    url: string;
    target: string | undefined;
    /** Cleaned, normalised plain-text content. */
    content: string;
    /** Raw HTML of the extracted zone (before text conversion). */
    rawHtml: string;
    capturedAt: Date;
    checksum: string;
}

export function makeSnapshot(
    url: string,
    target: string | undefined,
    content: string,
    rawHtml: string
): Snapshot {
    const checksum = createHash("sha256").update(content).digest("hex");
    return { url, target, content, rawHtml, capturedAt: new Date(), checksum };
}

export function snapshotsIdentical(a: Snapshot, b: Snapshot): boolean {
    return a.checksum === b.checksum;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export interface Change {
    kind: ChangeType;
    before?: string;
    after?: string;
    /** Surrounding text hint for context. */
    context?: string;
}

export function changeHuman(change: Change): string {
    switch (change.kind) {
        case "added":
            return `[+] Added: ${JSON.stringify(change.after)}`;
        case "removed":
            return `[-] Removed: ${JSON.stringify(change.before)}`;
        case "modified":
            return `[~] Changed: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`;
        default:
            return "[=] Unchanged";
    }
}

export interface DiffReport {
    url: string;
    target: string | undefined;
    label: string;
    before: Snapshot;
    after: Snapshot;
    changes: Change[];
    comparedAt: Date;
}

export function reportHasChanges(report: DiffReport): boolean {
    return report.changes.length > 0;
}

export function reportSummary(report: DiffReport): string {
    if (!reportHasChanges(report)) {
        return `[${report.label}] No changes detected.`;
    }
    const added             = report.changes.filter((c) => c.kind === "added").length;
    const removed           = report.changes.filter((c) => c.kind === "removed").length;
    const modified          = report.changes.filter((c) => c.kind === "modified").length;
    const parts: string[]   = [];
    if (added) parts.push(`${added} added`);
    if (removed) parts.push(`${removed} removed`);
    if (modified) parts.push(`${modified} modified`);
    const ts = report.comparedAt.toISOString().replace("T", " ").slice(0, 19);
    return `[${report.label}] ${parts.join(", ")} - ${ts} UTC`;
}

export function reportAsDict(report: DiffReport): Record<string, unknown> {
    return {
        url: report.url,
        target: report.target,
        label: report.label,
        comparedAt: report.comparedAt.toISOString(),
        changes: report.changes.map((c) => ({
            kind: c.kind,
            before: c.before,
            after: c.after,
            context: c.context,
        })),
    };
}

// ---------------------------------------------------------------------------
// Store contract
// ---------------------------------------------------------------------------

/** Common interface implemented by both Store (JSON) and SqliteStore. */
export interface IStore {
    saveSnapshot(snapshot: Snapshot): void;
    loadLatest(url: string, target: string | undefined): Snapshot | null;
    loadHistory(url: string, target: string | undefined, limit?: number): Snapshot[];
    clearHistory(url: string, target: string | undefined): void;
    saveReport(report: DiffReport): void;
    loadReports(url: string, target: string | undefined, limit?: number): Record<string, unknown>[];
}