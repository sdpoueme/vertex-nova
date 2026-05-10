import { useState, useEffect } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Button from '@cloudscape-design/components/button';
import Icon from '@cloudscape-design/components/icon';
import Alert from '@cloudscape-design/components/alert';

const SKIP_CATS = new Set(['ALEXA_VOICE_ENABLED', 'TV', 'GAME_CONSOLE', 'SPEAKERS', 'PRINTER']);
const CAT_ICONS = { WASHER: '👕', DRYER: '👕', THERMOSTAT: '🌡️', SMARTLOCK: '🔐', SECURITY_PANEL: '🔒', CAMERA: '📹', LIGHT: '💡', SMARTPLUG: '🔌', SWITCH: '🔌', OVEN: '🍳', OTHER: '📱', DOORBELL: '🔔', GARAGE_DOOR: '🚗' };

function formatUptime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 24) return Math.floor(h / 24) + 'j ' + (h % 24) + 'h';
  if (h > 0) return h + 'h ' + m + 'min';
  return m + 'min';
}

function formatCapShort(key, val) {
  if (key.includes('powerState')) return val === 'ON' ? '🟢' : '⚫';
  if (key.includes('lockState')) return val === 'LOCKED' ? '🔒' : '🔓';
  if (key.includes('armState')) {
    if (val === 'ARMED_AWAY' || val === 'ARMED_STAY') return '🔒';
    return '🔓';
  }
  if (key.includes('detectionState')) return val === 'DETECTED' ? '🔴' : '🟢';
  if (key.includes('temperature') || key.includes('Setpoint')) {
    const t = typeof val === 'object' ? val.value : val;
    return t != null ? t + '°' : '';
  }
  if (key.includes('connectivity')) {
    const v = typeof val === 'object' ? val.value : val;
    return v === 'OK' ? '🟢' : '🔴';
  }
  return '';
}

