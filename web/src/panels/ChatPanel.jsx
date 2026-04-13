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
  const [image, setImage] = useState(null);
  const [recording, setRecording] = useState(false);
  const [history, setHistory] = useState([]);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceDevice, setVoiceDevice] = useState(null);
  const [voiceDevices, setVoiceDevices] = useState([]);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

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

  const send = async () => {
    if (!input.trim() && !image) return;
    const text = input || (image ? "Décris cette image." : '');
    setInput('');
    const msgObj = { role: 'user', text };
    if (image) msgObj.imagePreview = true;
    setMessages(m => [...m, msgObj]);
    setLoading(true);
    try {
      const body = { message: text };
      if (image) body.image = { base64: image.base64, mediaType: image.mediaType };
      if (voiceMode && voiceDevice) { body.voiceMode = true; body.voiceDevice = voiceDevice.value; }
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
      alert('Le microphone nécessite HTTPS. Ouvrez http://localhost:3080 depuis ce Mac, ou dans Chrome: chrome://flags/#unsafely-treat-insecure-origin-as-secure → ajoutez http://192.168.2.153:3080');
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
        setMessages(m => [...m, { role: 'user', text: '🎤 Message vocal...' }]);
        try {
          const reader = new FileReader();
          reader.onload = async () => {
            const res = await fetch(api + '/api/transcribe', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audio: reader.result.split(',')[1], format: 'webm' }),
            });
            const data = await res.json();
            if (data.text) {
              setMessages(m => { const u = [...m]; const li = u.findLastIndex(msg => msg.role === 'user'); if (li >= 0) u[li] = { role: 'user', text: '🎤 ' + data.text }; return u; });
              const voiceBody = { message: '[Voice message] ' + data.text };
              if (voiceMode && voiceDevice) { voiceBody.voiceMode = true; voiceBody.voiceDevice = voiceDevice.value; }
              const aiRes = await fetch(api + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(voiceBody) });
              const aiData = await aiRes.json();
              setMessages(m => [...m, { role: 'assistant', text: aiData.response || aiData.error }]);
              loadHistory();
            } else if (data.error) {
              setMessages(m => { const u = [...m]; const li = u.findLastIndex(msg => msg.role === 'user'); if (li >= 0) u[li] = { role: 'user', text: '🎤 (aucune parole détectée)' }; return u; });
              setMessages(m => [...m, { role: 'assistant', text: data.error }]);
            } else {
              setMessages(m => [...m, { role: 'assistant', text: 'Erreur transcription' }]);
            }
            setLoading(false);
          };
          reader.readAsDataURL(blob);
        } catch (err) { setMessages(m => [...m, { role: 'assistant', text: 'Erreur vocale: ' + err.message }]); setLoading(false); }
      };
      mediaRecRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (err) {
      if (err.message?.includes('mediaDevices') || err.name === 'TypeError') {
        alert('Le microphone nécessite HTTPS. Ouvrez http://localhost:3080 depuis ce Mac, ou dans Chrome: chrome://flags → unsafely-treat-insecure-origin-as-secure → ajoutez http://192.168.2.153:3080');
      } else {
        alert('Microphone non disponible: ' + err.message);
      }
    }
  };

  const stopRecording = () => { if (mediaRecRef.current?.state === 'recording') mediaRecRef.current.stop(); };

  const chatContent = (
    <Container>
      <SpaceBetween size="m">
        <div style={{ height: '65vh', overflowY: 'auto', padding: '8px' }}>
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
      {voiceDevices.length > 0 && (
        <SpaceBetween direction="horizontal" size="m">
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
        </SpaceBetween>
      )}
      <Tabs tabs={[
        { id: 'chat', label: 'Chat', content: chatContent },
        { id: 'history', label: 'Interactions (' + history.length + ')', content: historyContent },
      ]} />
    </SpaceBetween>
  );
}
