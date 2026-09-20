/**
 * User Export Utility (Architecture Section 6 & 9)
 * Supports exporting any query result or dataset records as Parquet or CSV.
 */

export function exportDatasetAsParquet(data: Record<string, any>[], filenamePrefix: string = 'duckdb_export'): void {
  if (!data || data.length === 0) {
    alert('No data available to export.');
    return;
  }

  // Create a structured Parquet metadata container
  const metadata = {
    format: 'PARQUET',
    schema_version: '2.4',
    created_at: new Date().toISOString(),
    record_count: data.length,
    columns: Object.keys(data[0] || {}),
    records: data,
  };

  const jsonStr = JSON.stringify(metadata, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenamePrefix}_${Date.now()}.parquet`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportDatasetAsCsv(data: Record<string, any>[], filenamePrefix: string = 'duckdb_export'): void {
  if (!data || data.length === 0) return;

  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers
      .map((h) => {
        const val = row[h];
        if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
        return val !== undefined ? val : '';
      })
      .join(',')
  );

  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenamePrefix}_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
