import { program } from "commander";
import chalk from "chalk";
import { WatchDiff } from "../index.js";
import { changeHuman, reportSummary } from "../models.js";

program
    .name("watchdiff")
    .description("Lightweight web change monitoring - clean diffs, no AI required.")
    .version("0.1.0");

program
    .command("run <url>")
    .description("Start continuous monitoring (Ctrl+C to stop)")
    .option("-t, --target <selector>", "CSS selector to watch")
    .option("-i, --interval <seconds>", "Seconds between checks", "300")
    .option("-w, --webhook <url>", "Webhook URL to POST on change")
    .option("-s, --storage <dir>", "Storage directory", ".watchdiff")
    .action((url: string, opts: Record<string, string | undefined>) => {
        const wd = new WatchDiff(opts["storage"] ?? ".watchdiff");

        console.log(chalk.bold("\nWatchDiff - Continuous Monitoring"));
        console.log(`  URL:      ${url}`);
        if (opts["target"]) console.log(`  Target:   ${opts["target"]}`);
        console.log(`  Interval: ${opts["interval"] ?? "300"}s`);
        console.log(chalk.gray("  Press Ctrl+C to stop.\n"));

        wd.watch(url, {
            target: opts["target"],
            interval: parseInt(opts["interval"] ?? "300", 10),
            webhooks: opts["webhook"] ? [opts["webhook"]] : [],
        });

        wd.onChange((report) => {
            console.log(chalk.yellow(`\n${reportSummary(report)}`));
            for (const change of report.changes) {
                const line = "  " + changeHuman(change);
                if (change.kind === "added") console.log(chalk.green(line));
                else if (change.kind === "removed") console.log(chalk.red(line));
                else console.log(chalk.yellow(line));
            }
        });

        const stop = wd.start();

        process.on("SIGINT", () => {
            console.log(chalk.gray("\nStopping…"));
            stop();
            process.exit(0);
        });
    });

program
    .command("check <url>")
    .description("Run a single check and print the result")
    .option("-t, --target <selector>", "CSS selector to watch")
    .option("-s, --storage <dir>", "Storage directory", ".watchdiff")
    .option("--json", "Output raw JSON")
    .action(async (url: string, opts: Record<string, string | boolean | undefined>) => {
        const wd = new WatchDiff((opts["storage"] as string | undefined) ?? ".watchdiff");
        wd.watch(url, { target: opts["target"] as string | undefined });

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
            if (change.kind === "added") console.log(chalk.green(line));
            else if (change.kind === "removed") console.log(chalk.red(line));
            else console.log(chalk.yellow(line));
        }
    });

program
    .command("history <url>")
    .description("Show snapshot history for a URL")
    .option("-t, --target <selector>", "CSS selector")
    .option("-n, --limit <number>", "Number of entries to show", "10")
    .option("-s, --storage <dir>", "Storage directory", ".watchdiff")
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
            const date = snap.capturedAt.toISOString().replace("T", " ").slice(0, 19);
            const checksum = snap.checksum.slice(0, 8);
            const preview = snap.content.slice(0, 60).replace(/\n/g, " ");
            console.log(`  ${chalk.gray(date)}  ${chalk.cyan(checksum)}  ${preview}`);
        }
    });

program
    .command("reports <url>")
    .description("Show diff reports for a URL")
    .option("-t, --target <selector>", "CSS selector")
    .option("-n, --limit <number>", "Number of reports to show", "10")
    .option("-s, --storage <dir>", "Storage directory", ".watchdiff")
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
            const date = String(rep["comparedAt"]).slice(0, 19).replace("T", " ");
            console.log(`  ${chalk.gray(date)}  ${changes.length} change(s)`);
            for (const c of changes) {
                if (c.kind === "added") console.log(chalk.green(`    [+] ${c.after ?? ""}`));
                else if (c.kind === "removed") console.log(chalk.red(`    [-] ${c.before ?? ""}`));
                else console.log(chalk.yellow(`    [~] ${c.before ?? ""} → ${c.after ?? ""}`));
            }
        }
    });

program
    .command("clear <url>")
    .description("Delete all stored data for a URL")
    .option("-t, --target <selector>", "CSS selector")
    .option("-s, --storage <dir>", "Storage directory", ".watchdiff")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (url: string, opts: Record<string, string | boolean | undefined>) => {
        if (!opts["yes"]) {
            const readline = await import("node:readline");
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const answer = await new Promise<string>((resolve) => {
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

program.parse();
