import { useState, useEffect, useRef } from 'react';
import AppLayout from '@cloudscape-design/components/app-layout';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Input from '@cloudscape-design/components/input';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import Spinner from '@cloudscape-design/components/spinner';
import Tabs from '@cloudscape-design/components/tabs';
import Alert from '@cloudscape-design/components/alert';
import ColumnLayout from '@cloudscape-design/components/column-layout';

const API = window.location.origin;

function LoginPage({ onLogin }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const mode = window.location.port === '3082' ? 'hotel' : 'airbnb';

  const submit = async () => {
    setLoading(true); setError('');
    try {
      const body = mode === 'airbnb' ? { code } : { name, room };
      const res = await fetch(API + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.valid) { localStorage.setItem('guest-auth', JSON.stringify(data)); onLogin(data); }
      else setError(mode === 'airbnb' ? 'Invalid or expired code' : 'Invalid name or room');
    } catch { setError('Connection error'); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1b2d' }}>
      <Container header={<Header variant="h1">🏠 Welcome</Header>}>
        <SpaceBetween size="l">
          <Box variant="p" color="text-body-secondary">
            {mode === 'airbnb' ? 'Enter your access code to continue' : 'Enter your name and room number'}
          </Box>
          {mode === 'airbnb' ? (
            <Input value={code} onChange={({ detail }) => setCode(detail.value)}
              onKeyDown={({ detail }) => { if (detail.key === 'Enter') submit(); }}
              placeholder="Access code (e.g. A1B2C3)" autoFocus />
          ) : (
            <SpaceBetween size="s">
              <Input value={name} onChange={({ detail }) => setName(detail.value)} placeholder="Your name" autoFocus />
              <Input value={room} onChange={({ detail }) => setRoom(detail.value)}
                onKeyDown={({ detail }) => { if (detail.key === 'Enter') submit(); }}
                placeholder="Room number" />
            </SpaceBetween>
          )}
          {error && <Alert type="error">{error}</Alert>}
          <Button variant="primary" onClick={submit} loading={loading} fullWidth>Enter</Button>
        </SpaceBetween>
      </Container>
    </div>
  );
}

function GuestDashboard({ guest }) {
  const [info, setInfo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch(API + '/api/guest/info').then(r => r.json()).then(setInfo).catch(() => {});
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim()) return;
    const text = input; setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      const res = await fetch(API + '/api/guest/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
      const data = await res.json();
      setMessages(m => [...m, { role: 'assistant', text: data.response || data.error }]);
    } catch (err) { setMessages(m => [...m, { role: 'assistant', text: 'Error: ' + err.message }]); }
    setLoading(false);
  };

  const guestName = guest?.guest?.name || guest?.name || 'Guest';

  const infoTab = (
    <SpaceBetween size="m">
      {info?.wifi?.name && (
        <Container header={<Header variant="h3">📶 WiFi</Header>}>
          <ColumnLayout columns={2}>
            <Box><Box variant="awsui-key-label">Network</Box><Box>{info.wifi.name}</Box></Box>
            <Box><Box variant="awsui-key-label">Password</Box><Box>{info.wifi.password}</Box></Box>
          </ColumnLayout>
        </Container>
      )}
      {info?.rules && (
        <Container header={<Header variant="h3">📜 House Rules</Header>}>
          <Box variant="p" style={{ whiteSpace: 'pre-wrap' }}>{info.rules}</Box>
        </Container>
      )}
      {info?.emergency && (
        <Container header={<Header variant="h3">🚨 Emergency</Header>}>
          <Box variant="p" style={{ whiteSpace: 'pre-wrap' }}>{info.emergency}</Box>
        </Container>
      )}
      {info?.checkoutTime && (
        <Container header={<Header variant="h3">🕐 Check-out</Header>}>
          <Box variant="p">{info.guest?.checkOut || 'See host'} at {info.checkoutTime}</Box>
        </Container>
      )}
    </SpaceBetween>
  );

  const chatTab = (
    <Container>
      <SpaceBetween size="m">
        <div style={{ height: '55vh', overflowY: 'auto', padding: '8px' }}>
          {messages.length === 0 && (
            <Box textAlign="center" color="text-body-secondary" padding={{ top: 'xxl' }}>
              <Box variant="p" fontSize="heading-m">Ask me anything!</Box>
              <Box variant="p">Restaurants, transport, activities, house info...</Box>
            </Box>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ textAlign: m.role === 'user' ? 'right' : 'left', marginBottom: '12px' }}>
              <div style={{ display: 'inline-block', maxWidth: '80%', padding: '10px 14px', borderRadius: '12px', background: m.role === 'user' ? '#0972d3' : '#414d5c', color: '#fff', fontSize: '14px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                {m.text}
              </div>
            </div>
          ))}
          {loading && <Spinner size="normal" />}
          <div ref={bottomRef} />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <Input value={input} onChange={({ detail }) => setInput(detail.value)}
              onKeyDown={({ detail }) => { if (detail.key === 'Enter' && !loading) send(); }}
              placeholder="Ask a question..." disabled={loading} />
          </div>
          <Button variant="primary" onClick={send} loading={loading}>Send</Button>
        </div>
      </SpaceBetween>
    </Container>
  );

  const localTab = (
    <Container header={<Header variant="h3">🗺️ Around You</Header>}>
      <Box variant="p" style={{ whiteSpace: 'pre-wrap' }}>
        {info?.localInfo || 'Ask the assistant for local recommendations!'}
      </Box>
    </Container>
  );

  return (
    <AppLayout
      content={
        <SpaceBetween size="l">
          <Header variant="h1">🏠 Welcome, {guestName}!</Header>
          <Tabs tabs={[
            { id: 'info', label: '📋 Info', content: infoTab },
            { id: 'chat', label: '💬 Chat', content: chatTab },
            { id: 'local', label: '🗺️ Local', content: localTab },
          ]} />
        </SpaceBetween>
      }
      navigationHide
      toolsHide
    />
  );
}

export default function GuestPortal() {
  const [auth, setAuth] = useState(false);
  const [guest, setGuest] = useState(null);

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem('guest-auth')); if (s?.valid) { setAuth(true); setGuest(s); } } catch {}
  }, []);

  if (!auth) return <LoginPage onLogin={d => { setAuth(true); setGuest(d); }} />;
  return <GuestDashboard guest={guest} />;
}
