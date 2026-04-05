import { useState, useRef, useEffect } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Input from '@cloudscape-design/components/input';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import Spinner from '@cloudscape-design/components/spinner';

export default function ChatPanel({ api }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim()) return;
    const text = input;
    setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      const res = await fetch(api + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setMessages(m => [...m, { role: 'assistant', text: data.response || data.error }]);
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', text: 'Erreur: ' + err.message }]);
    }
    setLoading(false);
  };

  return (
    <Container header={<Header variant="h2">Chat</Header>}>
      <SpaceBetween size="m">
        <div style={{ height: '60vh', overflowY: 'auto', padding: '8px' }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              textAlign: m.role === 'user' ? 'right' : 'left',
              marginBottom: '12px',
            }}>
              <Box variant="span" color={m.role === 'user' ? 'text-status-info' : 'text-body-secondary'} fontSize="body-s">
                {m.role === 'user' ? 'Vous' : 'Vertex Nova'}
              </Box>
              <div style={{
                display: 'inline-block',
                maxWidth: '80%',
                padding: '10px 14px',
                borderRadius: '12px',
                background: m.role === 'user' ? '#0972d3' : '#1a1f2e',
                color: 'white',
                textAlign: 'left',
                fontSize: '14px',
                lineHeight: '1.5',
                whiteSpace: 'pre-wrap',
              }}>
                {m.text}
              </div>
            </div>
          ))}
          {loading && <div><Spinner size="normal" /> Réflexion en cours...</div>}
          <div ref={bottomRef} />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <Input
              value={input}
              onChange={({ detail }) => setInput(detail.value)}
              onKeyDown={({ detail }) => { if (detail.key === 'Enter') send(); }}
              placeholder="Écrivez un message..."
            />
          </div>
          <Button variant="primary" onClick={send} loading={loading}>Envoyer</Button>
        </div>
      </SpaceBetween>
    </Container>
  );
}
