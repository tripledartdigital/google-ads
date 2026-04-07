import React, { useState, useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble.jsx';

export default function ChatWindow({ messages, status, onSend }) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
    inputRef.current?.focus();
  }

  const suggestions = [
    'How are my campaigns performing this month?',
    'Why did CPL increase last week?',
    'Which campaigns are wasting spend?',
    'What keywords should I pause?',
    'Performance this month vs last month',
  ];

  return (
    <div className="chat-window">
      <div className="messages">
        {messages.length === 0 && !status && (
          <div className="empty-state">
            <h2>Ask anything about your Google Ads</h2>
            <p>Get instant, data-driven insights powered by AI</p>
            <div className="suggestions">
              {suggestions.map((s, i) => (
                <button key={i} className="suggestion" onClick={() => onSend(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {status && (
          <div className="status-indicator">
            <div className="spinner" />
            <span>{status}</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form className="input-bar" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your Google Ads performance..."
          disabled={!!status}
        />
        <button type="submit" disabled={!input.trim() || !!status}>
          Send
        </button>
      </form>
    </div>
  );
}
