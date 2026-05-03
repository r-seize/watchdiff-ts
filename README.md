# watchdiff-core

**Lightweight web change monitoring - clean diffs, structured alerts, no AI required.**

WatchDiff watches web pages and tells you exactly what changed, in plain language.
No noisy HTML diffs. No external services. No AI black boxes.

- **Deterministic** - same input always produces the same output
- **Human-readable diffs** - "Price changed: $19 -> $24", not a wall of HTML
- **Zero external services** - snapshots stored locally as JSON
- **Fully typed** - complete TypeScript types included
- **Native fetch** - no HTTP library dependency, runs on Node.js 18+

---

## Install

```bash
npm install watchdiff-core
```

---

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

---

## How it works

Every check runs through a fixed pipeline:

```
Fetcher -> Cleaner -> Parser -> DiffEngine -> Store -> Notifier
```

1. **Fetcher** - downloads the page via native `fetch` (Node 18+)
2. **Cleaner** - strips scripts, styles, ads, and tracking noise (cheerio)
3. **Parser** - extracts the target CSS selector (or full body)
4. **DiffEngine** - compares content using Myers diff algorithm
5. **Store** - persists snapshots and reports as local JSON files
6. **Notifier** - fires callbacks and webhooks on detected changes

---

## API

### `new WatchDiff(storageDir?)`

```typescript
const wd = new WatchDiff(".watchdiff");  // default storage directory
```

---

### `.watch(url, options?)` - chainable

Register a URL to monitor.

| Option | Type | Default | Description |
|---|---|---|---|
| `target` | `string` | - | CSS selector (e.g. `.price`). Omit for full page. |
| `interval` | `number` | `300` | Seconds between checks |
| `label` | `string` | URL | Human-readable name in logs and reports |
| `headers` | `Record<string, string>` | `{}` | Extra HTTP headers |
| `timeout` | `number` | `15000` | HTTP timeout in milliseconds |
| `ignoreSelectors` | `string[]` | `[]` | CSS selectors to strip before diffing |
| `ignorePatterns` | `RegExp[]` | `[]` | Regex patterns to strip from text |
| `onChange` | `fn \| fn[]` | - | Callback(s) receiving a `DiffReport` on each change |
| `webhooks` | `string[]` | `[]` | Discord / Slack / custom POST endpoints |
| `minChanges` | `number` | `1` | Minimum changes required to trigger an alert |

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

---

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

---

### `.start()` - returns `stop()`

Start the monitoring loop. Returns a `stop()` function. The process stays alive until `stop()` is called.

```typescript
const stop = wd.start();

setTimeout(stop, 3_600_000);

process.on("SIGINT", () => { stop(); process.exit(0); });
```

---

### `.stop()`

Stop all watchers.

---

### `await .checkOnce(url)`

Single immediate check without starting the scheduler. Returns `null` on first run (no previous snapshot to compare against).

```typescript
wd.watch("https://example.com", { target: ".price" });
const report = await wd.checkOnce("https://example.com");
if (report) console.log(reportSummary(report));
```

---

### `.history(url, limit?)`

Return stored snapshots for a URL.

```typescript
const snapshots = wd.history("https://example.com", 10);
```

### `.reports(url, limit?)`

Return stored diff reports for a URL.

```typescript
const reports = wd.reports("https://example.com");
```

### `.clear(url)`

Delete all stored snapshots and reports for a URL.

---

## Types

### `DiffReport`

```typescript
interface DiffReport {
  url: string;
  target: string | undefined;
  label: string;
  before: Snapshot;
  after: Snapshot;
  changes: Change[];
  comparedAt: Date;
}
```

### `Change`

```typescript
interface Change {
  kind: "added" | "removed" | "modified" | "unchanged";
  before?: string;
  after?: string;
  context?: string;
}
```

### `Snapshot`

```typescript
interface Snapshot {
  url: string;
  target: string | undefined;
  content: string;    // cleaned plain text
  rawHtml: string;    // raw HTML of the extracted zone
  capturedAt: Date;
  checksum: string;   // SHA-256 of content
}
```

---

## Helper functions

```typescript
import { reportSummary, reportHasChanges, reportAsDict, changeHuman } from "watchdiff-core";

reportSummary(report);     // "[Book price] 1 modified - 2025-01-01 12:00:00 UTC"
reportHasChanges(report);  // boolean
reportAsDict(report);      // JSON-serialisable plain object
changeHuman(change);       // "[~] Changed: '19' -> '24'"
```

---

## CLI

```bash
npm install -g watchdiff-core
```

```bash
# Continuous monitoring
watchdiff run https://example.com --target .price --interval 60

# With a Discord or Slack webhook
watchdiff run https://example.com --target .price --webhook https://discord.com/api/webhooks/YOUR_WEBHOOK

# Single check
watchdiff check https://example.com --target .price

# Output as JSON
watchdiff check https://example.com --json

# Snapshot history
watchdiff history https://example.com --limit 10

# Diff reports
watchdiff reports https://example.com

# Clear stored data
watchdiff clear https://example.com
watchdiff clear https://example.com --yes  # skip confirmation
```

---

## Webhooks

Payload format is auto-detected from the URL:

| URL contains | Payload |
|---|---|
| `discord.com` | `{ content: "..." }` (capped at 2000 chars) |
| `hooks.slack.com` | `{ text: "..." }` (capped at 3000 chars) |
| anything else | full `DiffReport` as JSON |

---

## Advanced usage

### Use individual pipeline stages

All internal modules are exported and fully typed:

```typescript
import { Fetcher, Cleaner, Parser, DiffEngine, Store, makeWatchConfig, reportSummary } from "watchdiff-core";

const config = makeWatchConfig("https://example.com", { target: ".price" });
const html = await new Fetcher().fetch(config);
const $ = new Cleaner().clean(html);
const snapshot = new Parser().extract($, config);

const store = new Store(".watchdiff");
const previous = store.loadLatest(config.url, config.target);
if (previous) {
  const report = new DiffEngine().compare(previous, snapshot, config);
  console.log(reportSummary(report));
}
store.saveSnapshot(snapshot);
```

### Integrate with a server shutdown hook

```typescript
const wd = new WatchDiff();
wd.watch("https://example.com");
const stop = wd.start();

server.on("close", stop);
```

---

## Architecture

```
src/
+-- index.ts       public exports
+-- core.ts        WatchDiff facade
+-- models.ts      types + pure helper functions
+-- fetcher/       native fetch, timeout, redirect handling
+-- cleaner/       cheerio-based noise removal
+-- parser/        CSS selector extraction -> Snapshot
+-- diff/          Myers diff (diff package) -> DiffReport
+-- store/         JSON filesystem persistence
+-- notifier/      callbacks + webhook dispatch
+-- scheduler/     setInterval loop, one timer per URL
+-- cli/           commander CLI (watchdiff binary)
```

---

## Development

```bash
npm install
npm run build     # compile TypeScript to dist/
npm test          # vitest (17 tests)
npm run typecheck # tsc --noEmit
```

---

## Requirements

- **Node.js 18+** - uses native `fetch` and `AbortSignal.timeout`
- TypeScript 4.7+ (for consumers using the bundled types)

---

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).

You are free to use, study, modify, and distribute this software under the terms of the GPL v3.
Any derivative work must also be distributed under the same license.