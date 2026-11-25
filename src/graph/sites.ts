import { encodeDrivePath, type GraphHttp } from './http';
import type { GraphDrive, GraphList, GraphSite, Paged } from './types';

export async function getSiteByPath(http: GraphHttp, host: string, sitePath: string): Promise<GraphSite> {
  return http.request<GraphSite>(`/sites/${host}:/${encodeDrivePath(sitePath)}?$select=id,displayName,webUrl`);
}

async function getAll<T>(http: GraphHttp, path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = path;
  while (next) {
    const page: Paged<T> = await http.request<Paged<T>>(next);
    out.push(...page.value);
    next = page['@odata.nextLink'];
  }
  return out;
}

/** Finds a list by display name (case-insensitive). */
export async function findListByName(http: GraphHttp, siteId: string, name: string): Promise<GraphList> {
  const lists = await getAll<GraphList>(http, `/sites/${siteId}/lists?$select=id,name,displayName&$top=200`);
  const wanted = name.trim().toLowerCase();
  const hit = lists.find((l) => l.displayName.toLowerCase() === wanted || l.name?.toLowerCase() === wanted);
  if (!hit) throw new Error(`SharePoint list "${name}" was not found on the site.`);
  return hit;
}

export class LibraryNotFoundError extends Error {
  constructor(public readonly libraryName: string, public readonly available: string[]) {
    super(
      `Document library "${libraryName}" was not found. Create it in SharePoint, or set ` +
        `EXPO_PUBLIC_SP_LIBRARY_NAME to one of: ${available.join(', ') || '(none)'}.`,
    );
    this.name = 'LibraryNotFoundError';
  }
}

/** Finds a document library's drive by display name (case-insensitive). */
export async function findDriveByName(http: GraphHttp, siteId: string, name: string): Promise<GraphDrive> {
  const drives = await getAll<GraphDrive>(http, `/sites/${siteId}/drives?$select=id,name,webUrl`);
  const wanted = name.trim().toLowerCase();
  const hit = drives.find((d) => d.name.toLowerCase() === wanted);
  if (!hit) throw new LibraryNotFoundError(name, drives.map((d) => d.name));
  return hit;
}
