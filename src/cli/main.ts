import { program } from "commander";
import chalk from "chalk";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { WatchDiff } from "../index.js";
import { changeHuman, reportSummary } from "../models.js";
import type { WatchOptions } from "../core.js";

program
    .name("watchdiff")
    .description("Lightweight web change monitoring - clean diffs, no AI required.")
    .version("0.1.1");

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

program
    .command("run [url]")
    .description("Start continuous monitoring (Ctrl+C to stop). Pass a URL or --config file.")
    .option("-t, --target <selector>",    "CSS selector or XPath expression to watch")
    .option("-i, --interval <seconds>",   "Seconds between checks", "300")
    .option("-w, --webhook <url>",        "Webhook URL to POST on change")
    .option("-s, --storage <dir>",        "Storage directory", ".watchdiff")
    .option("-c, --config <file>",        "JSON config file (watchdiff.config.json)")
    .option("--browser",                  "Use headless Playwright browser for JS-heavy pages")
    .option("--proxy <url>",              "Proxy URL (e.g. http://user:pass@host:port)")
    .option("--user-agent <ua>",          "Custom User-Agent string")
    .option("--diff-mode <mode>",         "Diff mode: 'line' (default) or 'semantic'")
    .action((url: string | undefined, opts: Record<string, string | boolean | undefined>) => {
        const storage = (opts["storage"] as string | undefined) ?? ".watchdiff";
        const wd      = new WatchDiff(storage);

        // Config-file mode
        if (opts["config"]) {
            const cfg = loadConfig(opts["config"] as string);
            applyConfig(wd, cfg);
        } else if (url) {
            wd.watch(url, buildWatchOptions(opts));
        } else {
            // Auto-discover watchdiff.config.json in cwd
            const defaultCfg = "watchdiff.config.json";
            if (existsSync(defaultCfg)) {
                console.log(chalk.gray(`Using ${defaultCfg}`));
                applyConfig(wd, loadConfig(defaultCfg));
            } else {
                console.error(chalk.red("Provide a URL or --config file (or run watchdiff init)."));
                process.exit(1);
            }
        }

        wd.onChange((report) => {
            console.log(chalk.yellow(`\n${reportSummary(report)}`));
            for (const change of report.changes) {
                const line = "  " + changeHuman(change);
                if (change.kind === "added")        console.log(chalk.green(line));
                else if (change.kind === "removed")  console.log(chalk.red(line));
                else                                 console.log(chalk.yellow(line));
            }
        });

        const stop = wd.start();

        process.on("SIGINT", () => {
            console.log(chalk.gray("\nStopping..."));
            stop();
            process.exit(0);
        });
    });

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

program
    .command("check <url>")
    .description("Run a single check and print the result")
    .option("-t, --target <selector>",   "CSS selector or XPath expression to watch")
    .option("-s, --storage <dir>",       "Storage directory", ".watchdiff")
    .option("--browser",                 "Use headless Playwright browser")
    .option("--diff-mode <mode>",        "Diff mode: 'line' or 'semantic'")
    .option("--json",                    "Output raw JSON")
    .action(async (url: string, opts: Record<string, string | boolean | undefined>) => {
        const wd = new WatchDiff((opts["storage"] as string | undefined) ?? ".watchdiff");
        wd.watch(url, buildWatchOptions(opts));

        const report = await wd.checkOnce(url);

        if (!report) {
            console.log(chalk.blue("First snapshot captured."));
            return;
        }

        if (opts["json"]) {
            console.log(JSON.stringify(report, null, 2));
            return;
        }

        console.log(reportSummary(report));
        for (const change of report.changes) {
            const line = "  " + changeHuman(change);
            if (change.kind === "added")        console.log(chalk.green(line));
            else if (change.kind === "removed")  console.log(chalk.red(line));
            else                                 console.log(chalk.yellow(line));
        }
    });

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------

