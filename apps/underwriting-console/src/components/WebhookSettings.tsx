import { useCallback, useEffect, useRef, useState } from 'react';
import BrandLogo from './BrandLogo';
import {
  PortalApiError,
  portalClient,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  type WebhookEndpoint,
} from '../api/portalClient';
import { describeProtectedError } from '../protectedErrorMessage';

const STATUS_STYLES: Record<WebhookDeliveryStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-sky-100 text-sky-800',
  RETRYABLE_FAILURE: 'bg-amber-100 text-amber-800',
  SUCCEEDED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  SUPERSEDED: 'bg-slate-200 text-slate-600',
};

type Busy = 'LOAD' | 'SAVE' | 'ROTATE' | 'REDELIVER' | null;

export default function WebhookSettings({ onBack }: { onBack: () => void }) {
  const [endpoint, setEndpoint] = useState<WebhookEndpoint | null>(null);
  const [url, setUrl] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<Busy>('LOAD');
  const [error, setError] = useState<{ message: string; reauthenticate: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingSave = useRef<{ fingerprint: string; key: string } | null>(null);

  const showError = (cause: unknown, fallback: string) => {
    const reauthenticate = cause instanceof PortalApiError && cause.code === 'REAUTHENTICATION_REQUIRED';
    setError({ message: describeProtectedError(cause, fallback), reauthenticate });
  };

  const applyEndpoint = (value: WebhookEndpoint) => {
    setEndpoint(value);
    if (value.configured) {
      setUrl(value.url);
      setIsEnabled(value.isEnabled);
    }
  };

  const refreshDeliveries = useCallback(async () => {
    const page = await portalClient.listWebhookDeliveries();
    setDeliveries(page.deliveries);
    setNextCursor(page.nextCursor);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [loaded] = await Promise.all([portalClient.getWebhookEndpoint(), refreshDeliveries()]);
        if (!cancelled) applyEndpoint(loaded.endpoint);
      } catch (cause) {
        if (!cancelled) showError(cause, 'Webhook settings could not be loaded.');
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshDeliveries]);

  const run = async (operation: Exclude<Busy, null>, action: () => Promise<void>, fallback: string) => {
    setBusy(operation);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      showError(cause, fallback);
    } finally {
      setBusy(null);
    }
  };

  const save = () => run('SAVE', async () => {
    const body = {
      url: url.trim(),
      isEnabled,
      expectedVersion: endpoint?.configured ? endpoint.version : null,
    };
    const fingerprint = JSON.stringify(body);
    const key = pendingSave.current?.fingerprint === fingerprint ? pendingSave.current.key : crypto.randomUUID();
    pendingSave.current = { fingerprint, key };
    const result = await portalClient.saveWebhookEndpoint(body, key);
    pendingSave.current = null;
    applyEndpoint(result.endpoint);
    if (result.signingSecret) setRevealedSecret(result.signingSecret);
    setNotice(endpoint?.configured ? 'Webhook endpoint updated.' : 'Webhook endpoint created.');
  }, 'The webhook endpoint could not be saved.');

  const rotate = () => {
    if (!endpoint?.configured) return;
    if (!window.confirm('Rotate the signing secret? Deliveries are signed with both the new and previous secret for 24 hours.')) return;
    void run('ROTATE', async () => {
      const result = await portalClient.rotateWebhookSecret({ expectedVersion: endpoint.version }, crypto.randomUUID());
      applyEndpoint(result.endpoint);
      if (result.signingSecret) setRevealedSecret(result.signingSecret);
      setNotice('Signing secret rotated.');
    }, 'The signing secret could not be rotated.');
  };

  const redeliver = (delivery: WebhookDelivery) => run('REDELIVER', async () => {
    await portalClient.redeliverWebhook(delivery.id, crypto.randomUUID());
    await refreshDeliveries();
    setNotice('Redelivery queued.');
  }, 'The delivery could not be queued again.');

  const loadMore = () => run('LOAD', async () => {
    if (!nextCursor) return;
    const page = await portalClient.listWebhookDeliveries(nextCursor);
    setDeliveries((current) => [...current, ...page.deliveries]);
    setNextCursor(page.nextCursor);
  }, 'More deliveries could not be loaded.');

  const copySecret = async () => {
    if (!revealedSecret) return;
    await navigator.clipboard?.writeText(revealedSecret).catch(() => undefined);
    setCopied(true);
  };

  const configured = endpoint?.configured ? endpoint : null;
  const dirty = !configured || configured.url !== url.trim() || configured.isEnabled !== isEnabled;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10" data-testid="webhook-settings">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <BrandLogo compact />
            <div>
              <h1 className="text-sm font-bold text-slate-900">Webhook delivery</h1>
              <p className="text-[11px] text-slate-500">Approved income for standalone loans, sent to your system</p>
            </div>
          </div>
          <button type="button" onClick={onBack} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-emerald-400 hover:text-emerald-700">
            Back to products
          </button>
        </header>

        {error ? (
          <div role="alert" data-testid="webhook-error" className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800">
            {error.message}
            {error.reauthenticate ? (
              <button type="button" onClick={() => window.location.assign('/logout')} className="ml-3 font-bold underline">Sign in again</button>
            ) : null}
          </div>
        ) : null}
        {notice ? <div role="status" data-testid="webhook-notice" className="border-b border-emerald-200 bg-emerald-50 px-6 py-3 text-sm text-emerald-800">{notice}</div> : null}

        {revealedSecret ? (
          <section data-testid="webhook-secret" className="border-b border-amber-200 bg-amber-50 px-6 py-4">
            <h2 className="text-sm font-bold text-amber-900">Signing secret — shown once</h2>
            <p className="mt-1 text-xs text-amber-900">Store this in your receiver now. FreeFlow keeps it in AWS Secrets Manager and cannot display it again.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code data-testid="webhook-secret-value" className="break-all rounded border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-slate-900">{revealedSecret}</code>
              <button type="button" onClick={() => { void copySecret(); }} className="rounded border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-900">{copied ? 'Copied' : 'Copy'}</button>
              <button type="button" data-testid="webhook-secret-dismiss" onClick={() => { setRevealedSecret(null); setCopied(false); }} className="rounded bg-amber-900 px-3 py-1.5 text-xs font-bold text-white">I have stored it</button>
            </div>
          </section>
        ) : null}

        <section className="grid gap-6 border-b border-slate-200 px-6 py-5 md:grid-cols-[1fr_280px]">
          <form
            className="grid gap-4"
            onSubmit={(event) => { event.preventDefault(); void save(); }}
          >
            <label className="text-sm font-medium text-slate-800">
              Endpoint URL
              <input
                data-testid="webhook-url"
                type="url"
                required
                value={url}
                placeholder="https://hooks.your-company.com/freeflow"
                onChange={(event) => setUrl(event.target.value)}
                className="mt-1 block w-full rounded border border-slate-300 p-2 font-mono text-sm"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">HTTPS only. No query strings, credentials, or private network addresses.</span>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input data-testid="webhook-enabled" type="checkbox" checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} />
              Send approved income to this endpoint
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                data-testid="webhook-save"
                type="submit"
                disabled={busy !== null || !dirty || !url.trim()}
                className="rounded bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy === 'SAVE' ? 'Saving...' : configured ? 'Save changes' : 'Create endpoint'}
              </button>
              {configured ? (
                <button
                  data-testid="webhook-rotate"
                  type="button"
                  disabled={busy !== null}
                  onClick={rotate}
                  className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
                >
                  {busy === 'ROTATE' ? 'Rotating...' : 'Rotate signing secret'}
                </button>
              ) : null}
            </div>
          </form>
          <dl className="grid content-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Status</dt><dd data-testid="webhook-status" className="font-bold text-slate-900">{busy === 'LOAD' && !endpoint ? 'Loading...' : configured ? (configured.isEnabled ? 'Enabled' : 'Disabled') : 'Not configured'}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Secret version</dt><dd className="font-bold text-slate-900">{configured?.signingSecretVersion ?? '—'}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Last rotated</dt><dd className="text-slate-900">{formatTime(configured?.signingSecretRotatedAt ?? null)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Updated</dt><dd className="text-slate-900">{formatTime(configured?.updatedAt ?? null)}</dd></div>
            <p className="mt-2 text-slate-500">Only standalone loans are delivered. Encompass-linked loans continue to sync through Encompass.</p>
          </dl>
        </section>

        <section className="px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900">Recent deliveries</h2>
            <button type="button" disabled={busy !== null} onClick={() => { void run('LOAD', refreshDeliveries, 'Deliveries could not be refreshed.'); }} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50">Refresh</button>
          </div>
          {deliveries.length === 0 ? (
            <p data-testid="webhook-deliveries-empty" className="mt-4 rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              No deliveries yet. Approving income on a standalone loan queues one automatically.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table data-testid="webhook-deliveries" className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Queued</th>
                    <th className="py-2 pr-3">Loan</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Attempts</th>
                    <th className="py-2 pr-3">Last response</th>
                    <th className="py-2 pr-3">Detail</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((delivery) => (
                    <tr key={delivery.id} data-testid="webhook-delivery-row" className="border-b border-slate-100">
                      <td className="py-2 pr-3 text-slate-700">{formatTime(delivery.createdAt)}</td>
                      <td className="py-2 pr-3 font-mono text-slate-700" title={delivery.loanId}>{delivery.loanId.slice(0, 8)}</td>
                      <td className="py-2 pr-3"><span data-testid="webhook-delivery-status" className={`rounded-full px-2 py-0.5 font-bold ${STATUS_STYLES[delivery.status]}`}>{delivery.status.replace(/_/g, ' ')}</span></td>
                      <td className="py-2 pr-3 text-slate-700">{delivery.attemptCount}</td>
                      <td className="py-2 pr-3 text-slate-700">{delivery.lastResponseStatus ?? '—'}</td>
                      <td className="py-2 pr-3 text-slate-600">
                        {delivery.safeErrorCode ?? (delivery.nextAttemptAt ? `Next attempt ${formatTime(delivery.nextAttemptAt)}` : '—')}
                      </td>
                      <td className="py-2 text-right">
                        {delivery.status === 'SUCCEEDED' || delivery.status === 'FAILED' ? (
                          <button type="button" data-testid="webhook-redeliver" disabled={busy !== null} onClick={() => { void redeliver(delivery); }} className="rounded border border-slate-300 bg-white px-2 py-1 font-bold text-slate-700 disabled:opacity-50">Redeliver</button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {nextCursor ? (
                <button type="button" disabled={busy !== null} onClick={() => { void loadMore(); }} className="mt-3 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700">Load more</button>
              ) : null}
            </div>
          )}
        </section>

        <details className="border-t border-slate-200 px-6 py-4 text-xs text-slate-600">
          <summary className="cursor-pointer font-bold text-slate-800">Verifying deliveries in your receiver</summary>
          <p className="mt-2">Each request is a JSON <code>POST</code> with these headers:</p>
          <ul className="mt-1 list-disc pl-5">
            <li><code>FreeFlow-Webhook-Id</code> — stable per delivery; use it to ignore duplicates.</li>
            <li><code>FreeFlow-Webhook-Timestamp</code> — Unix seconds; reject requests older than 5 minutes.</li>
            <li><code>FreeFlow-Webhook-Signature</code> — one or more <code>v1=&lt;hex&gt;</code> values, each HMAC-SHA256 of <code>id.timestamp.body</code> keyed with your secret.</li>
          </ul>
          <p className="mt-2">Respond with any 2xx status. 408, 425, 429, and 5xx responses are retried with backoff for up to 8 attempts; other responses and redirects are not retried.</p>
        </details>
      </div>
    </main>
  );
}

function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
