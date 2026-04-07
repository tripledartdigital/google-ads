import React from 'react';

export default function Sidebar({ sessions, activeSession, onSelectSession, onNewChat }) {
  return (
    <aside className="sidebar">
      <button className="new-chat-btn" onClick={onNewChat}>
        + New Chat
      </button>
      <div className="session-list">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={`session-item ${session.id === activeSession ? 'active' : ''}`}
            onClick={() => onSelectSession(session.id)}
          >
            <span className="session-title">{session.title}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
