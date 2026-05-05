# watchdiff-core

**Lightweight web change monitoring - clean diffs, structured alerts, no AI required.**

WatchDiff watches web pages and tells you exactly what changed, in plain language.
No noisy HTML diffs. No external services. No AI black boxes.

- **Deterministic** - same input always produces the same output
- **Human-readable diffs** - "Price changed: $19 -> $24", not a wall of HTML
- **CSS selectors AND XPath** - target any zone of any page
- **JS-heavy pages** - optional Playwright headless browser rendering
- **Proxy and User-Agent rotation** - avoid rate-limiting
- **Semantic diff** - paragraph-level granularity, not just line-by-line
- **SQLite backend** - optional, for high-volume workloads
- **CSV / XLSX export** - full history export in one command
- **Zero external services** - snapshots stored locally as JSON or SQLite
- **Alert cooldown** - minimum delay between two alerts per URL to prevent notification spam
- **Fully typed** - complete TypeScript types included
- **Native fetch** - no HTTP library dependency, runs on Node.js 18+


## At a glance

| What you want | How |
|---|---|
| Monitor a URL for changes | `.watch(url, { interval, target })` + `.start()` |
| Target a specific element | `target: ".price"` (CSS) or `target: "//span[@class='p']"` (XPath) |
| Get notified on change | `onChange: (report) => ...` or `webhooks: ["https://discord.com/..."]` |
| Render JS-heavy pages | `browser: true` (requires playwright) |
| Avoid notification spam | `cooldown: 3600` (min seconds between alerts) |
| Rotate proxies / UAs | `proxies: [...]`, `userAgents: [...]` |
| Diff at paragraph level | `diffMode: "semantic"` |
| Persist to SQLite | `new WatchDiff(undefined, new SqliteStore(".db"))` |
| Export history | `.exportReportsCsv(url)` / `.exportReportsXlsx(url)` |
| CLI one-liner | `watchdiff run https://example.com --target .price --interval 60` |
| Multi-URL config file | `watchdiff init` then edit `watchdiff.config.json` |

### Quick navigation