program
    .command("history <url>")
    .description("Show snapshot history for a URL")
    .option("-t, --target <selector>", "CSS selector")
    .option("-n, --limit <number>",    "Number of entries to show", "10")
    .option("-s, --storage <dir>",     "Storage directory", ".watchdiff")
    .action((url: string, opts: Record<string, string | undefined>) => {
        const wd = new WatchDiff(opts["storage"] ?? ".watchdiff");
        wd.watch(url, { target: opts["target"] });

        const snapshots = wd.history(url, parseInt(opts["limit"] ?? "10", 10));

        if (snapshots.length === 0) {
            console.log(chalk.gray("No history found."));
            return;
        }

        console.log(chalk.bold(`\nSnapshot history for ${url}\n`));
        for (const snap of snapshots) {
            const date     = snap.capturedAt.toISOString().replace("T", " ").slice(0, 19);
            const checksum = snap.checksum.slice(0, 8);
            const preview  = snap.content.slice(0, 60).replace(/\n/g, " ");
            console.log(`  ${chalk.gray(date)}  ${chalk.cyan(checksum)}  ${preview}`);
        }
    });

// ---------------------------------------------------------------------------
// reports
// ---------------------------------------------------------------------------

program
    .command("reports <url>")
    .description("Show diff reports for a URL")
    .option("-t, --target <selector>", "CSS selector")
    .option("-n, --limit <number>",    "Number of reports to show", "10")
    .option("-s, --storage <dir>",     "Storage directory", ".watchdiff")
    .action((url: string, opts: Record<string, string | undefined>) => {
        const wd = new WatchDiff(opts["storage"] ?? ".watchdiff");
        wd.watch(url, { target: opts["target"] });

        const reps = wd.reports(url, parseInt(opts["limit"] ?? "10", 10));

        if (reps.length === 0) {
            console.log(chalk.gray("No reports found."));
            return;
        }

        console.log(chalk.bold(`\nReports for ${url}\n`));
        for (const rep of reps) {
            const changes = rep["changes"] as Array<{ kind: string; before?: string; after?: string }>;
            const date    = String(rep["comparedAt"]).slice(0, 19).replace("T", " ");
            console.log(`  ${chalk.gray(date)}  ${changes.length} change(s)`);
            for (const c of changes) {
                if (c.kind === "added")        console.log(chalk.green(`    [+] ${c.after ?? ""}`));
                else if (c.kind === "removed")  console.log(chalk.red(`    [-] ${c.before ?? ""}`));
                else                            console.log(chalk.yellow(`    [~] ${c.before ?? ""} -> ${c.after ?? ""}`));
            }
        }
    });

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

program
    .command("clear <url>")
    .description("Delete all stored data for a URL")
    .option("-t, --target <selector>", "CSS selector")
    .option("-s, --storage <dir>",     "Storage directory", ".watchdiff")
    .option("-y, --yes",               "Skip confirmation prompt")
    .action(async (url: string, opts: Record<string, string | boolean | undefined>) => {
        if (!opts["yes"]) {
            const readline = await import("node:readline");
            const rl       = readline.createInterface({ input: process.stdin, output: process.stdout });
            const answer   = await new Promise<string>((resolve) => {
                rl.question(chalk.yellow(`Delete all data for ${url}? [y/N] `), resolve);
            });
            rl.close();
            if (answer.toLowerCase() !== "y") {
                console.log("Aborted.");
                return;
            }
        }

        const wd = new WatchDiff((opts["storage"] as string | undefined) ?? ".watchdiff");
        wd.watch(url, { target: opts["target"] as string | undefined });
        wd.clear(url);
        console.log(chalk.green(`Cleared all data for ${url}.`));
    });

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

program
    .command("export <url>")
    .description("Export history or reports to CSV or XLSX")
    .option("-t, --target <selector>",  "CSS selector")
    .option("-s, --storage <dir>",      "Storage directory", ".watchdiff")
    .option("-f, --format <fmt>",       "Output format: csv (default) or xlsx", "csv")
    .option("--type <type>",            "What to export: reports (default) or snapshots", "reports")
    .option("-n, --limit <number>",     "Number of entries to export", "100")
    .option("-o, --output <file>",      "Output file path (prints to stdout if omitted)")
    .action(async (url: string, opts: Record<string, string | undefined>) => {
        const storage = opts["storage"] ?? ".watchdiff";
        const format  = opts["format"]  ?? "csv";
        const type    = opts["type"]    ?? "reports";
        const limit   = parseInt(opts["limit"] ?? "100", 10);
        const output  = opts["output"];

        const wd = new WatchDiff(storage);
        wd.watch(url, { target: opts["target"] });

        if (format === "csv") {
            const csv = type === "snapshots"
                ? wd.exportSnapshotsCsv(url, limit)
                : wd.exportReportsCsv(url, limit);

            if (output) {
                writeFileSync(output, csv, "utf-8");
                console.log(chalk.green(`Exported to ${output}`));
            } else {
                process.stdout.write(csv + "\n");
            }
        } else if (format === "xlsx") {
            if (!output) {
                console.error(chalk.red("--output <file.xlsx> is required for xlsx format."));
                process.exit(1);
            }
            try {
                const buf = type === "snapshots"
                    ? await wd.exportSnapshotsXlsx(url, limit)
                    : await wd.exportReportsXlsx(url, limit);
                writeFileSync(output, buf);
                console.log(chalk.green(`Exported to ${output}`));
            } catch (err) {
                console.error(chalk.red(err instanceof Error ? err.message : String(err)));
                process.exit(1);
            }
        } else {
            console.error(chalk.red(`Unknown format: ${format}. Use 'csv' or 'xlsx'.`));
            process.exit(1);
        }
    });

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

