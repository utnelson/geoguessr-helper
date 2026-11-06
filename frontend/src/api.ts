import type { Category, Meta, MetaImage, MetaInput, Region, RegionGroup, Settings } from './types';

export interface GroupInput {
  name: string;
  color: string;
  members: string[];
}

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
  renameCategory: (id: number, name: string) => request<Category>(`/api/categories/${id}`, json('PUT', { name })),
  orderCategories: (ids: number[]) => request<void>('/api/categories/order', json('PUT', { ids })),
  /** moveTo: Zielkategorie für die Metas einer genutzten Kategorie */
  deleteCategory: (id: number, moveTo?: number) =>
    request<void>(`/api/categories/${id}`, json('DELETE', moveTo ? { move_to: moveTo } : {})),

  settings: () => request<Settings>('/api/settings'),
  saveSettings: (s: Partial<Settings>) => request<Settings>('/api/settings', json('PUT', s)),

  stats: () => request<{ iso: string; count: number }[]>('/api/stats'),

  countryRegions: (iso: string) => request<(Region & { meta_count: number })[]>(`/api/countries/${encodeURIComponent(iso)}/regions`),
  createGroup: (iso: string, g: GroupInput) =>
    request<RegionGroup>('/api/regions', json('POST', { ...g, country_iso: iso, source: 'group' })),
  updateGroup: (id: number, g: Partial<GroupInput>) => request<RegionGroup>(`/api/regions/${id}`, json('PUT', g)),
  /** members: Namen der Mitglieder, damit Metas der Gruppe auf die einzelnen Regionen umgestellt werden */
  deleteGroup: (id: number, members: { ref: string; name: string }[]) =>
    request<void>(`/api/regions/${id}`, json('DELETE', { members })),

  /** landesweite Metas einer Kategorie in allen Ländern */
  categoryMetas: (categoryId: number) => request<Meta[]>(`/api/categories/${categoryId}/metas`),
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
