/**
 * Notifier - dispatches alerts when a DiffReport has changes.
 *
 * Supported channels:
 *   - JS callbacks (sync or async)
 *   - Webhooks: Discord, Slack, generic HTTP POST
 */

import {
    changeHuman,
    reportAsDict,
    reportHasChanges,
    reportSummary,
    type AlertConfig,
    type DiffReport,
} from "../models.js";

export class Notifier {
    async notify(report: DiffReport, alert: AlertConfig): Promise<void> {
        if (!reportHasChanges(report)) return;
        if (report.changes.length < alert.minChanges) return;

        // 1. JS callbacks
        for (const cb of alert.onChange) {
            try {
                await cb(report);
            } catch (err) {
                console.warn("[watchdiff] Alert callback error:", err);
            }
        }

        // 2. Webhooks
        await Promise.allSettled(alert.webhooks.map((url) => this.sendWebhook(url, report)));
    }

    private async sendWebhook(url: string, report: DiffReport): Promise<void> {
        const payload = this.buildPayload(url, report);
        try {
            const res = await globalThis.fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) {
                console.warn(`[watchdiff] Webhook ${url} returned ${res.status}`);
            }
        } catch (err) {
            console.warn(`[watchdiff] Webhook request error (${url}):`, err);
        }
    }

    private buildPayload(url: string, report: DiffReport): Record<string, unknown> {
        const summary       = reportSummary(report);
        const changeLines   = report.changes
            .slice(0, 20)
            .map(changeHuman)
            .join("\n");
        const text = `${summary}\n\n${changeLines}`;

        if (url.includes("discord.com")) {
            return { content: text.slice(0, 2000) };
        }
        if (url.includes("hooks.slack.com")) {
            return { text: text.slice(0, 3000) };
        }
        return reportAsDict(report);
    }
}