/**
 * Guest Portal — minimal frontend for Airbnb/Hotel guests.
 * Served on port 3081 (airbnb) or 3082 (hotel).
 * Features: login, info, chat, device control (audio/lights only).
 */
import { useState, useEffect, useRef } from 'react';

const API = window.location.origin;

function GuestLogin({ mode, onLogin }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError('');
    try {
      const body = mode === 'airbnb' ? { code } : { name, room };
      const res = await fetch(API + '/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.valid) {
        localStorage.setItem('guest-token', JSON.stringify(data));
        onLogin(data);
      } else {
        setError(mode === 'airbnb' ? 'Code invalide ou expiré' : 'Nom ou chambre incorrect');
      }
    } catch (err) { setError('Erreur de connexion'); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1a1f2e 0%, #2d3748 100%)' }}>
      <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', maxWidth: '400px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: '24px', color: '#1a1f2e' }}>🏠 Welcome</h1>
        <p style={{ margin: '0 0 24px', color: '#666' }}>
          {mode === 'airbnb' ? 'Enter your access code to continue' : 'Enter your name and room number'}
        </p>

        {mode === 'airbnb' ? (
          <input
            type="text" value={code} onChange={e => setCode(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="Access code (e.g. A1B2C3)"
            style={{ width: '100%', padding: '12px 16px', fontSize: '18px', border: '2px solid #e2e8f0', borderRadius: '8px', textAlign: 'center', letterSpacing: '4px', textTransform: 'uppercase', boxSizing: 'border-box' }}
            autoFocus
          />
        ) : (
          <>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
              style={{ width: '100%', padding: '12px 16px', fontSize: '16px', border: '2px solid #e2e8f0', borderRadius: '8px', marginBottom: '12px', boxSizing: 'border-box' }} autoFocus />
            <input type="text" value={room} onChange={e => setRoom(e.target.value)} placeholder="Room number"
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              style={{ width: '100%', padding: '12px 16px', fontSize: '16px', border: '2px solid #e2e8f0', borderRadius: '8px', boxSizing: 'border-box' }} />
          </>
        )}

        {error && <p style={{ color: '#e53e3e', margin: '12px 0 0', fontSize: '14px' }}>{error}</p>}

        <button onClick={submit} disabled={loading}
          style={{ width: '100%', marginTop: '20px', padding: '14px', fontSize: '16px', background: '#0972d3', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>
          {loading ? '...' : 'Enter'}
        </button>
      </div>
    </div>
  );
}

function GuestDashboard({ guest, mode }) {
  const [info, setInfo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('info');
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch(API + '/api/guest/info').then(r => r.json()).then(setInfo).catch(() => {});
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const text = input;
    setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      const res = await fetch(API + '/api/guest/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setMessages(m => [...m, { role: 'assistant', text: data.response || data.error }]);
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', text: 'Error: ' + err.message }]);
    }
    setLoading(false);
  };

  const guestName = guest?.guest?.name || guest?.name || 'Guest';

  return (
    <div style={{ minHeight: '100vh', background: '#f7fafc', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#1a1f2e', color: '#fff', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px' }}>🏠 Welcome, {guestName}!</h1>
          {info?.guest?.checkOut && <p style={{ margin: '4px 0 0', fontSize: '13px', opacity: 0.7 }}>Check-out: {info.guest.checkOut} at {info.checkoutTime || '11:00'}</p>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', background: '#fff' }}>
        {['info', 'chat', 'local'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex: 1, padding: '12px', border: 'none', background: tab === t ? '#fff' : '#f7fafc', borderBottom: tab === t ? '2px solid #0972d3' : 'none', cursor: 'pointer', fontWeight: tab === t ? '600' : '400', fontSize: '14px' }}>
            {t === 'info' ? '📋 Info' : t === 'chat' ? '💬 Chat' : '🗺️ Local'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
        {tab === 'info' && info && (
          <div>
            {info.wifi?.name && (
              <div style={{ background: '#fff', borderRadius: '12px', padding: '16px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>📶 WiFi</h3>
                <p style={{ margin: 0 }}><strong>Network:</strong> {info.wifi.name}</p>
                <p style={{ margin: '4px 0 0' }}><strong>Password:</strong> {info.wifi.password}</p>
              </div>
            )}
            {info.rules && (
              <div style={{ background: '#fff', borderRadius: '12px', padding: '16px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>📜 House Rules</h3>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '14px', color: '#4a5568' }}>{info.rules}</pre>
              </div>
            )}
            {info.emergency && (
              <div style={{ background: '#fff', borderRadius: '12px', padding: '16px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>🚨 Emergency</h3>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '14px' }}>{info.emergency}</pre>
              </div>
            )}
          </div>
        )}

        {tab === 'chat' && (
          <div>
            <div style={{ height: '50vh', overflowY: 'auto', marginBottom: '12px' }}>
              {messages.length === 0 && (
                <p style={{ textAlign: 'center', color: '#a0aec0', marginTop: '40px' }}>Ask me anything about the area, the house, or what to do!</p>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ textAlign: m.role === 'user' ? 'right' : 'left', marginBottom: '10px' }}>
                  <div style={{ display: 'inline-block', maxWidth: '80%', padding: '10px 14px', borderRadius: '12px', background: m.role === 'user' ? '#0972d3' : '#edf2f7', color: m.role === 'user' ? '#fff' : '#1a202c', fontSize: '14px', lineHeight: '1.5' }}>
                    {m.text}
                  </div>
                </div>
              ))}
              {loading && <p style={{ color: '#a0aec0' }}>Thinking...</p>}
              <div ref={bottomRef} />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) sendMessage(); }}
                placeholder="Ask a question..." disabled={loading}
                style={{ flex: 1, padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '8px', fontSize: '14px' }} />
              <button onClick={sendMessage} disabled={loading}
                style={{ padding: '12px 20px', background: '#0972d3', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>
                Send
              </button>
            </div>
          </div>
        )}

        {tab === 'local' && info && (
          <div style={{ background: '#fff', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>🗺️ Around You</h3>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '14px', color: '#4a5568' }}>{info.localInfo || 'Ask the assistant for local recommendations!'}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GuestApp() {
  const [authenticated, setAuthenticated] = useState(false);
  const [guest, setGuest] = useState(null);
  const [mode, setMode] = useState('airbnb');

  useEffect(() => {
    // Check if already authenticated
    try {
      const saved = JSON.parse(localStorage.getItem('guest-token'));
      if (saved?.valid) { setAuthenticated(true); setGuest(saved); }
    } catch {}
    // Detect mode from port
    const port = window.location.port;
    if (port === '3082') setMode('hotel');
  }, []);

  if (!authenticated) {
    return <GuestLogin mode={mode} onLogin={(data) => { setAuthenticated(true); setGuest(data); }} />;
  }

  return <GuestDashboard guest={guest} mode={mode} />;
}