function PresenceWidget({ api }) {
  const [presence, setPresence] = useState(null);
  useEffect(() => {
    const load = () => fetch(api + '/api/presence').then(r => r.ok ? r.json() : null).then(setPresence).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [api]);

  if (!presence || (presence.home?.length === 0 && presence.away?.length === 0)) {
    return <Box variant="small" color="text-body-secondary">Non configuré</Box>;
  }
  return (
    <SpaceBetween size="xs">
      {presence.vacationMode && <StatusIndicator type="warning">Mode vacances</StatusIndicator>}
      {(presence.home || []).map(name => (
        <SpaceBetween key={name} direction="horizontal" size="xs">
          <StatusIndicator type="success">{name}</StatusIndicator>
          <Box variant="small" color="text-body-secondary">a la maison</Box>
        </SpaceBetween>
      ))}
      {(presence.away || []).map(name => (
        <SpaceBetween key={name} direction="horizontal" size="xs">
          <StatusIndicator type="stopped">{name}</StatusIndicator>
          <Box variant="small" color="text-body-secondary">absent</Box>
        </SpaceBetween>
      ))}
    </SpaceBetween>
  );
}

// ============================================================
// Hospitality Dashboard — shown in airbnb/hotel mode
// ============================================================
function HospitalityDashboard({ api, onNavigate, mode }) {
  const [status, setStatus] = useState(null);
  const [hospStatus, setHospStatus] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    fetch(api + '/api/status').then(r => r.json()).then(setStatus).catch(() => {});
    fetch(api + '/api/hospitality').then(r => r.json()).then(setHospStatus).catch(() => {});
    fetch(api + '/api/history').then(r => r.ok ? r.json() : {}).then(d => {
      const adminOnly = (d.interactions || []).filter(h => h.channel !== 'guest' && !h.channel?.startsWith('guest-'));
      setHistory(adminOnly);
    }).catch(() => {});
    if (mode === 'hotel') {
      fetch(api + '/api/hospitality/hotel/rooms').then(r => r.json()).then(d => setRooms(d.rooms || [])).catch(() => {});
    }
  }, [api, mode]);

  const occupied = rooms.filter(r => r.guest).length;
  const portalPort = mode === 'airbnb' ? '3081' : '3082';
  const guest = hospStatus?.airbnb?.guest;

  const nightsLeft = (checkOut) => {
    if (!checkOut) return null;
    const diff = Math.ceil((new Date(checkOut) - new Date()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
  };

  const today = new Date().toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <SpaceBetween size="l">
      {/* Header with date */}
      <Header variant="h1" description={today}>
        {mode === 'airbnb' ? 'Vertex Nova — Airbnb' : 'Vertex Nova — Hôtel'}
      </Header>

      {/* Key metrics row */}
      <ColumnLayout columns={mode === 'hotel' ? 4 : 3}>
        <Container>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Système</Box>
            <StatusIndicator type={status?.ollama ? 'success' : 'error'}>
              {status?.ollama ? 'En ligne' : 'Hors ligne'}
            </StatusIndicator>
            <Box variant="small" color="text-body-secondary">{formatUptime(status?.uptime)}</Box>
          </SpaceBetween>
        </Container>
        <Container>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Portail invité</Box>
            <StatusIndicator type="success">Actif</StatusIndicator>
            <Box variant="small">
              <a href={'https://' + window.location.hostname + ':' + portalPort} target="_blank" rel="noreferrer">
                Port {portalPort} ↗
              </a>
            </Box>
          </SpaceBetween>
        </Container>
        {mode === 'hotel' && (
          <Container>
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Agent IA</Box>
              <Box variant="small"><strong>Modèle actif:</strong> {status?.model || '—'}</Box>
              <Box variant="small"><strong>Proactif:</strong> {status?.proactive ? 'Actif' : 'Inactif'}</Box>
              <Box variant="small"><strong>Interactions:</strong> {history.length} aujourd'hui</Box>
            </SpaceBetween>
          </Container>
        )}
        <Container>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Confidentialité</Box>
            <SpaceBetween direction="horizontal" size="xxs">
              <Icon name="lock-private" />
              <Box variant="small">Conversations isolées</Box>
            </SpaceBetween>
          </SpaceBetween>
        </Container>
      </ColumnLayout>

      {/* HOTEL: Room occupancy cards */}
      {mode === 'hotel' && rooms.length > 0 && (
        <Container header={
          <Header variant="h3" counter={'(' + occupied + '/' + rooms.length + ')'} actions={
            <Button onClick={() => onNavigate('config')} iconName="settings">Gérer les chambres</Button>
          }>
            Chambres
          </Header>
        }>
          <SpaceBetween size="m">
            <div style={{ display: 'flex', gap: '4px', height: '10px', borderRadius: '5px', overflow: 'hidden' }}>
              {rooms.map(room => (
                <div key={room.id} style={{ flex: 1, background: room.guest ? '#0972d3' : '#e9ebed', borderRadius: '3px' }} title={room.name} />
              ))}
            </div>
            <ColumnLayout columns={rooms.length}>
              {rooms.map(room => {
                const nights = room.guest ? nightsLeft(room.guest.checkOut) : null;
                return (
                  <Container key={room.id}>
                    <SpaceBetween size="xxs">
                      <Box textAlign="center">
                        <StatusIndicator type={room.guest ? 'success' : 'stopped'}>{room.name}</StatusIndicator>
                      </Box>
                      {room.guest ? (
                        <SpaceBetween size="xxxs">
                          <Box textAlign="center" variant="small" fontWeight="bold">
                            <Icon name="user-profile" /> {room.guest.name}
                          </Box>
                          <Box textAlign="center" variant="small" color="text-body-secondary">
                            {room.guest.checkIn} → {room.guest.checkOut || '—'}
                          </Box>
                          {nights !== null && (
                            <Box textAlign="center">
                              <StatusIndicator type={nights <= 1 ? 'warning' : 'info'}>
                                {nights === 0 ? 'Checkout aujourd\'hui' : nights + ' nuit' + (nights > 1 ? 's' : '')}
                              </StatusIndicator>
                            </Box>
                          )}
                        </SpaceBetween>
                      ) : (
                        <Box textAlign="center" variant="small" color="text-body-secondary" padding="s">
                          Libre
                        </Box>
                      )}
                    </SpaceBetween>
                  </Container>
                );
              })}
            </ColumnLayout>
            {rooms.some(r => r.guest && nightsLeft(r.guest.checkOut) === 0) && (
              <Alert type="warning">
                Un ou plusieurs invités ont un checkout prévu aujourd'hui.
              </Alert>
            )}
          </SpaceBetween>
        </Container>
      )}

      {/* AIRBNB: Invité card */}
      {mode === 'airbnb' && (
        <Container header={
          <Header variant="h3" actions={
            <Button onClick={() => onNavigate('config')} iconName="settings">Gérer l'invité</Button>
          }>
            Invité actuel
          </Header>
        }>
          {guest?.name ? (
            <SpaceBetween size="m">
              <ColumnLayout columns={3}>
                <SpaceBetween size="xxs">
                  <Box variant="awsui-key-label">Nom</Box>
                  <Box><Icon name="user-profile" /> {guest.name}</Box>
                </SpaceBetween>
                <SpaceBetween size="xxs">
                  <Box variant="awsui-key-label">Langue</Box>
                  <Box>{guest.language === 'auto' ? 'Auto-détection' : guest.language}</Box>
                </SpaceBetween>
                <SpaceBetween size="xxs">
                  <Box variant="awsui-key-label">Séjour</Box>
                  <Box>{guest.checkIn || '—'} → {guest.checkOut || '—'}</Box>
                </SpaceBetween>
              </ColumnLayout>
              {guest.checkOut && (
                <Box>
                  {(() => {
                    const days = nightsLeft(guest.checkOut);
                    if (days === 0) return <StatusIndicator type="warning">Checkout aujourd'hui</StatusIndicator>;
                    if (days !== null && days <= 2) return <StatusIndicator type="info">{days} jour{days > 1 ? 's' : ''} restant{days > 1 ? 's' : ''}</StatusIndicator>;
                    return <StatusIndicator type="success">Séjour en cours</StatusIndicator>;
                  })()}
                </Box>
              )}
              <SpaceBetween direction="horizontal" size="xs">
                <StatusIndicator type={hospStatus?.airbnb?.hasCode ? 'success' : 'warning'}>
                  {hospStatus?.airbnb?.hasCode ? 'Code actif' : 'Pas de code'}
                </StatusIndicator>
              </SpaceBetween>
            </SpaceBetween>
          ) : (
            <Box textAlign="center" padding="l" color="text-body-secondary">
              <SpaceBetween size="s">
                <Box variant="p">Aucun invité enregistré</Box>
                <Button onClick={() => onNavigate('config')} iconName="add-plus">Configurer un invité</Button>
              </SpaceBetween>
            </Box>
          )}
        </Container>
      )}

      {/* Admin activity log */}
      <Container header={
        <Header variant="h3" counter={'(' + history.length + ')'} description="Conversations invité non visibles">
          Activité admin
        </Header>
      }>
        {history.length === 0 ? (
          <Box color="text-body-secondary" textAlign="center" padding="l">
            Aucune interaction admin récente
          </Box>
        ) : (
          <SpaceBetween size="xs">
            {history.slice(0, 5).map((h, i) => (
              <SpaceBetween key={i} direction="horizontal" size="xs">
                <Icon name={h.direction === 'in' ? 'arrow-right' : 'arrow-left'} />
                <Box variant="small" color="text-body-secondary">{h.channel}</Box>
                <Box variant="small">{(h.text || '').slice(0, 100)}</Box>
              </SpaceBetween>
            ))}
          </SpaceBetween>
        )}
      </Container>

      {/* Quick actions */}
      <ColumnLayout columns={2}>
        <Button variant="primary" onClick={() => onNavigate('chat')} iconName="contact" fullWidth>Chat admin</Button>
        <Button onClick={() => onNavigate('config')} iconName="settings" fullWidth>Configuration</Button>
      </ColumnLayout>
    </SpaceBetween>
  );
}

