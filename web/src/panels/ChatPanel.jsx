import { useState, useRef, useEffect, useCallback } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Tabs from '@cloudscape-design/components/tabs';
import Input from '@cloudscape-design/components/input';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Icon from '@cloudscape-design/components/icon';
import Toggle from '@cloudscape-design/components/toggle';
import Select from '@cloudscape-design/components/select';
import DatePicker from '@cloudscape-design/components/date-picker';

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'min';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'j';
}

// Session storage helpers
const SESSIONS_KEY = 'vertex-nova-chat-sessions';
const CURRENT_SESSION_KEY = 'vertex-nova-current-session';
const MAX_MESSAGES_PER_SESSION = 100;
const MAX_STORED_SESSIONS = 30;

function loadSessions() {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); } catch { return []; }
}

function saveSessions(sessions) {
  // Keep only the last MAX_STORED_SESSIONS
  const trimmed = sessions.slice(-MAX_STORED_SESSIONS);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed));
}

function loadCurrentSession() {
  try {
    const data = JSON.parse(localStorage.getItem(CURRENT_SESSION_KEY) || 'null');
    if (data && data.messages) return data;
  } catch {}
  return createNewSession();
}

function saveCurrentSession(session) {
  localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(session));
}

function createNewSession() {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    startedAt: Date.now(),
    messages: [],
    title: 'Nouvelle session',
  };
}

function sessionTitle(session) {
  if (!session.messages || session.messages.length === 0) return 'Session vide';
  const firstUser = session.messages.find(m => m.role === 'user');
  return firstUser ? firstUser.text.slice(0, 50) : 'Session';
}

