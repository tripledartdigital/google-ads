import React, { useState, useEffect } from 'react';
import ChatWindow from './ChatWindow.jsx';
import Sidebar from './Sidebar.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';

export default function App() {
  const [sessionId, setSessionId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const { messages, status, sendQuery, connected } = useWebSocket(sessionId);

  useEffect(() => {
    createNewSession();
  }, []);

  async function createNewSession() {
    try {
      const res = await fetch('/api/sessions', { method: 'POST' });
      const data = await res.json();
      setSessionId(data.sessionId);
      setSessions((prev) => [{ id: data.sessionId, title: 'New Chat', createdAt: new Date() }, ...prev]);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }

  function handleSend(question) {
    if (!sessionId || !question.trim()) return;
    sendQuery(sessionId, question);

    // Update session title from first question
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId && s.title === 'New Chat' ? { ...s, title: question.slice(0, 50) } : s))
    );
  }

  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        activeSession={sessionId}
        onSelectSession={setSessionId}
        onNewChat={createNewSession}
      />
      <main className="main">
        <header className="header">
          <h1>Google Ads Analytics</h1>
          <span className={`connection-dot ${connected ? 'connected' : 'disconnected'}`} />
        </header>
        <ChatWindow messages={messages} status={status} onSend={handleSend} />
      </main>
    </div>
  );
}
