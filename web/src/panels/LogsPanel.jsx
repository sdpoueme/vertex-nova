import { useState, useEffect, useRef } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';

export default function LogsPanel({ api }) {
  const [logs, setLogs] = useState('');
  const ref = useRef(null);

  const load = async () => {
    try {
      const res = await fetch(api + '/api/logs');
      const data = await res.json();
      setLogs(data.logs || '');
      setTimeout(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, 100);
    } catch (err) { setLogs('Erreur: ' + err.message); }
  };

  useEffect(() => { load(); }, []);

  return (
    <Container header={
      <Header variant="h2" actions={<Button onClick={load} iconName="refresh">Rafraîchir</Button>}>
        Logs
      </Header>
    }>
      <div ref={ref} style={{
        height: '70vh', overflowY: 'auto', background: '#0d1117',
        borderRadius: '8px', padding: '16px',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '12px',
        color: '#8b949e', whiteSpace: 'pre-wrap', lineHeight: '1.6',
      }}>
        {logs}
      </div>
    </Container>
  );
}
