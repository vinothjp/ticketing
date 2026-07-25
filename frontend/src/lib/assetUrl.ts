import API_BASE from '../config';

export function assetUrl(path?: string | null): string | null {
  return path ? `${API_BASE}${path}` : null;
}
