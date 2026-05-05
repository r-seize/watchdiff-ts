/**
 * Minimal ambient type stubs for optional peer dependencies.
 * These allow tsc to compile without the packages installed.
 * When the packages are installed, their own types take over.
 */

declare module "playwright" {
    interface Page {
        setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
        goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
        waitForSelector(selector: string, opts?: Record<string, unknown>): Promise<unknown>;
        content(): Promise<string>;
        close(): Promise<void>;
    }
    interface Browser {
        newPage(): Promise<Page>;
        close(): Promise<void>;
    }
    const chromium: {
        launch(opts?: Record<string, unknown>): Promise<Browser>;
    };
}

declare module "exceljs" {
    interface Worksheet {
        columns: Array<{ header: string; key: string; width: number }>;
        addRow(data: Record<string, unknown>): void;
    }
    class Workbook {
        addWorksheet(name: string): Worksheet;
        readonly xlsx: { writeBuffer(): Promise<Buffer> };
    }
    export = { Workbook };
}
