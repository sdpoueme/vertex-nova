import { useState, useEffect, useCallback } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Button from '@cloudscape-design/components/button';
import Textarea from '@cloudscape-design/components/textarea';
import Toggle from '@cloudscape-design/components/toggle';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

function timeAgo(ts) {
  if (!ts) return 'jamais';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'j';
}

export default function DevicesPanel({ api }) {
  const [devices, setDevices] = useState([]);
  const [settings, setSettings] = useState({ vocal_alerts: false });
  const [yaml, setYaml] = useState('');
  const [alert, setAlert] = useState(null);

  const load = useCallback(async () => {
    try {
      const [devRes, cfgRes] = await Promise.all([
        fetch(api + '/api/devices').then(r => r.ok ? r.json() : { devices: [], settings: {} }),
        fetch(api + '/api/devices/config').then(r => r.ok ? r.json() : { content: '' }),
      ]);
      setDevices(devRes.devices || []);
      setSettings(devRes.settings || { vocal_alerts: false });
      setYaml(cfgRes.content || '');
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      const res = await fetch(api + '/api/devices/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: yaml }),
      });
      if (!res.ok) { setAlert({ type: 'error', text: 'Erreur: ' + res.status }); return; }
      setAlert({ type: 'success', text: 'Configuration sauvegardée et rechargée' });
      load();
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const secColors = { critical: 'error', high: 'warning', medium: 'info', low: 'success' };
  const secLabels = { critical: 'Critique', high: 'Élevé', medium: 'Moyen', low: 'Bas' };

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}
      <ColumnLayout columns={2}>
        <SpaceBetween size="m">
          <Container header={<Header variant="h3">Appareils surveillés</Header>}>
            <SpaceBetween size="s">
              <Toggle checked={settings.vocal_alerts || false} disabled>
                Alertes vocales (Sonos/Echo) — {settings.vocal_alerts ? 'activées' : 'désactivées'}
              </Toggle>
              <Box variant="small" color="text-body-secondary">
                Modifier vocal_alerts dans le YAML pour activer les alertes vocales sur anomalies.
              </Box>
            </SpaceBetween>
          </Container>
          {devices.length === 0 && <Box color="text-body-secondary">Aucun appareil détecté. Les appareils apparaissent après la première notification.</Box>}
          {devices.map(d => (
            <Container key={d.bundle_id} header={
              <Header variant="h4">{d.icon + ' ' + d.name}</Header>
            }>
              <ColumnLayout columns={2}>
                <div>
                  <Box variant="awsui-key-label">Description</Box>
                  <Box>{d.description}</Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Niveau sécurité</Box>
                  <StatusIndicator type={secColors[d.security_level] || 'info'}>
                    {secLabels[d.security_level] || d.security_level}
                  </StatusIndicator>
                </div>
                <div>
                  <Box variant="awsui-key-label">Notifications totales</Box>
                  <Box>{d.totalNotifications || 0}</Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Dernière vue</Box>
                  <Box>{timeAgo(d.lastSeen)}</Box>
                </div>
              </ColumnLayout>
              {d.hourCounts && d.hourCounts.some(c => c > 0) && (
                <div style={{ marginTop: '8px' }}>
                  <Box variant="awsui-key-label">Activité par heure</Box>
                  <div style={{ display: 'flex', gap: '1px', height: '30px', alignItems: 'flex-end', marginTop: '4px' }}>
                    {d.hourCounts.map((c, h) => {
                      const max = Math.max(...d.hourCounts, 1);
                      const height = Math.max(2, (c / max) * 28);
                      const isNight = h >= 22 || h < 6;
                      return (
                        <div key={h} title={h + 'h: ' + c + ' notifications'} style={{
                          width: '12px', height: height + 'px',
                          background: c === 0 ? '#1a1f2e' : isNight ? '#d13212' : '#0972d3',
                          borderRadius: '1px',
                        }} />
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#6e7681', marginTop: '2px' }}>
                    <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
                  </div>
                </div>
              )}
            </Container>
          ))}
        </SpaceBetween>
        <Container header={
          <Header variant="h3" actions={<Button variant="primary" onClick={save}>Sauvegarder</Button>}>
            Configuration YAML
          </Header>
        }>
          <Textarea value={yaml} onChange={({ detail }) => setYaml(detail.value)} rows={30} />
        </Container>
      </ColumnLayout>
    </SpaceBetween>
  );
}