- [Install](#install)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [API reference](#api)
- [Feature details](#feature-details)
  - [JS-heavy pages (Playwright)](#js-heavy-pages-playwright)
  - [Proxy rotation](#proxy-rotation)
  - [User-Agent rotation](#user-agent-rotation)
  - [XPath selectors](#xpath-selectors)
  - [Semantic diff mode](#semantic-diff-mode)
  - [Alert cooldown](#alert-cooldown)
  - [SQLite storage backend](#sqlite-storage-backend)
  - [CSV and XLSX export](#csv-and-xlsx-export)
  - [Config file](#watchdiff-init---config-file)
- [Types](#types)
- [Helper functions](#helper-functions)
- [CLI reference](#cli)
- [Webhooks](#webhooks)
- [Advanced usage](#advanced-usage)
- [Optional dependencies](#optional-dependencies)


## Also available for Python

A Python port of this library is available on PyPI: [watchdiff-core](https://pypi.org/project/watchdiff-core/)

```bash
pip install watchdiff-core
```

Same pipeline, same concepts, same diff output - native Python implementation.


## Install

```bash
npm install watchdiff-core
```


## Quick start

```typescript
import { WatchDiff } from "watchdiff-core";

const wd = new WatchDiff();

wd.watch("https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html", {
  target: ".price_color",
  interval: 60,
  label: "Book price",
  onChange: (report) => console.log(report.changes),
});

const stop = wd.start();

process.on("SIGINT", () => { stop(); process.exit(0); });
```


## How it works

Every check runs through a fixed pipeline:

```
Fetcher / BrowserFetcher -> Cleaner -> Parser -> DiffEngine -> Store -> Notifier
```

1. **Fetcher** - downloads the page via native `fetch` (Node 18+), with proxy and UA rotation
2. **BrowserFetcher** - optional Playwright path for JS-rendered pages
3. **Cleaner** - strips scripts, styles, ads, and tracking noise (cheerio)
4. **Parser** - extracts the target CSS selector or XPath expression (or full body)
5. **DiffEngine** - compares content in line mode or semantic block mode
6. **Store** - persists snapshots and reports as JSON files or SQLite
7. **Notifier** - fires callbacks and webhooks on detected changes


## API

### `new WatchDiff(storageDir?, store?)`

```typescript
const wd = new WatchDiff(".watchdiff");  // default: JSON storage

// With SQLite backend (optional - requires better-sqlite3)
import { SqliteStore } from "watchdiff-core";
const wd = new WatchDiff(undefined, new SqliteStore(".watchdiff.db"));
```


### `.watch(url, options?)` - chainable

Register a URL to monitor.

| Option | Type | Default | Description |
|---|---|---|---|
| `target` | `string` | - | CSS selector (`.price`) or XPath (`//div[@class="price"]`). Omit for full page. |
| `interval` | `number` | `300` | Seconds between checks |
| `label` | `string` | URL | Human-readable name in logs and reports |
| `headers` | `Record<string, string>` | `{}` | Extra HTTP headers |
| `timeout` | `number` | `15000` | HTTP timeout in milliseconds |
| `ignoreSelectors` | `string[]` | `[]` | CSS selectors to strip before diffing |
| `ignorePatterns` | `RegExp[]` | `[]` | Regex patterns to strip from text |
| `browser` | `boolean` | `false` | Use headless Playwright browser (JS-heavy pages) |
| `browserOptions` | `BrowserOptions` | - | Options for the headless browser |
| `proxies` | `string[]` | `[]` | Proxy URLs to rotate through |
| `userAgents` | `string[]` | `[]` | User-Agent strings to rotate through |
| `diffMode` | `"line" \| "semantic"` | `"line"` | Diff granularity |
| `onChange` | `fn \| fn[]` | - | Callback(s) receiving a `DiffReport` on each change |
| `webhooks` | `string[]` | `[]` | Discord / Slack / custom POST endpoints |
| `minChanges` | `number` | `1` | Minimum changes required to trigger an alert |
| `cooldown` | `number` | `0` | Minimum seconds between two consecutive alerts (anti-spam) |

```typescript
wd
  .watch("https://example.com/product", {
    target: ".price",
    interval: 30,
    onChange: (report) => console.log(report.changes),
    webhooks: ["https://discord.com/api/webhooks/YOUR_WEBHOOK"],
  })
  .watch("https://news.ycombinator.com", { interval: 300, label: "HN" });
```


### `.onChange(callback)` - chainable

Global callback fired for every URL that changes.

```typescript
wd.onChange((report) => {
  console.log(reportSummary(report));
  for (const change of report.changes) {
    console.log(changeHuman(change));
  }
});
```


### `.start()` - returns `stop()`

Start the monitoring loop. Returns a `stop()` function.

```typescript
const stop = wd.start();

setTimeout(stop, 3_600_000);

process.on("SIGINT", () => { stop(); process.exit(0); });
```


### `await .checkOnce(url)`

Single immediate check without starting the scheduler.

```typescript
wd.watch("https://example.com", { target: ".price" });
const report = await wd.checkOnce("https://example.com");
if (report) console.log(reportSummary(report));
```


### `.history(url, limit?)` / `.reports(url, limit?)`

```typescript
const snapshots = wd.history("https://example.com", 10);
const reports   = wd.reports("https://example.com", 20);
```

### `.clear(url)`

Delete all stored snapshots and reports for a URL.


### Export API

```typescript
// CSV (no extra dependency)
const csv = wd.exportReportsCsv("https://example.com", 100);
fs.writeFileSync("reports.csv", csv);

const snapCsv = wd.exportSnapshotsCsv("https://example.com", 50);

// XLSX (requires: npm install exceljs)
const buf = await wd.exportReportsXlsx("https://example.com", 100);
fs.writeFileSync("reports.xlsx", buf);

const snapBuf = await wd.exportSnapshotsXlsx("https://example.com");
```


## Feature details

### JS-heavy pages (Playwright)

For pages that load content via JavaScript (SPAs, lazy loaders, infinite scroll), enable
the headless browser backend. WatchDiff will launch a Chromium instance, wait for the page
to fully render, and then proceed through the normal pipeline.

```bash
# Install playwright (one-time setup)
npm install playwright
npx playwright install chromium
```

```typescript
wd.watch("https://spa-example.com", {
  browser: true,
  browserOptions: {
    waitFor: "networkidle",     // wait until network is quiet
    waitForSelector: ".content", // also wait for this CSS selector
  },
  interval: 120,
});
```

The headless browser also supports proxy and User-Agent rotation, and respects the
`config.headers` as extra HTTP headers.


### Proxy rotation

Pass a list of proxy URLs in `proxies`. WatchDiff picks one at random on each request,
distributing load across the pool to avoid IP-based rate-limiting.

```typescript
wd.watch("https://example.com", {
  proxies: [
    "http://user:pass@proxy1.example.com:8080",
    "http://user:pass@proxy2.example.com:8080",
    "socks5://proxy3.example.com:1080",
  ],
  interval: 60,
});
```

Proxy support for native `fetch` uses [undici](https://undici.nodejs.org/) (bundled with
Node.js). For the headless browser path, Playwright handles the proxy natively.


### User-Agent rotation

Pass a list of `userAgents` to randomise the browser fingerprint on each request:

```typescript
wd.watch("https://example.com", {
  userAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/124.0.0.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1",
  ],
  interval: 30,
});
```

When `userAgents` is omitted, WatchDiff rotates through its own pool of modern browser
User-Agents automatically.


### XPath selectors

`target` accepts both CSS selectors and XPath expressions. XPath is detected automatically
when the value starts with `/` or `./`.

```typescript
// CSS selector (default)
wd.watch("https://example.com", { target: ".product-price" });

// XPath expression
wd.watch("https://example.com", {
  target: "//span[@class='product-price']",
});

// More complex XPath
wd.watch("https://example.com", {
  target: "//table[@id='results']//tr[position()>1]/td[2]",
  label:  "Table column 2",
});

// XPath also works in the CLI
// watchdiff run https://example.com --target "//h1[@class='title']"
```

XPath is evaluated using [xpath](https://www.npmjs.com/package/xpath) and
[@xmldom/xmldom](https://www.npmjs.com/package/@xmldom/xmldom).


### Semantic diff mode

By default, WatchDiff diffs content line by line. In `semantic` mode it instead extracts
meaningful content blocks from the page's HTML - paragraphs, headings, list items, table
cells - and diffs those blocks. This gives much better signal for structured pages:

```typescript
// Each "change" is now a paragraph or heading, not a random text fragment
wd.watch("https://blog.example.com/post/123", {
  diffMode: "semantic",
  label:    "Blog post",
});
```

Semantic mode extracts:
- `<p>` - paragraphs
- `<h1>` through `<h6>` - headings
- `<li>` - list items
- `<td>` and `<th>` - table cells
- `<blockquote>` - quotes

When the HTML contains no block-level elements (e.g. a plain-text response), it falls
back to line-level diff automatically.


### Alert cooldown

Set a minimum delay between two consecutive alerts for the same URL. Useful to avoid
notification storms when a page changes on every check (e.g. live counters, timestamps).

```typescript
wd.watch("https://example.com/live-stats", {
  target:   ".visitor-count",
  interval: 30,
  cooldown: 3600,  // at most one alert per hour, even if content changes every 30s
  onChange: (report) => sendNotification(report),
});
```

When a change is detected but the cooldown has not elapsed, the change is still stored
in the snapshot history and the diff report is saved - only the alert (callbacks +
webhooks) is suppressed. A debug log line is printed with the remaining time.

```bash
# CLI: suppress alerts for 10 minutes minimum
watchdiff run https://example.com --target .price --cooldown 600
```

In a config file:

```json
{
  "url": "https://example.com",
  "interval": 60,
  "cooldown": 1800
}
```


### SQLite storage backend

The default storage writes one JSON file per watched URL. For high-volume monitoring
(hundreds of URLs, long retention) the SQLite backend is more efficient.

```bash
npm install better-sqlite3
```

```typescript
import { WatchDiff, SqliteStore } from "watchdiff-core";

const store = new SqliteStore(".watchdiff.db");
const wd    = new WatchDiff(undefined, store);

wd.watch("https://example.com", { interval: 60 });
wd.start();
```

`SqliteStore` implements the same `IStore` interface as the default `Store`, so it is
a drop-in replacement. Both `snapshots` and `reports` are stored in a single `.db` file
with indexed queries.


### CSV and XLSX export

Export your full monitoring history for analysis in any spreadsheet tool.

**CSV (no extra dependency):**

```typescript
import { WatchDiff } from "watchdiff-core";
import { writeFileSync } from "node:fs";

const wd = new WatchDiff();
wd.watch("https://example.com", { target: ".price" });

// Reports (one row per change)
writeFileSync("reports.csv", wd.exportReportsCsv("https://example.com", 500));

// Snapshots (one row per captured snapshot)
writeFileSync("snapshots.csv", wd.exportSnapshotsCsv("https://example.com", 200));
```

**XLSX (requires exceljs):**

```bash
npm install exceljs
```

```typescript
const buf = await wd.exportReportsXlsx("https://example.com", 500);
writeFileSync("reports.xlsx", buf);
```

CSV columns (reports): `url`, `label`, `comparedAt`, `kind`, `before`, `after`

CSV columns (snapshots): `url`, `target`, `capturedAt`, `checksum`, `contentPreview`


### `watchdiff init` - config file

Generate a `watchdiff.config.json` template in the current directory:

```bash
watchdiff init
```

The generated file:

```json
{
  "storage": ".watchdiff",
  "watches": [
    {
      "url": "https://example.com",
      "target": ".price",
      "interval": 300,
      "label": "Example - Product Price",
      "browser": false,
      "diffMode": "line",
      "cooldown": 0,
      "webhooks": [],
      "ignoreSelectors": [],
      "proxies": [],
      "userAgents": []
    }
  ]
}
```

Run from config:

```bash
# Explicit
watchdiff run --config watchdiff.config.json

# Auto-discover (looks for watchdiff.config.json in cwd)
watchdiff run
```


## Types

### `DiffReport`

```typescript
interface DiffReport {
  url:        string;
  target:     string | undefined;
  label:      string;
  before:     Snapshot;
  after:      Snapshot;
  changes:    Change[];
  comparedAt: Date;
}
```

### `Change`

```typescript
interface Change {
  kind:     "added" | "removed" | "modified" | "unchanged";
  before?:  string;
  after?:   string;
  context?: string;
}
```

### `Snapshot`

```typescript
interface Snapshot {
  url:         string;
  target:      string | undefined;
  content:     string;   // cleaned plain text
  rawHtml:     string;   // raw HTML of the extracted zone
  capturedAt:  Date;
  checksum:    string;   // SHA-256 of content
}
```

### `BrowserOptions`

```typescript
interface BrowserOptions {
  waitFor?:          "load" | "domcontentloaded" | "networkidle";
  waitForSelector?:  string;
  executablePath?:   string;
}
```

### `IStore`

```typescript
interface IStore {
  saveSnapshot(snapshot: Snapshot): void;
  loadLatest(url: string, target: string | undefined): Snapshot | null;
  loadHistory(url: string, target: string | undefined, limit?: number): Snapshot[];
  clearHistory(url: string, target: string | undefined): void;
  saveReport(report: DiffReport): void;
  loadReports(url: string, target: string | undefined, limit?: number): Record<string, unknown>[];
}
```


## Helper functions

```typescript
import { reportSummary, reportHasChanges, reportAsDict, changeHuman } from "watchdiff-core";

reportSummary(report);     // "[Book price] 1 modified - 2025-01-01 12:00:00 UTC"
reportHasChanges(report);  // boolean
reportAsDict(report);      // JSON-serialisable plain object
changeHuman(change);       // "[~] Changed: '19' -> '24'"
```


## CLI

```bash
npm install -g watchdiff-core
```

### `run` - continuous monitoring

```bash
# Single URL
watchdiff run https://example.com --target .price --interval 60

# JS-heavy page (Playwright)
watchdiff run https://example.com --browser --target .price

# With proxy
watchdiff run https://example.com --proxy http://proxy:8080

# Custom User-Agent
watchdiff run https://example.com --user-agent "MyBot/1.0"

# Semantic diff
watchdiff run https://example.com --diff-mode semantic

# With a Discord or Slack webhook
watchdiff run https://example.com --target .price --webhook https://discord.com/api/webhooks/ID/TOKEN

# From a config file
watchdiff run --config watchdiff.config.json

# Auto-discover watchdiff.config.json in current directory
watchdiff run
```

### `check` - single check

```bash
watchdiff check https://example.com --target .price
watchdiff check https://example.com --browser --diff-mode semantic
watchdiff check https://example.com --json
```

### `history` - snapshot history

```bash
watchdiff history https://example.com --limit 10
```

### `reports` - diff reports

```bash
watchdiff reports https://example.com --limit 20
```

### `export` - export to CSV / XLSX

```bash
# Print reports as CSV to stdout
watchdiff export https://example.com

# Write reports to a file
watchdiff export https://example.com --output reports.csv

# Export snapshots instead
watchdiff export https://example.com --type snapshots --output snapshots.csv

# Export as XLSX (requires: npm install exceljs)
watchdiff export https://example.com --format xlsx --output reports.xlsx

# Limit the number of exported entries
watchdiff export https://example.com --limit 500 --output reports.csv

# With a CSS or XPath target
watchdiff export https://example.com --target .price --output price-history.csv
```

### `init` - generate config file

```bash
watchdiff init                    # creates watchdiff.config.json
watchdiff init --force            # overwrite existing config
```

### `clear` - delete stored data

```bash
watchdiff clear https://example.com
watchdiff clear https://example.com --yes   # skip confirmation
```


## Webhooks

Payload format is auto-detected from the URL:

| URL contains | Payload |
|---|---|
| `discord.com` | `{ content: "..." }` (capped at 2000 chars) |
| `hooks.slack.com` | `{ text: "..." }` (capped at 3000 chars) |
| anything else | full `DiffReport` as JSON |

Timeout: 10 seconds per webhook. A failed webhook never blocks others (`Promise.allSettled`).


## Advanced usage

### Use individual pipeline stages

All internal modules are exported and fully typed:

```typescript
import {
  Fetcher, BrowserFetcher, Cleaner, Parser, DiffEngine,
  Store, SqliteStore, Exporter, Notifier,
  makeWatchConfig, reportSummary, isXPath,
} from "watchdiff-core";

const config   = makeWatchConfig("https://example.com", { target: ".price", diffMode: "semantic" });
const fetcher  = config.browser ? new BrowserFetcher() : new Fetcher();
const html     = await fetcher.fetch(config);
const $        = new Cleaner().clean(html);
const snapshot = new Parser().extract($, config);

const store    = new Store(".watchdiff");
const previous = store.loadLatest(config.url, config.target);
if (previous) {
  const report = new DiffEngine().compare(previous, snapshot, config);
  console.log(reportSummary(report));
}
store.saveSnapshot(snapshot);
```

### Custom store implementation

Implement `IStore` to use your own storage backend:

```typescript
import type { IStore, Snapshot, DiffReport } from "watchdiff-core";
import { WatchDiff } from "watchdiff-core";

class RedisStore implements IStore {
  saveSnapshot(snap: Snapshot) { /* ... */ }
  loadLatest(url: string, target: string | undefined) { /* ... */ return null; }
  loadHistory(url: string, target: string | undefined, limit?: number) { return []; }
  clearHistory(url: string, target: string | undefined) { /* ... */ }
  saveReport(report: DiffReport) { /* ... */ }
  loadReports(url: string, target: string | undefined, limit?: number) { return []; }
}

const wd = new WatchDiff(undefined, new RedisStore());
wd.watch("https://example.com");
wd.start();
```

### Integrate with a server shutdown hook

```typescript
const wd   = new WatchDiff();
const stop = wd.watch("https://example.com").start();

server.on("close", stop);
```

### XPath targeting with namespace awareness

```typescript
wd.watch("https://rss.example.com/feed.xml", {
  target:  "//item/title",
  label:   "RSS feed titles",
  headers: { Accept: "application/rss+xml" },
});
```

## Optional dependencies

| Feature | Package to install |
|---|---|
| JS-heavy pages | `npm install playwright && npx playwright install chromium` |
| SQLite storage | `npm install better-sqlite3` |
| XLSX export | `npm install exceljs` |
| Proxy rotation (native fetch) | bundled via `undici` (no extra install) |

## Development

```bash
npm install
npm run build     # compile TypeScript to dist/
npm test          # vitest (17 tests)
npm run typecheck # tsc --noEmit
```

## Requirements

- **Node.js 18+** - uses native `fetch` and `AbortSignal.timeout`
- TypeScript 4.7+ (for consumers using the bundled types)

## Contributing

Missing a feature? Found a bug? Pull requests are welcome on [GitHub](https://github.com/r-seize/watchdiff-ts).

If you want a feature that is not yet in the project, open an issue or submit a PR directly - contributions of any size are appreciated.

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).

You are free to use, study, modify, and distribute this software under the terms of the GPL v3.
Any derivative work must also be distributed under the same license.
