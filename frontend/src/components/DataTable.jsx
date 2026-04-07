import React from 'react';

const CURRENCY_FIELDS = ['cost', 'cpc', 'cpl', 'conversion_value'];
const PERCENT_FIELDS = ['ctr', 'cvr', 'impression_share', 'lost_is_budget', 'lost_is_rank'];
const HIDDEN_FIELDS = ['campaign_id', 'ad_group_id'];

function formatValue(key, value) {
  if (value === null || value === undefined) return '—';
  if (CURRENCY_FIELDS.includes(key)) return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (PERCENT_FIELDS.includes(key)) return `${value}%`;
  if (typeof value === 'number') return value.toLocaleString();
  return String(value);
}

function formatHeader(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function DataTable({ rows }) {
  if (!rows || rows.length === 0) return <p className="no-data">No data available</p>;

  const columns = Object.keys(rows[0]).filter(k => !HIDDEN_FIELDS.includes(k));

  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{formatHeader(col)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col} className={typeof row[col] === 'number' ? 'numeric' : ''}>
                  {formatValue(col, row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 && <p className="table-note">Showing 50 of {rows.length} rows</p>}
    </div>
  );
}