export default function ChatPanel({ api }) {
  const [session, setSession] = useState(() => loadCurrentSession());
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState(null);
  const [recording, setRecording] = useState(false);
  const [history, setHistory] = useState([]);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceDevice, setVoiceDevice] = useState(null);
  const [voiceDevices, setVoiceDevices] = useState([]);
  const [showSessions, setShowSessions] = useState(false);
  const [sessions, setSessions] = useState(() => loadSessions());
  const [filterDate, setFilterDate] = useState('');
  const [currentUser, setCurrentUser] = useState(() => localStorage.getItem('vertex-nova-user') || '');
  const [familyMembers, setFamilyMembers] = useState([]);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);

  const messages = session.messages;

  // Persist session on every change
  useEffect(() => { saveCurrentSession(session); }, [session]);
  // Persist user selection
  useEffect(() => { if (currentUser) localStorage.setItem('vertex-nova-user', currentUser); }, [currentUser]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Load family members + presence for profile selector
  useEffect(() => {
    fetch(api + '/api/family/members').then(r => r.json()).then(data => {
      const members = data.members || [];
      setFamilyMembers(members);
      // Auto-select if only one person is home and no user is set
      if (!currentUser) {
        const homeMembers = members.filter(m => m.isHome);
        if (homeMembers.length === 1) {
          setCurrentUser(homeMembers[0].name);
        }
      }
    }).catch(() => {});
  }, [api]);

  // Load available voice devices (Echo + Sonos)
  useEffect(() => {
    Promise.all([
      fetch(api + '/api/alexa/echo-devices').then(r => r.ok ? r.json() : { devices: [] }).catch(() => ({ devices: [] })),
      fetch(api + '/api/models').then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]).then(([echoData, models]) => {
      const devs = [];
      for (const d of (echoData.devices || [])) {
        if (d.online) devs.push({ value: d.name, label: '🔊 ' + d.name + ' (Echo)' });
      }
      if (models.sonos_day_room) devs.push({ value: 'sonos:' + models.sonos_day_room, label: '🔈 ' + models.sonos_day_room + ' (Sonos)' });
      if (models.sonos_night_room && models.sonos_night_room !== models.sonos_day_room) devs.push({ value: 'sonos:' + models.sonos_night_room, label: '🔈 ' + models.sonos_night_room + ' (Sonos)' });
      setVoiceDevices(devs);
      if (devs.length > 0 && !voiceDevice) setVoiceDevice(devs[0]);
    });
  }, [api]);

  const loadHistory = useCallback(() => {
    fetch(api + '/api/history').then(r => r.json()).then(d => setHistory(d.interactions || [])).catch(() => {});
  }, [api]);
  useEffect(() => { loadHistory(); const iv = setInterval(loadHistory, 10000); return () => clearInterval(iv); }, [loadHistory]);

  // Archive current session and start a new one
  const newSession = () => {
    if (session.messages.length > 0) {
      const archived = { ...session, title: sessionTitle(session), endedAt: Date.now() };
      const updated = [...sessions, archived];
      setSessions(updated);
      saveSessions(updated);
    }
    const fresh = createNewSession();
    setSession(fresh);
  };

  // Restore a previous session (read-only view)
  const restoreSession = (s) => {
    setSession(s);
    setShowSessions(false);
  };

  const addMessage = (msg) => {
    setSession(prev => {
      const newMessages = [...prev.messages, msg];
      // Auto-archive if session gets too long
      if (newMessages.length >= MAX_MESSAGES_PER_SESSION) {
        const archived = { ...prev, messages: newMessages, title: sessionTitle({ messages: newMessages }), endedAt: Date.now() };
        const updated = [...sessions, archived];
        setSessions(updated);
        saveSessions(updated);
        return createNewSession();
      }
      return { ...prev, messages: newMessages };
    });
  };

  const send = async () => {
    if (!input.trim() && !image) return;
    const text = input || (image ? "Décris cette image." : '');

    if (!image && /image|photo|plan|document|fichier|pièce jointe/i.test(text)) {
      addMessage({ role: 'user', text, ts: Date.now() });
      addMessage({ role: 'assistant', text: 'Aucune image jointe. Cliquez d\'abord sur 📷 pour sélectionner une image, puis envoyez votre message.', ts: Date.now() });
      return;
    }

    setInput('');
    const msgObj = { role: 'user', text, ts: Date.now() };
    if (image) msgObj.imagePreview = true;
    addMessage(msgObj);
    setLoading(true);
    try {
      const body = { message: text };
      if (currentUser) body.userId = currentUser;
      if (image) body.image = { base64: image.base64, mediaType: image.mediaType };
      if (voiceMode && voiceDevice) { body.voiceMode = true; body.voiceDevice = voiceDevice.value; }
      const res = await fetch(api + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      addMessage({ role: 'assistant', text: data.response || data.error, ts: Date.now() });
      loadHistory();
    } catch (err) {
      addMessage({ role: 'assistant', text: 'Erreur: ' + err.message, ts: Date.now() });
    }
    setImage(null);
    setLoading(false);
  };

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImage({ base64: reader.result.split(',')[1], mediaType: file.type || 'image/jpeg', name: file.name, preview: reader.result });
    };
    reader.readAsDataURL(file);
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Le microphone nécessite HTTPS.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setRecording(false);
        setLoading(true);
        addMessage({ role: 'user', text: '🎤 Message vocal...', ts: Date.now() });
        try {
          const reader = new FileReader();
          reader.onload = async () => {
            const res = await fetch(api + '/api/transcribe', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audio: reader.result.split(',')[1], format: 'webm' }),
            });
            const data = await res.json();
            if (data.text) {
              setSession(prev => {
                const msgs = [...prev.messages];
                const li = msgs.findLastIndex(m => m.role === 'user');
                if (li >= 0) msgs[li] = { ...msgs[li], text: '🎤 ' + data.text };
                return { ...prev, messages: msgs };
              });
              const voiceBody = { message: '[Voice message] ' + data.text };
              if (currentUser) voiceBody.userId = currentUser;
              if (voiceMode && voiceDevice) { voiceBody.voiceMode = true; voiceBody.voiceDevice = voiceDevice.value; }
              const aiRes = await fetch(api + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(voiceBody) });
              const aiData = await aiRes.json();
              addMessage({ role: 'assistant', text: aiData.response || aiData.error, ts: Date.now() });
              loadHistory();
            } else if (data.error) {
              setSession(prev => {
                const msgs = [...prev.messages];
                const li = msgs.findLastIndex(m => m.role === 'user');
                if (li >= 0) msgs[li] = { ...msgs[li], text: '🎤 (aucune parole détectée)' };
                return { ...prev, messages: msgs };
              });
              addMessage({ role: 'assistant', text: data.error, ts: Date.now() });
            }
            setLoading(false);
          };
          reader.readAsDataURL(blob);
        } catch (err) { addMessage({ role: 'assistant', text: 'Erreur vocale: ' + err.message, ts: Date.now() }); setLoading(false); }
      };
      mediaRecRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (err) {
      alert('Microphone non disponible: ' + err.message);
    }
  };

  const stopRecording = () => { if (mediaRecRef.current?.state === 'recording') mediaRecRef.current.stop(); };

  // Filter sessions by date
  const filteredSessions = filterDate
    ? sessions.filter(s => new Date(s.startedAt).toISOString().slice(0, 10) === filterDate)
    : sessions;

  // Session picker panel
  const sessionPickerContent = (
    <Container header={
      <Header variant="h3" actions={
        <Button onClick={() => setShowSessions(false)} iconName="close">Fermer</Button>
      }>Sessions précédentes ({sessions.length})</Header>
    }>
      <SpaceBetween size="m">
        <DatePicker
          value={filterDate}
          onChange={({ detail }) => setFilterDate(detail.value)}
          placeholder="Filtrer par date"
          locale="fr-CA"
        />
        <div style={{ height: '60vh', overflowY: 'auto' }}>
          {filteredSessions.length === 0 ? (
            <Box textAlign="center" color="text-body-secondary" padding={{ top: 'l' }}>
              {filterDate ? 'Aucune session ce jour' : 'Aucune session archivée'}
            </Box>
          ) : (
            <SpaceBetween size="xs">
              {[...filteredSessions].reverse().map((s, i) => (
                <Container key={i} variant="stacked">
                  <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                    <Button variant="link" onClick={() => restoreSession(s)}>
                      {s.title || 'Session'}
                    </Button>
                    <Box variant="small" color="text-body-secondary">
                      {new Date(s.startedAt).toLocaleDateString('fr-CA')} {new Date(s.startedAt).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}
                      {' · '}{(s.messages || []).length} messages
                    </Box>
                  </SpaceBetween>
                </Container>
              ))}
            </SpaceBetween>
          )}
        </div>
      </SpaceBetween>
    </Container>
  );

  if (showSessions) return sessionPickerContent;

  const chatContent = (
    <Container header={
      <Header variant="h3" actions={
        <SpaceBetween direction="horizontal" size="xs">
          <Button onClick={() => setShowSessions(true)} iconName="calendar">Sessions ({sessions.length})</Button>
          <Button onClick={newSession} iconName="add-plus">Nouvelle</Button>
        </SpaceBetween>
      }>
        {session.messages.length > 0 ? sessionTitle(session).slice(0, 40) : 'Nouvelle conversation'}
      </Header>
    }>
      <SpaceBetween size="m">
        <div style={{ height: '60vh', overflowY: 'auto', padding: '8px' }}>
          {messages.length === 0 && (
            <Box textAlign="center" color="text-body-secondary" padding={{ top: 'xxl' }}>
              <Box variant="p" fontSize="heading-m">Vertex Nova</Box>
              <Box variant="p">Envoyez un message, une image ou un message vocal.</Box>
            </Box>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ textAlign: m.role === 'user' ? 'right' : 'left', marginBottom: '12px' }}>
              <Box variant="span" color={m.role === 'user' ? 'text-status-info' : 'text-body-secondary'} fontSize="body-s">
                {m.role === 'user' ? 'Vous' : 'Vertex Nova'}
                {m.ts && <span style={{ marginLeft: '8px', opacity: 0.6 }}>{new Date(m.ts).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}</span>}
              </Box>
              {m.imagePreview && (
                <div style={{ marginBottom: '4px' }}>
                  <StatusIndicator type="info">Image jointe</StatusIndicator>
                </div>
              )}
              <div style={{
                display: 'inline-block', maxWidth: '85%', padding: '10px 14px', borderRadius: '12px',
                background: m.role === 'user' ? '#0972d3' : '#1a1f2e',
                color: 'white', textAlign: 'left', fontSize: '14px', lineHeight: '1.5', whiteSpace: 'pre-wrap',
              }}>
                {m.text}
              </div>
            </div>
          ))}
          {loading && <div style={{ padding: '8px' }}><Spinner size="normal" /> Réflexion en cours...</div>}
          <div ref={bottomRef} />
        </div>

        {image && (
          <Container variant="stacked">
            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
              <img src={image.preview} alt="" style={{ height: '36px', borderRadius: '4px' }} />
              <Box variant="small">{image.name}</Box>
              <button onClick={() => setImage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}><Icon name="close" /></button>
            </SpaceBetween>
          </Container>
        )}

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />
          <Button variant="icon" iconName="upload" onClick={() => fileRef.current?.click()} ariaLabel="Image" />
          {recording
            ? <Button variant="icon" iconName="stop-circle" onClick={stopRecording} ariaLabel="Stop" />
            : <Button variant="icon" iconName="microphone" onClick={startRecording} ariaLabel="Vocal" />
          }
          <div style={{ flex: 1 }}>
            <Input
              value={input}
              onChange={({ detail }) => setInput(detail.value)}
              onKeyDown={({ detail }) => { if (detail.key === 'Enter' && !loading) send(); }}
              placeholder={recording ? 'Enregistrement...' : image ? "Décrivez l'image..." : 'Écrivez un message...'}
              disabled={recording}
            />
          </div>
          <Button variant="primary" iconName="send" onClick={send} loading={loading} disabled={loading || recording}>Envoyer</Button>
        </div>
      </SpaceBetween>
    </Container>
  );

  const historyContent = (
    <Container header={<Header variant="h3" counter={'(' + history.length + ')'}>Toutes les interactions</Header>}>
      <div style={{ height: '70vh', overflowY: 'auto' }}>
        {history.length === 0 ? (
          <Box textAlign="center" color="text-body-secondary" padding={{ top: 'l' }}>Aucune interaction récente</Box>
        ) : (
          <SpaceBetween size="xs">
            {history.map((h, i) => (
              <Container key={i} variant="stacked">
                <SpaceBetween size="xxs">
                  <SpaceBetween direction="horizontal" size="xs">
                    <StatusIndicator type={h.direction === 'in' ? 'info' : 'success'}>
                      <Icon name={h.channel === 'telegram' ? 'contact' : h.channel === 'whatsapp' ? 'call' : h.channel === 'web' ? 'globe' : h.channel === 'email-monitor' ? 'envelope' : 'notification'} />
                      {' ' + h.channel}
                    </StatusIndicator>
                    {h.hasImage && <StatusIndicator type="info"><Icon name="file" /></StatusIndicator>}
                    <Box variant="small" color="text-body-secondary">{timeAgo(h.ts)}</Box>
                  </SpaceBetween>
                  <Box variant="small" color={h.direction === 'in' ? 'text-body-secondary' : 'text-status-success'}>
                    <Icon name={h.direction === 'in' ? 'arrow-right' : 'arrow-left'} />
                    {' '}{h.text}
                  </Box>
                </SpaceBetween>
              </Container>
            ))}
          </SpaceBetween>
        )}
      </div>
    </Container>
  );

  return (
    <SpaceBetween size="s">
      <SpaceBetween direction="horizontal" size="m" alignItems="center">
        {familyMembers.length > 1 && (
          <Select
            selectedOption={currentUser ? { value: currentUser, label: '👤 ' + currentUser } : null}
            onChange={({ detail }) => setCurrentUser(detail.selectedOption.value)}
            options={familyMembers.map(m => ({
              value: m.name,
              label: (m.isHome ? '🟢 ' : '⚫ ') + m.name,
            }))}
            placeholder="Qui parle?"
          />
        )}
        {familyMembers.length <= 1 && currentUser && (
          <Box variant="small" color="text-body-secondary">👤 {currentUser}</Box>
        )}
        {voiceDevices.length > 0 && (
          <>
            <Toggle checked={voiceMode} onChange={({ detail }) => setVoiceMode(detail.checked)}>
            {voiceMode ? '🔊 Voix activée' : '🔇 Voix désactivée'}
          </Toggle>
          {voiceMode && (
            <Select
              selectedOption={voiceDevice}
              onChange={({ detail }) => setVoiceDevice(detail.selectedOption)}
              options={voiceDevices}
              placeholder="Appareil"
            />
          )}
          </>
        )}
      </SpaceBetween>
      <Tabs tabs={[
        { id: 'chat', label: 'Chat', content: chatContent },
        { id: 'history', label: 'Interactions (' + history.length + ')', content: historyContent },
      ]} />
    </SpaceBetween>
  );
}
