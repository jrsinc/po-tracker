/** Web: download the CSV through the browser. */
export async function exportCsv(fileName: string, csv: string): Promise<void> {
  // BOM so Excel opens UTF-8 (product names with special characters) correctly.
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
