import { useState, useEffect } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Button from '@cloudscape-design/components/button';
import Icon from '@cloudscape-design/components/icon';

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

export default function DashboardPanel({ api, onNavigate }) {
  const [status, setStatus] = useState(null);
  const [kbs, setKbs] = useState([]);
  const [alexaDevices, setAlexaDevices] = useState([]);
  const [deviceStates, setDeviceStates] = useState([]);
  const [history, setHistory] = useState([]);
  const [emails, setEmails] = useState(null);

  useEffect(() => {
    fetch(api + '/api/status').then(r => r.json()).then(setStatus).catch(() => {});
    fetch(api + '/api/knowledgebases').then(r => r.ok ? r.json() : {}).then(d => setKbs(d.knowledgebases || [])).catch(() => {});
    fetch(api + '/api/alexa/discovered').then(r => r.ok ? r.json() : {}).then(d => setAlexaDevices((d.devices || []).filter(x => !SKIP_CATS.has(x.category)))).catch(() => {});
    fetch(api + '/api/alexa/states').then(r => r.ok ? r.json() : {}).then(d => setDeviceStates(d.devices || [])).catch(() => {});
    fetch(api + '/api/history').then(r => r.ok ? r.json() : {}).then(d => setHistory(d.interactions || [])).catch(() => {});
  }, [api]);

  // Auto-refresh device states every 30s
  useEffect(() => {
    const t = setInterval(() => {
      fetch(api + '/api/alexa/states').then(r => r.ok ? r.json() : {}).then(d => setDeviceStates(d.devices || [])).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [api]);

  // Merge discovered devices with their live states
  const devicesWithState = alexaDevices.map(d => {
    const state = deviceStates.find(s => s.friendlyName === d.friendlyName);
    return { ...d, capabilities: state?.capabilities || {}, hasState: state?.hasState || false };
  });

  // Separate security-critical devices from others for priority display
  const securityDevices = devicesWithState.filter(d => ['SECURITY_PANEL', 'SMARTLOCK', 'CAMERA'].includes(d.category));
  const applianceDevices = devicesWithState.filter(d => ['WASHER', 'DRYER', 'OVEN'].includes(d.category));
  const otherDevices = devicesWithState.filter(d => !['SECURITY_PANEL', 'SMARTLOCK', 'CAMERA', 'WASHER', 'DRYER', 'OVEN'].includes(d.category));

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

      {/* Devices widget — the main info panel */}
      {devicesWithState.length > 0 && (
        <Container header={
          <Header variant="h3" counter={'(' + devicesWithState.length + ')'} actions={
            <Button variant="link" onClick={() => onNavigate('devices')}>Voir tout</Button>
          }>Appareils connectés</Header>
        }>
          <SpaceBetween size="m">
            {/* Security devices — always shown first with prominent status */}
            {securityDevices.length > 0 && (
              <Box>
                <Box variant="awsui-key-label" padding={{ bottom: 'xs' }}>Sécurité</Box>
                <ColumnLayout columns={Math.min(securityDevices.length, 3)}>
                  {securityDevices.map((d, i) => {
                    const caps = Object.entries(d.capabilities).filter(([k]) => !k.includes('EndpointHealth'));
                    const statusBadge = caps.map(([k, v]) => formatCapShort(k, v)).filter(Boolean).join(' ') || '—';
                    return (
                      <Box key={i} padding="xs">
                        <SpaceBetween size="xxs">
                          <Box variant="h4">{(CAT_ICONS[d.category] || '🔒') + ' ' + d.friendlyName}</Box>
                          <Box fontSize="heading-l">{statusBadge}</Box>
                        </SpaceBetween>
                      </Box>
                    );
                  })}
                </ColumnLayout>
              </Box>
            )}

            {/* Appliances — washer, dryer, oven with power status */}
            {applianceDevices.length > 0 && (
              <Box>
                <Box variant="awsui-key-label" padding={{ bottom: 'xs' }}>Électroménagers</Box>
                <ColumnLayout columns={Math.min(applianceDevices.length, 3)}>
                  {applianceDevices.map((d, i) => {
                    const power = d.capabilities['Alexa.PowerController.powerState'];
                    const isOn = power === 'ON';
                    return (
                      <Box key={i} padding="xs">
                        <SpaceBetween size="xxs">
                          <Box variant="h4">{(CAT_ICONS[d.category] || '📱') + ' ' + d.friendlyName}</Box>
                          <StatusIndicator type={isOn ? 'in-progress' : 'stopped'}>
                            {isOn ? 'En marche' : power === 'OFF' ? 'Éteint' : 'En attente'}
                          </StatusIndicator>
                        </SpaceBetween>
                      </Box>
                    );
                  })}
                </ColumnLayout>
              </Box>
            )}

            {/* Other devices — plugs, switches, fridge */}
            {otherDevices.length > 0 && (
              <Box>
                <Box variant="awsui-key-label" padding={{ bottom: 'xs' }}>Autres appareils</Box>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  {otherDevices.map((d, i) => {
                    const caps = Object.entries(d.capabilities).filter(([k]) => !k.includes('EndpointHealth'));
                    const badge = caps.map(([k, v]) => formatCapShort(k, v)).filter(Boolean).join(' ');
                    return (
                      <Box key={i} padding="xs">
                        <SpaceBetween direction="horizontal" size="xs">
                          <Box>{(CAT_ICONS[d.category] || '📱') + ' ' + d.friendlyName}</Box>
                          {badge && <Box>{badge}</Box>}
                        </SpaceBetween>
                      </Box>
                    );
                  })}
                </div>
              </Box>
            )}
          </SpaceBetween>
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

        <Container header={<Header variant="h3">Alexa</Header>}>
          <SpaceBetween size="xs">
            <StatusIndicator type={alexaDevices.length > 0 ? 'success' : 'warning'}>
              {alexaDevices.length > 0 ? alexaDevices.length + ' appareils' : 'Non connecté'}
            </StatusIndicator>
            {alexaDevices.length > 0 && (
              <Box variant="small" color="text-body-secondary">
                {securityDevices.length > 0 && securityDevices.length + ' sécurité · '}
                {applianceDevices.length + ' électro · '}
                {otherDevices.length + ' autres'}
              </Box>
            )}
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
