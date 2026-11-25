import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** iOS / Android: write the CSV to the cache and open the share sheet (Mail, Files, Teams …). */
export async function exportCsv(fileName: string, csv: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write('\ufeff' + csv);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: fileName });
}
