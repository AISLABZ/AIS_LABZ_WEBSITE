import { apiJson } from './http.js';
import { redact } from './logger.js';

/**
 * Notify the administrator. Posts {text} to NOTIFY_WEBHOOK_URL (Slack/Teams/
 * Discord-compatible incoming webhooks accept this shape) and always records
 * the notification in the run log. Failures never break the pipeline.
 */
export async function notify(cfg, run, { subject, message, level = 'info' }, { fetchImpl = fetch } = {}) {
  const text = redact(`[AISLabz Articles Engine] ${subject}\n${message}`);
  const entry = { at: new Date().toISOString(), level, subject, delivered: false };
  if (cfg.notifyWebhookUrl) {
    try {
      await apiJson(cfg.notifyWebhookUrl, { body: { text, content: text }, timeoutMs: 10000, fetchImpl });
      entry.delivered = true;
    } catch (err) {
      entry.error = err.message;
    }
  }
  if (run) run.notifications = [...(run.notifications || []), entry];
  return entry;
}
