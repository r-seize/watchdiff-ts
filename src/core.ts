/**
 * WatchDiff - high-level public facade.
 *
 * Usage:
 *   import { WatchDiff } from "watchdiff";
 *
 *   const wd = new WatchDiff();
 *   wd.watch("https://example.com/product", { target: ".price", interval: 60 });
 *   wd.onChange((report) => console.log(report));
 *   wd.start();
 */

import {
    makeWatchConfig,
    reportSummary,
    type AlertConfig,
    type DiffReport,
    type Snapshot,
    type WatchConfig,
} from "./models.js";
import { Scheduler } from "./scheduler/index.js";
import { Store } from "./store/index.js";

export interface WatchOptions {
    /** CSS selector - undefined = full page. */
    target?: string;
    /** Seconds between checks (default 300). */
    interval?: number;
    /** Human-readable label. */
    label?: string;
    /** Extra HTTP headers. */
    headers?: Record<string, string>;
    /** HTTP timeout in milliseconds (default 15000). */
    timeout?: number;
    /** CSS selectors to strip before diffing. */
    ignoreSelectors?: string[];
    /** Regex patterns to strip from text before diffing. */
    ignorePatterns?: RegExp[];
    /** Callback(s) invoked with a DiffReport on each change. */
    onChange?: ((report: DiffReport) => void | Promise<void>) | Array<(report: DiffReport) => void | Promise<void>>;
    /** Webhook URLs (Discord / Slack / custom). */
    webhooks?: string[];
    /** Minimum changes required to trigger an alert. */
    minChanges?: number;
}

export class WatchDiff {
    private readonly store: Store;
    private readonly configs: WatchConfig[] = [];
    private readonly globalCallbacks: Array<(report: DiffReport) => void | Promise<void>> = [];
    private scheduler: Scheduler | null = null;
    private stopFn: (() => void) | null = null;

    constructor(storageDir = ".watchdiff") {
        this.store = new Store(storageDir);
    }

    // ------------------------------------------------------------------
    // Configuration API
    // ------------------------------------------------------------------

    /**
     * Register a URL to monitor. Returns `this` for chaining.
     */
    watch(url: string, opts: WatchOptions = {}): this {
        const callbacks = opts.onChange
            ? Array.isArray(opts.onChange)
                ? opts.onChange
                : [opts.onChange]
            : [];

        const alert: AlertConfig | undefined =
            callbacks.length > 0 || (opts.webhooks?.length ?? 0) > 0
                ? {
                    onChange: callbacks,
                    webhooks: opts.webhooks ?? [],
                    minChanges: opts.minChanges ?? 1,
                }
                : undefined;

        this.configs.push(
            makeWatchConfig(url, {
                target: opts.target,
                interval: opts.interval,
                label: opts.label,
                headers: opts.headers,
                timeout: opts.timeout,
                ignoreSelectors: opts.ignoreSelectors,
                ignorePatterns: opts.ignorePatterns,
                alert,
            })
        );

        return this;
    }

    /**
     * Register a global callback fired whenever ANY watched URL changes.
     * Returns `this` for chaining.
     */
    onChange(callback: (report: DiffReport) => void | Promise<void>): this {
        this.globalCallbacks.push(callback);
        return this;
    }

    // ------------------------------------------------------------------
    // Run API
    // ------------------------------------------------------------------

    /**
     * Start continuous monitoring.
     *
     * Returns a `stop()` function. The process will keep running until
     * `stop()` is called or the process is killed.
     */
    start(): () => void {
        if (this.configs.length === 0) {
            console.warn("[watchdiff] No URLs registered. Call .watch() first.");
            return () => { };
        }

        this.scheduler = new Scheduler(this.store);
        for (const cb of this.globalCallbacks) {
            this.scheduler.addGlobalCallback(cb);
        }

        this.stopFn = this.scheduler.start(this.configs);
        return this.stopFn;
    }

    /**
     * Stop all watchers.
     */
    stop(): void {
        this.stopFn?.();
        this.stopFn = null;
    }

    /**
     * Run a single immediate check for a registered URL.
     *
     * @throws Error if the URL is not registered.
     */
    async checkOnce(url: string): Promise<DiffReport | null> {
        const config = this.findConfig(url);
        const sched = new Scheduler(this.store);
        return sched.checkOnce(config);
    }

    // ------------------------------------------------------------------
    // History / audit API
    // ------------------------------------------------------------------

    history(url: string, limit = 20): Snapshot[] {
        const config = this.findConfig(url);
        return this.store.loadHistory(config.url, config.target, limit);
    }

    reports(url: string, limit = 20): Record<string, unknown>[] {
        const config = this.findConfig(url);
        return this.store.loadReports(config.url, config.target, limit);
    }

    clear(url: string): void {
        const config = this.findConfig(url);
        this.store.clearHistory(config.url, config.target);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    private findConfig(url: string): WatchConfig {
        const config = this.configs.find((c) => c.url === url);
        if (!config) {
            throw new Error(`URL not registered: ${JSON.stringify(url)}. Call .watch() first.`);
        }
        return config;
    }
}