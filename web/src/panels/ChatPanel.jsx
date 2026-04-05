import { useState, useRef, useEffect, useCallback } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Input from '@cloudscape-design/components/input';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

const CHANNEL_ICONS = { telegram: '💬', whatsapp: '📱', web: '🌐', 'alexa-ifttt': '🔊', 'email-monitor': '📧' };

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'min';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'j';
}

export default function ChatPanel({ api }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState(null); // { base64, mediaType, name }
  const [recording, setRecording] = useState(false);
  const [history, setHistory] = useState([]);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Load recent interactions
  const loadHistory = useCallback(() => {
    fetch(api + '/api/history').then(r => r.json()).then(d => setHistory(d.interactions || [])).catch(() => {});
  }, [api]);
  useEffect(() => { loadHistory(); const iv = setInterval(loadHistory, 10000); return () => clearInterval(iv); }, [loadHistory]);

  // Send message (text + optional image)
  const send = async () => {
    if (!input.trim() && !image) return;
    const text = input || (image ? "Décris cette image." : '');
    setInput('');
    const msgObj = { role: 'user', text };
    if (image) msgObj.imagePreview = 'data:' + image.mediaType + ';base64,' + image.base64.slice(0, 100);
    setMessages(m => [...m, msgObj]);
    setLoading(true);
    try {
      const body = { message: text };
      if (image) body.image = { base64: image.base64, mediaType: image.mediaType };
      const res = await fetch(api + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setMessages(m => [...m, { role: 'assistant', text: data.response || data.error }]);
      loadHistory();
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', text: 'Erreur: ' + err.message }]);
    }
    setImage(null);
    setLoading(false);
  };

  // Image upload
  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      const mediaType = file.type || 'image/jpeg';
      setImage({ base64, mediaType, name: file.name, preview: reader.result });
    };
    reader.readAsDataURL(file);
  };

  // Voice recording
  const startRecording = async () => {
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
        setMessages(m => [...m, { role: 'user', text: '🎤 Message vocal...' }]);
        try {
          // Send as base64 to a transcription endpoint
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = reader.result.split(',')[1];
            const res = await fetch(api + '/api/transcribe', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audio: base64, format: 'webm' }),
            });
            const data = await res.json();
            if (data.text) {
              // Update the voice message with transcription
              setMessages(m => {
                const updated = [...m];
                const lastUser = updated.findLastIndex(msg => msg.role === 'user');
                if (lastUser >= 0) updated[lastUser] = { role: 'user', text: '🎤 ' + data.text };
                return updated;
              });
              // Now send to AI
              const aiRes = await fetch(api + '/api/chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: '[Voice message] ' + data.text }),
              });
              const aiData = await aiRes.json();
              setMessages(m => [...m, { role: 'assistant', text: aiData.response || aiData.error }]);
              loadHistory();
            } else {
              setMessages(m => [...m, { role: 'assistant', text: 'Erreur transcription: ' + (data.error || 'échec') }]);
            }
            setLoading(false);
          };
          reader.readAsDataURL(blob);
        } catch (err) {
          setMessages(m => [...m, { role: 'assistant', text: 'Erreur vocale: ' + err.message }]);
          setLoading(false);
        }
      };
      mediaRecRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (err) {
      alert('Microphone non disponible: ' + err.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecRef.current && mediaRecRef.current.state === 'recording') {
      mediaRecRef.current.stop();
    }
  };

  return (
    <ColumnLayout columns={history.length > 0 ? 2 : 1} variant="text-grid">
      <Container header={<Header variant="h2">Chat</Header>}>
        <SpaceBetween size="m">
          <div style={{ height: '55vh', overflowY: 'auto', padding: '8px' }}>
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
                </Box>
                {m.imagePreview && (
                  <div style={{ marginBottom: '4px' }}>
                    <span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: '8px', background: '#0972d3', color: 'white', fontSize: '12px' }}>
                      📷 Image jointe
                    </span>
                  </div>
                )}
                <div style={{
                  display: 'inline-block', maxWidth: '80%', padding: '10px 14px', borderRadius: '12px',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', background: '#1a1f2e', borderRadius: '8px' }}>
              <img src={image.preview} alt="" style={{ height: '40px', borderRadius: '4px' }} />
              <span style={{ flex: 1, fontSize: '13px', color: '#8b949e' }}>{image.name}</span>
              <Button variant="icon" iconName="close" onClick={() => setImage(null)} />
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />
            <Button variant="icon" iconName="upload" onClick={() => fileRef.current?.click()} ariaLabel="Joindre une image" />
            {recording ? (
              <Button variant="icon" iconName="close" onClick={stopRecording} ariaLabel="Arrêter l'enregistrement">
                <span style={{ color: '#ff4444' }}>⏹</span>
              </Button>
            ) : (
              <Button variant="icon" iconName="microphone" onClick={startRecording} ariaLabel="Message vocal" />
            )}
            <div style={{ flex: 1 }}>
              <Input
                value={input}
                onChange={({ detail }) => setInput(detail.value)}
                onKeyDown={({ detail }) => { if (detail.key === 'Enter' && !loading) send(); }}
                placeholder={image ? "Décrivez l'image ou envoyez..." : recording ? '🔴 Enregistrement...' : 'Écrivez un message...'}
                disabled={recording}
              />
            </div>
            <Button variant="primary" onClick={send} loading={loading} disabled={recording}>Envoyer</Button>
          </div>
        </SpaceBetween>
      </Container>

      {history.length > 0 && (
        <Container header={<Header variant="h3">Interactions récentes</Header>}>
          <div style={{ height: '62vh', overflowY: 'auto' }}>
            <SpaceBetween size="xs">
              {history.map((h, i) => (
                <div key={i} style={{
                  padding: '8px 10px', borderRadius: '6px',
                  background: h.direction === 'in' ? '#0d1117' : '#161b22',
                  borderLeft: '3px solid ' + (h.direction === 'in' ? '#0972d3' : '#238636'),
                  fontSize: '12px', lineHeight: '1.4',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ color: '#8b949e' }}>
                      {(CHANNEL_ICONS[h.channel] || '💬') + ' ' + h.channel}
                      {h.hasImage ? ' 📷' : ''}
                    </span>
                    <span style={{ color: '#6e7681' }}>{timeAgo(h.ts)}</span>
                  </div>
                  <div style={{ color: h.direction === 'in' ? '#c9d1d9' : '#7ee787', wordBreak: 'break-word' }}>
                    {h.direction === 'in' ? '→ ' : '← '}
                    {h.text}
                  </div>
                </div>
              ))}
            </SpaceBetween>
          </div>
        </Container>
      )}
    </ColumnLayout>
  );
}
