import type {
  Attribute, AttributeValueRow, BackupInfo, Category, Meta, MetaImage, MetaInput, Region, RegionGroup, SearchHit, Settings,
} from './types';

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

  backupInfo: () => request<BackupInfo>('/api/backup/info'),
  /** ZIP hochladen und einspielen; onProgress: 0..1 (Upload-Fortschritt) */
  restoreBackup: (file: File, onProgress: (p: number) => void) =>
    new Promise<{ metas: number; images: number; saved_as: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/backup');
      xhr.setRequestHeader('Content-Type', 'application/zip');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let body: { error?: string } & Record<string, unknown> = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* kein JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as never);
        else reject(new Error(body.error ?? (xhr.status === 413 ? 'Datei zu groß' : `HTTP ${xhr.status}`)));
      };
      xhr.onerror = () => reject(new Error('Verbindung abgebrochen'));
      xhr.send(file);
    }),

  // Merkmale (Rückwärtssuche)
  attributes: () => request<Attribute[]>('/api/attributes'),
  createAttribute: (a: { category_id: number; key: string; values?: string[] }) =>
    request<Attribute>('/api/attributes', json('POST', a)),
  updateAttribute: (id: number, a: { key?: string; values?: string[]; rename?: { from: string; to: string } }) =>
    request<Attribute>(`/api/attributes/${id}`, json('PUT', a)),
  deleteAttribute: (id: number) => request<void>(`/api/attributes/${id}`, { method: 'DELETE' }),
  attributeValues: () => request<AttributeValueRow[]>('/api/attribute-values'),

  /** Volltextsuche über Metas */
  search: (q: string) => request<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),

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
  /** Bildreihenfolge eines Metas setzen (erstes = Titelbild) */
  orderImages: (metaId: number, ids: number[]) => request<Meta>(`/api/metas/${metaId}/images/order`, json('PUT', { ids })),
  deleteImage: (id: number) => request<void>(`/api/images/${id}`, { method: 'DELETE' }),
};
