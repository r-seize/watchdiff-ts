/**
 * Scheduler - drives the periodic check loop.
 *
 * Uses setInterval under the hood. Each WatchConfig gets its own timer
 * so independent intervals are fully supported.
 *
 * Full pipeline per check:
 *   Fetcher/BrowserFetcher - Cleaner - Parser - DiffEngine - Store - Notifier
 */

import { Cleaner } from "../cleaner/index.js";
import { DiffEngine } from "../diff/index.js";
import { FetchError, Fetcher } from "../fetcher/index.js";
import { BrowserFetcher } from "../fetcher/browser.js";
import {
    reportHasChanges,
    reportSummary,
    type DiffReport,
    type IStore,
    type WatchConfig,
} from "../models.js";
import { Notifier } from "../notifier/index.js";
import { ParserError, Parser } from "../parser/index.js";

export type GlobalCallback = (report: DiffReport) => void | Promise<void>;

export class Scheduler {
    private readonly fetcher                                    = new Fetcher();
    private readonly browserFetcher                            = new BrowserFetcher();
    private readonly parser                                     = new Parser();
    private readonly engine                                     = new DiffEngine();
    private readonly notifier                                   = new Notifier();
    private readonly globalCallbacks: GlobalCallback[]          = [];
    private readonly timers: ReturnType<typeof setInterval>[]   = [];
    // Tracks last alert timestamp (ms) per "url::target" key for cooldown enforcement
    private readonly lastAlertAt                                = new Map<string, number>();

    constructor(private readonly store: IStore) { }

    addGlobalCallback(cb: GlobalCallback): void {
        this.globalCallbacks.push(cb);
    }

    /**
     * Start monitoring all configs.
     *
     * Each config runs an immediate first check, then repeats every
     * `config.interval` seconds.
     *
     * Returns a `stop()` function.
     */
    start(configs: WatchConfig[]): () => void {
        for (const config of configs) {
            console.info(`[watchdiff] Starting watcher for ${config.label} (interval=${config.interval}s)`);

            // Run immediately, then on interval
            void this.check(config);
            const timer = setInterval(() => void this.check(config), config.interval * 1000);
            // Unref so the process can exit naturally if nothing else keeps it alive
            if (typeof timer === "object" && "unref" in timer) {
                (timer as NodeJS.Timeout).unref();
            }
            this.timers.push(timer);
        }

        return () => this.stop();
    }

    stop(): void {
        for (const timer of this.timers) {
            clearInterval(timer);
        }
        this.timers.length = 0;
        console.info("[watchdiff] All watchers stopped.");
    }

    /** Run a single check and return the DiffReport (or null on first run / error). */
    async checkOnce(config: WatchConfig): Promise<DiffReport | null> {
        return this.check(config);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    private async check(config: WatchConfig): Promise<DiffReport | null> {
        // 1. Fetch (static or browser-rendered)
        let html: string;
        try {
            html = config.browser
                ? await this.browserFetcher.fetch(config)
                : await this.fetcher.fetch(config);
        } catch (err) {
            console.error(`[${config.label}] Fetch failed:`, err instanceof Error ? err.message : err);
            return null;
        }

        // 2. Clean
        const cleaner = new Cleaner({
            extraSelectors: config.ignoreSelectors,
            extraPatterns:  config.ignorePatterns,
        });
        const $ = cleaner.clean(html);

        // 3. Parse (CSS or XPath)
        let snapshot;
        try {
            snapshot = this.parser.extract($, config);
        } catch (err) {
            console.error(`[${config.label}] Parse failed:`, err instanceof Error ? err.message : err);
            return null;
        }

        // 4. Compare
        const previous = this.store.loadLatest(config.url, config.target);

        if (previous === null) {
            this.store.saveSnapshot(snapshot);
            console.info(`[${config.label}] First snapshot captured.`);
            return null;
        }

        const report = this.engine.compare(previous, snapshot, config);
        this.store.saveSnapshot(snapshot);

        if (reportHasChanges(report)) {
            this.store.saveReport(report);
            console.info(`[${config.label}] ${reportSummary(report)}`);

            // Cooldown check - suppress alerts if minimum delay between two alerts has not elapsed
            const alertKey      = `${config.url}::${config.target ?? ""}`;
            const now           = Date.now();
            const lastAlert     = this.lastAlertAt.get(alertKey) ?? 0;
            const cooldownMs    = (config.cooldown ?? 0) * 1000;
            const cooldownReady = now - lastAlert >= cooldownMs;

            if (!cooldownReady) {
                const remaining = Math.ceil((cooldownMs - (now - lastAlert)) / 1000);
                console.debug(`[${config.label}] Alert suppressed - cooldown active (${remaining}s remaining).`);
            } else {
                this.lastAlertAt.set(alertKey, now);

                // Global callbacks
                for (const cb of this.globalCallbacks) {
                    try {
                        await cb(report);
                    } catch (err) {
                        console.warn("[watchdiff] Global callback error:", err);
                    }
                }

                // Per-config alert
                if (config.alert) {
                    await this.notifier.notify(report, config.alert);
                }
            }
        } else {
            console.debug(`[${config.label}] No changes.`);
        }

        return report;
    }
}
