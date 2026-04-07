import React, { useState } from 'react';
import DataTable from './DataTable.jsx';

export default function MessageBubble({ message }) {
  const [showData, setShowData] = useState(false);

  if (message.role === 'user') {
    return (
      <div className="message user">
        <div className="bubble user-bubble">{message.content}</div>
      </div>
    );
  }

  const { data } = message;

  return (
    <div className="message assistant">
      <div className="bubble assistant-bubble">
        <div className="answer">{data.answer}</div>

        {data.insights?.length > 0 && (
          <div className="section">
            <h4>Key Insights</h4>
            <ul>
              {data.insights.map((insight, i) => (
                <li key={i}>{insight}</li>
              ))}
            </ul>
          </div>
        )}

        {data.recommendations?.length > 0 && (
          <div className="section">
            <h4>Recommendations</h4>
            <ul className="recommendations">
              {data.recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </div>
        )}

        {data.data?.primary && (
          <div className="section">
            <button className="toggle-data" onClick={() => setShowData(!showData)}>
              {showData ? 'Hide' : 'Show'} underlying data ({data.meta?.rowsFetched} rows)
            </button>
            {showData && <DataTable rows={data.data.primary} />}
          </div>
        )}

        {data.meta && (
          <div className="meta">
            {data.meta.queriesRun} queries | {data.meta.rowsFetched} rows |{' '}
            {data.meta.intent?.analysis_type} analysis
          </div>
        )}
      </div>
    </div>
  );
}
