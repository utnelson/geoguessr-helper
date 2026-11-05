import type { Category, Meta, MetaImage, MetaInput, Region } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* kein JSON */
    }
    throw new Error(msg);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  categories: () => request<Category[]>('/api/categories'),
  createCategory: (name: string) => request<Category>('/api/categories', json('POST', { name })),

  stats: () => request<{ iso: string; count: number }[]>('/api/stats'),

  countryRegions: (iso: string) => request<(Region & { meta_count: number })[]>(`/api/countries/${encodeURIComponent(iso)}/regions`),
  /** admin1-Region anlegen bzw. vorhandene (gleiche ref) zurückgeben */
  ensureRegion: (r: { country_iso: string; name: string; source: 'admin1'; ref: string }) =>
    request<Region>('/api/regions', json('POST', r)),

  countryMetas: (iso: string) => request<Meta[]>(`/api/countries/${encodeURIComponent(iso)}/metas`),
  createMeta: (m: MetaInput) => request<Meta>('/api/metas', json('POST', m)),
  updateMeta: (id: number, m: Partial<MetaInput>) => request<Meta>(`/api/metas/${id}`, json('PUT', m)),
  deleteMeta: (id: number) => request<void>(`/api/metas/${id}`, { method: 'DELETE' }),

  uploadImage: (metaId: number, file: File | Blob) =>
    request<MetaImage>(`/api/metas/${metaId}/images`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    }),
  deleteImage: (id: number) => request<void>(`/api/images/${id}`, { method: 'DELETE' }),
};
