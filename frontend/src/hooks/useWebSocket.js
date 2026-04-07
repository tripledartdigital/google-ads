import { useState, useEffect, useRef, useCallback } from 'react';

export function useWebSocket(sessionId) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, []);

  // Clear messages when session changes
  useEffect(() => {
    setMessages([]);
    setStatus(null);
  }, [sessionId]);

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      setConnected(true);
      console.log('[ws] connected');
    };

    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 2 seconds
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'ack':
          break;
        case 'status':
          setStatus(msg.status);
          break;
        case 'result':
          setStatus(null);
          setMessages((prev) => [...prev, { role: 'assistant', data: msg.data }]);
          break;
        case 'error':
          setStatus(null);
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', data: { answer: `Error: ${msg.error}`, insights: [], recommendations: [] } },
          ]);
          break;
      }
    };

    wsRef.current = ws;
  }

  const sendQuery = useCallback(
    (sid, question) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      // Add user message immediately
      setMessages((prev) => [...prev, { role: 'user', content: question }]);

      wsRef.current.send(
        JSON.stringify({
          type: 'query',
          sessionId: sid,
          question,
        })
      );
    },
    []
  );

  return { messages, status, sendQuery, connected };
}
