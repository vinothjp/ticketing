import api from './api';

/**
 * Fetch a file from the API and hand it to the browser as a download.
 *
 * It goes through the shared Axios instance rather than a plain `<a href>`, so
 * the bearer token is attached the way it is on every other call — a link would
 * arrive unauthenticated and 401. The server names the file in
 * `Content-Disposition` (and exposes that header across the origin); `fallback`
 * is used when the header is missing.
 */
export async function downloadFile(url: string, fallback: string) {
  return saveBlob(await api.get(url, { responseType: 'blob' }), fallback);
}

/**
 * The same, for an export whose scope has to be *sent* — the ticket list posts
 * the ids it is currently showing, which is far past what a query string holds.
 */
export async function downloadFilePost(url: string, body: unknown, fallback: string) {
  return saveBlob(await api.post(url, body, { responseType: 'blob' }), fallback);
}

/** Hand a fetched blob response to the browser as a download. */
function saveBlob(res: { data: unknown; headers: Record<string, unknown> }, fallback: string) {
  const disposition = String(res.headers['content-disposition'] ?? '');
  const named = /filename="?([^";]+)"?/i.exec(disposition)?.[1];

  const href = URL.createObjectURL(res.data as Blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = named || fallback;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Freed on the next tick — revoking it synchronously can beat the click in
  // some browsers and download an empty file.
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

/**
 * The message inside a failed *blob* request. Axios honours `responseType` on
 * the error path too, so an API error arrives as a Blob of JSON rather than the
 * parsed body every other call gets.
 */
export async function blobErrorMessage(e: unknown, fallback: string) {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (parsed?.message) return String(parsed.message);
    } catch {
      /* not JSON — fall through to the generic message */
    }
  }
  return (e as { message?: string })?.message || fallback;
}
