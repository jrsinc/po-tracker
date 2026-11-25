/** A file the user picked (camera, gallery or document picker). */
export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
  /** Web only: the browser File/Blob (picker URIs on web are not durable). */
  blob?: Blob;
}

/**
 * App-owned file storage for the upload queue. Native: files copied into the app's document
 * directory (expo-file-system). Web: blobs kept in IndexedDB. Faked in tests.
 */
export interface FileSource {
  /** Copies a picked file into app storage so it survives until uploaded. */
  importFile(file: PickedFile): Promise<{ uri: string; size: number }>;
  exists(uri: string): Promise<boolean>;
  /** Reads bytes [offset, offset + length). */
  read(uri: string, offset: number, length: number): Promise<Uint8Array>;
  /** Whole file, for simple uploads. */
  readAll(uri: string): Promise<Uint8Array | Blob>;
  remove(uri: string): Promise<void>;
}