// ============================================================
// Residence Dashboard — full family view
// ============================================================
export default function DashboardPanel({ api, onNavigate, mode }) {
  // All hooks must be called unconditionally (React rules of hooks)
  const [status, setStatus] = useState(null);
  const [kbs, setKbs] = useState([]);
  const [alexaDevices, setAlexaDevices] = useState([]);
  const [deviceStates, setDeviceStates] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (mode === 'airbnb' || mode === 'hotel') return; // Skip for hospitality mode
    fetch(api + '/api/status').then(r => r.json()).then(setStatus).catch(() => {});
    fetch(api + '/api/knowledgebases').then(r => r.ok ? r.json() : {}).then(d => setKbs(d.knowledgebases || [])).catch(() => {});
    fetch(api + '/api/alexa/discovered').then(r => r.ok ? r.json() : {}).then(d => setAlexaDevices((d.devices || []).filter(x => !SKIP_CATS.has(x.category)))).catch(() => {});
    fetch(api + '/api/alexa/states').then(r => r.ok ? r.json() : {}).then(d => setDeviceStates(d.devices || [])).catch(() => {});
    fetch(api + '/api/history').then(r => r.ok ? r.json() : {}).then(d => setHistory(d.interactions || [])).catch(() => {});
  }, [api, mode]);

  useEffect(() => {
    if (mode === 'airbnb' || mode === 'hotel') return;
    const t = setInterval(() => {
      fetch(api + '/api/alexa/states').then(r => r.ok ? r.json() : {}).then(d => setDeviceStates(d.devices || [])).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [api, mode]);

  // If in hospitality mode, show the hospitality dashboard
  if (mode === 'airbnb' || mode === 'hotel') {
    return <HospitalityDashboard api={api} onNavigate={onNavigate} mode={mode} />;
  }

  const devicesWithState = alexaDevices.map(d => {
    const state = deviceStates.find(s => s.friendlyName === d.friendlyName);
    return { ...d, capabilities: state?.capabilities || {}, hasState: state?.hasState || false };
  });

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description="Assistant maison intelligent">Vertex Nova</Header>

      <ColumnLayout columns={4}>
        <Container>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Statut</Box>
            <StatusIndicator type={status?.ollama ? 'success' : 'error'}>
              {status?.ollama ? 'En ligne' : 'Hors ligne'}
            </StatusIndicator>
          </SpaceBetween>
        </Container>
        <Container>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Modèle</Box>
            <Box variant="p">{status?.model || '—'}</Box>
          </SpaceBetween>
        </Container>
        <Container>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Uptime</Box>
            <Box variant="p">{formatUptime(status?.uptime)}</Box>
          </SpaceBetween>
        </Container>
        <Container>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Mémoire</Box>
            <Box variant="p">{status?.memory || '—'}</Box>
          </SpaceBetween>
        </Container>
      </ColumnLayout>

      {devicesWithState.length > 0 && (
        <Container header={
          <Header variant="h3" actions={<Button variant="link" onClick={() => onNavigate('devices')}>Détails</Button>}>
            Appareils ({devicesWithState.length})
          </Header>
        }>
          <ColumnLayout columns={3}>
            {devicesWithState.map((d, i) => {
              const caps = Object.entries(d.capabilities).filter(([k]) => !k.includes('EndpointHealth'));
              const badge = caps.map(([k, v]) => formatCapShort(k, v)).filter(Boolean).join(' ');
              const isSecurity = ['SECURITY_PANEL', 'SMARTLOCK', 'CAMERA'].includes(d.category);
              return (
                <SpaceBetween key={i} direction="horizontal" size="xs">
                  <Box>{CAT_ICONS[d.category] || '📱'}</Box>
                  <Box>
                    <Box variant="small">{d.friendlyName}</Box>
                    {badge && <Box variant="small" color="text-body-secondary">{badge}</Box>}
                  </Box>
                  {isSecurity && <StatusIndicator type="warning" />}
                </SpaceBetween>
              );
            })}
          </ColumnLayout>
        </Container>
      )}

      <ColumnLayout columns={3}>
        <Container header={<Header variant="h3">Canaux</Header>}>
          <SpaceBetween size="xs">
            <SpaceBetween direction="horizontal" size="xs">
              <Icon name="contact" />
              <StatusIndicator type={status?.telegram ? 'success' : 'stopped'}>Telegram</StatusIndicator>
            </SpaceBetween>
            <SpaceBetween direction="horizontal" size="xs">
              <Icon name="call" />
              <StatusIndicator type={status?.whatsapp ? 'success' : 'stopped'}>WhatsApp</StatusIndicator>
            </SpaceBetween>
            <SpaceBetween direction="horizontal" size="xs">
              <Icon name="audio-full" />
              <StatusIndicator type={status?.sonos ? 'success' : 'stopped'}>Sonos</StatusIndicator>
            </SpaceBetween>
            <SpaceBetween direction="horizontal" size="xs">
              <Icon name="envelope" />
              <StatusIndicator type={status?.email ? 'success' : 'stopped'}>Email</StatusIndicator>
            </SpaceBetween>
          </SpaceBetween>
        </Container>

        <Container header={<Header variant="h3">Présence</Header>}>
          <PresenceWidget api={api} />
        </Container>

        <Container header={<Header variant="h3">Connaissances</Header>}>
          <SpaceBetween size="xs">
            {kbs.length === 0 ? (
              <Box color="text-body-secondary">Aucune base configurée</Box>
            ) : kbs.map(kb => (
              <SpaceBetween key={kb.name} direction="horizontal" size="xs">
                <Icon name="file" />
                <StatusIndicator type={kb.synced ? 'success' : 'warning'}>{kb.name}</StatusIndicator>
                <Box variant="small" color="text-body-secondary">{kb.chunks || 0} chunks</Box>
              </SpaceBetween>
            ))}
          </SpaceBetween>
        </Container>
      </ColumnLayout>

      <Container header={<Header variant="h3" counter={'(' + history.length + ')'}>Dernières interactions</Header>}>
        {history.length === 0 ? (
          <Box color="text-body-secondary">Aucune interaction récente</Box>
        ) : (
          <SpaceBetween size="xs">
            {history.slice(0, 8).map((h, i) => (
              <SpaceBetween key={i} direction="horizontal" size="xs">
                <Icon name={h.direction === 'in' ? 'arrow-right' : 'arrow-left'} />
                <Box variant="small" color="text-body-secondary">{h.channel}</Box>
                <Box variant="small">{(h.text || '').slice(0, 120)}</Box>
              </SpaceBetween>
            ))}
          </SpaceBetween>
        )}
      </Container>

      <ColumnLayout columns={3}>
        <Button variant="primary" onClick={() => onNavigate('chat')} iconName="contact">Ouvrir le chat</Button>
        <Button onClick={() => onNavigate('config')} iconName="settings">Configuration</Button>
        <Button onClick={() => onNavigate('logs')} iconName="script">Voir les logs</Button>
      </ColumnLayout>
    </SpaceBetween>
  );
}
