import { useState, useEffect } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Button from '@cloudscape-design/components/button';
import Icon from '@cloudscape-design/components/icon';

function formatUptime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return h + 'h ' + m + 'min';
  return m + 'min';
}

export default function DashboardPanel({ api, onNavigate }) {
  const [status, setStatus] = useState(null);
  const [kbs, setKbs] = useState([]);
  const [devices, setDevices] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    fetch(api + '/api/status').then(r => r.json()).then(setStatus).catch(() => {});
    fetch(api + '/api/knowledgebases').then(r => r.ok ? r.json() : {}).then(d => setKbs(d.knowledgebases || [])).catch(() => {});
    fetch(api + '/api/devices').then(r => r.ok ? r.json() : {}).then(d => setDevices(d.devices || [])).catch(() => {});
    fetch(api + '/api/history').then(r => r.ok ? r.json() : {}).then(d => setHistory(d.interactions || [])).catch(() => {});
  }, [api]);

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
              <Icon name="globe" />
              <StatusIndicator type="success">Dashboard</StatusIndicator>
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

        <Container header={<Header variant="h3">Appareils</Header>}>
          <SpaceBetween size="xs">
            {devices.length === 0 ? (
              <Box color="text-body-secondary">Aucun appareil détecté</Box>
            ) : devices.map(d => (
              <SpaceBetween key={d.bundle_id || d.name} direction="horizontal" size="xs">
                <Icon name="notification" />
                <Box>{d.name}</Box>
                <Box variant="small" color="text-body-secondary">{d.totalNotifications || 0} notifs</Box>
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
                <Icon name={h.direction === 'in' ? 'arrow-right' : 'arrow-left'} variant={h.direction === 'in' ? 'subtle' : 'success'} />
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