program
    .command("init")
    .description("Generate a watchdiff.config.json template in the current directory")
    .option("-f, --force", "Overwrite existing config file")
    .action((opts: { force?: boolean }) => {
        const dest = "watchdiff.config.json";

        if (existsSync(dest) && !opts.force) {
            console.error(chalk.red(`${dest} already exists. Use --force to overwrite.`));
            process.exit(1);
        }

        const template = {
            storage: ".watchdiff",
            watches: [
                {
                    url:              "https://example.com",
                    target:           ".price",
                    interval:         300,
                    label:            "Example - Product Price",
                    browser:          false,
                    diffMode:         "line",
                    webhooks:         [] as string[],
                    ignoreSelectors:  [] as string[],
                    proxies:          [] as string[],
                    userAgents:       [] as string[],
                },
            ],
        };

        writeFileSync(dest, JSON.stringify(template, null, 2) + "\n", "utf-8");
        console.log(chalk.green(`Created ${dest}`));
        console.log(chalk.gray("\nEdit the file, then run:"));
        console.log(chalk.bold(`  watchdiff run --config ${dest}`));
        console.log(chalk.gray("  or just: watchdiff run    (auto-discovers watchdiff.config.json)"));
    });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ConfigFile {
    storage?: string;
    watches: Array<{
        url:             string;
        target?:         string;
        interval?:       number;
        label?:          string;
        browser?:        boolean;
        diffMode?:       string;
        webhooks?:       string[];
        ignoreSelectors?: string[];
        proxies?:        string[];
        userAgents?:     string[];
        headers?:        Record<string, string>;
        timeout?:        number;
        minChanges?:     number;
    }>;
}

function loadConfig(path: string): ConfigFile {
    if (!existsSync(path)) {
        console.error(chalk.red(`Config file not found: ${path}`));
        process.exit(1);
    }
    try {
        return JSON.parse(readFileSync(path, "utf-8")) as ConfigFile;
    } catch (err) {
        console.error(chalk.red(`Invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    }
}

function applyConfig(wd: WatchDiff, cfg: ConfigFile): void {
    for (const w of cfg.watches) {
        wd.watch(w.url, {
            target:           w.target,
            interval:         w.interval,
            label:            w.label,
            browser:          w.browser,
            diffMode:         w.diffMode as WatchOptions["diffMode"],
            webhooks:         w.webhooks,
            ignoreSelectors:  w.ignoreSelectors,
            proxies:          w.proxies,
            userAgents:       w.userAgents,
            headers:          w.headers,
            timeout:          w.timeout,
            minChanges:       w.minChanges,
        });
    }
}

function buildWatchOptions(opts: Record<string, string | boolean | undefined>): WatchOptions {
    const result: WatchOptions = {};
    if (opts["target"])     result.target    = opts["target"] as string;
    if (opts["interval"])   result.interval  = parseInt(opts["interval"] as string, 10);
    if (opts["webhook"])    result.webhooks  = [opts["webhook"] as string];
    if (opts["browser"])    result.browser   = true;
    if (opts["proxy"])      result.proxies   = [opts["proxy"] as string];
    if (opts["userAgent"])  result.userAgents = [opts["userAgent"] as string];
    if (opts["diffMode"])   result.diffMode  = opts["diffMode"] as WatchOptions["diffMode"];
    return result;
}

program.parse();
