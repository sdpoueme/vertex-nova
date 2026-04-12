import { useState, useEffect, useCallback } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Button from '@cloudscape-design/components/button';
import Textarea from '@cloudscape-design/components/textarea';
import Toggle from '@cloudscape-design/components/toggle';
import Select from '@cloudscape-design/components/select';
import Input from '@cloudscape-design/components/input';
import FormField from '@cloudscape-design/components/form-field';
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

function groupDevices(devices) {
  const groups = {};
  for (const d of devices) {
    if (!groups[d.name]) {
      groups[d.name] = { ...d, bundleIds: [d.bundle_id], totalNotifications: d.totalNotifications || 0, hourCounts: [...(d.hourCounts || new Array(24).fill(0))] };
    } else {
      groups[d.name].bundleIds.push(d.bundle_id);
      groups[d.name].totalNotifications += (d.totalNotifications || 0);
      if (d.lastSeen && (!groups[d.name].lastSeen || d.lastSeen > groups[d.name].lastSeen)) groups[d.name].lastSeen = d.lastSeen;
      if (d.hourCounts) { for (let h = 0; h < 24; h++) groups[d.name].hourCounts[h] += (d.hourCounts[h] || 0); }
    }
  }
  return Object.values(groups);
}

function parseDevicesYaml(text) {
  const result = { vocal_alerts: false, poll_interval_seconds: 30, devices: [] };
  const vm = text.match(/vocal_alerts:\s*(true|false)/);
  if (vm) result.vocal_alerts = vm[1] === 'true';
  const pm = text.match(/poll_interval_seconds:\s*(\d+)/);
  if (pm) result.poll_interval_seconds = parseInt(pm[1]);

  const blocks = text.split(/^\s+-\s+bundle_id:/m);
  for (let i = 1; i < blocks.length; i++) {
    const b = '  - bundle_id:' + blocks[i];
    const bundleId = (b.match(/bundle_id:\s*(\S+)/) || [])[1]?.trim() || '';
    const name = (b.match(/name:\s*(.+)/) || [])[1]?.trim() || '';
    const icon = (b.match(/icon:\s*"([^"]*)"/) || [])[1] || '📱';
    const desc = (b.match(/description:\s*"([^"]*)"/) || [])[1] || '';
    const secLevel = (b.match(/security_level:\s*(\S+)/) || [])[1]?.trim() || 'low';
    const context = (b.match(/context:\s*"([^"]*)"/) || [])[1] || '';
    const enabled = (b.match(/enabled:\s*(\S+)/) || [])[1]?.trim() !== 'false';
    const hm = b.match(/normal_hours:\s*\[([^\]]*)\]/);
    const normalHours = hm ? hm[1].split(',').map(h => parseInt(h.trim())).filter(h => !isNaN(h)) : [];
    // Parse sources
    const sources = [];
    const srcParts = b.split(/- type:/g);
    for (let si = 1; si < srcParts.length; si++) {
      const sb = '- type:' + srcParts[si];
      const sType = (sb.match(/type:\s*(\S+)/) || [])[1]?.trim() || '';
      const sFrom = (sb.match(/from:\s*"([^"]*)"/) || [])[1] || '';
      const sToken = (sb.match(/token:\s*"([^"]*)"/) || [])[1] || '';
      const kwm = sb.match(/keywords:\s*\[([^\]]*)\]/);
      const sKw = kwm ? kwm[1].split(',').map(k => k.trim().replace(/"/g, '')) : [];
      if (sType) sources.push({ type: sType, from: sFrom, token: sToken, keywords: sKw });
    }
    if (bundleId) result.devices.push({ bundle_id: bundleId, name, icon, description: desc, security_level: secLevel, normal_hours: normalHours, context, enabled, sources });
  }
  return result;
}

function buildDevicesYaml(data) {
  let y = '# Vertex Nova — Device Notification Monitoring\n\nsettings:\n';
  y += '  vocal_alerts: ' + data.vocal_alerts + '\n';
  y += '  poll_interval_seconds: ' + data.poll_interval_seconds + '\n\ndevices:\n';
  for (const d of data.devices) {
    y += '  - bundle_id: ' + d.bundle_id + '\n';
    y += '    name: ' + d.name + '\n';
    y += '    icon: "' + d.icon + '"\n';
    y += '    description: "' + (d.description || '').replace(/"/g, '\\"') + '"\n';
    y += '    security_level: ' + d.security_level + '\n';
    y += '    normal_hours: [' + (d.normal_hours || []).join(',') + ']\n';
    y += '    context: "' + (d.context || '').replace(/"/g, '\\"') + '"\n';
    if (d.sources && d.sources.length > 0) {
      y += '    sources:\n';
      for (const s of d.sources) {
        y += '      - type: ' + s.type + '\n';
        if (s.type === 'email') {
          if (s.from) y += '        from: "' + s.from + '"\n';
          if (s.keywords?.length) y += '        keywords: ["' + s.keywords.join('", "') + '"]\n';
        }
        if (s.type === 'webhook' && s.token) y += '        token: "' + s.token + '"\n';
      }
    }
    y += '    enabled: ' + d.enabled + '\n\n';
  }
  return y;
}

const SEC_OPTIONS = [
  { value: 'critical', label: 'Critique' },
  { value: 'high', label: 'Élevé' },
  { value: 'medium', label: 'Moyen' },
  { value: 'low', label: 'Bas' },
];
const SRC_TYPE_OPTIONS = [
  { value: 'alexa_api', label: 'Alexa Smart Home API' },
  { value: 'email', label: 'Email (Gmail)' },
  { value: 'webhook', label: 'Webhook (API)' },
];

function SourceEditor({ sources, onChange }) {
  const update = (idx, field, val) => {
    const ns = [...sources];
    ns[idx] = { ...ns[idx], [field]: val };
    onChange(ns);
  };
  const remove = (idx) => onChange(sources.filter((_, i) => i !== idx));
  const add = (type) => onChange([...sources, { type, from: '', token: '', keywords: [] }]);

  const srcLabels = { alexa_api: 'Alexa API', email: 'Email', webhook: 'Webhook' };
  const srcStatus = { alexa_api: 'success', email: 'info', webhook: 'warning' };

  return (
    <SpaceBetween size="s">
      <Box variant="awsui-key-label">Sources de notification</Box>
      {sources.map((s, i) => (
        <Container key={i} variant="stacked" header={
          <Header variant="h5" actions={<Button variant="icon" iconName="close" onClick={() => remove(i)} />}>
            <StatusIndicator type={srcStatus[s.type] || 'info'}>{srcLabels[s.type] || s.type}</StatusIndicator>
          </Header>
        }>
          <SpaceBetween size="xs">
            <FormField label="Type">
              <Select
                selectedOption={SRC_TYPE_OPTIONS.find(o => o.value === s.type) || SRC_TYPE_OPTIONS[0]}
                onChange={({ detail }) => update(i, 'type', detail.selectedOption.value)}
                options={SRC_TYPE_OPTIONS}
              />
            </FormField>
            {s.type === 'email' && (
              <ColumnLayout columns={2}>
                <FormField label="Expéditeur (from)">
                  <Input value={s.from || ''} onChange={({ detail }) => update(i, 'from', detail.value)} placeholder="noreply@myqdevice.com" />
                </FormField>
                <FormField label="Mots-clés (virgules)">
                  <Input value={(s.keywords || []).join(', ')} onChange={({ detail }) => update(i, 'keywords', detail.value.split(',').map(k => k.trim()).filter(Boolean))} placeholder="garage, door, opened" />
                </FormField>
              </ColumnLayout>
            )}
            {s.type === 'webhook' && (
              <FormField label="Token d'authentification">
                <Input value={s.token || ''} onChange={({ detail }) => update(i, 'token', detail.value)} placeholder="myq-secret" />
              </FormField>
            )}
            {s.type === 'alexa_api' && (
              <Box variant="small" color="text-body-secondary">Surveillance automatique via l'API Alexa Smart Home (état des appareils).</Box>
            )}
          </SpaceBetween>
        </Container>
      ))}
      <SpaceBetween direction="horizontal" size="xs">
        <Button onClick={() => add('alexa_api')} iconName="add-plus">Alexa API</Button>
        <Button onClick={() => add('email')} iconName="add-plus">Email</Button>
        <Button onClick={() => add('webhook')} iconName="add-plus">Webhook</Button>
      </SpaceBetween>
    </SpaceBetween>
  );
}

function AlexaDevicesSection({ api }) {
  const [alexaDevices, setAlexaDevices] = useState(null);
  const [loading, setLoading] = useState(false);

  const discover = async () => {
    setLoading(true);
    try {
      const res = await fetch(api + '/api/alexa/devices');
      if (res.ok) {
        const data = await res.json();
        setAlexaDevices(data);
      }
    } catch {} finally { setLoading(false); }
  };

  const catIcons = { WASHER: '👕', DRYER: '👕', THERMOSTAT: '🌡️', SMARTLOCK: '🔐', SECURITY_PANEL: '🔒', CAMERA: '📹', LIGHT: '💡', SMARTPLUG: '🔌', SWITCH: '🔌', OVEN: '🍳', OTHER: '📱', DOORBELL: '🔔' };

  return (
    <Container variant="stacked" header={
      <Header variant="h4" actions={<Button loading={loading} onClick={discover} iconName="refresh">Découvrir</Button>}>
        Alexa Smart Home {alexaDevices?.configured === false && <StatusIndicator type="warning">Non configuré</StatusIndicator>}
      </Header>
    }>
      {!alexaDevices ? (
        <Box variant="small" color="text-body-secondary">Cliquez Découvrir pour lister les appareils connectés à Alexa</Box>
      ) : alexaDevices.error ? (
        <Alert type="error">{alexaDevices.error}</Alert>
      ) : alexaDevices.devices?.length === 0 ? (
        <Box variant="small">Aucun appareil trouvé. Vérifiez les cookies Alexa dans Configuration.</Box>
      ) : (
        <SpaceBetween size="xxs">
          <Box variant="small">{alexaDevices.devices.length} appareils détectés via Alexa</Box>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {alexaDevices.devices.filter(d => !['ALEXA_VOICE_ENABLED', 'TV', 'GAME_CONSOLE', 'SPEAKERS', 'PRINTER'].includes(d.category)).map((d, i) => (
              <Box key={i} padding={{ horizontal: 'xs', vertical: 'xxs' }} display="inline-block">
                <StatusIndicator type={d.category === 'SECURITY_PANEL' || d.category === 'CAMERA' ? 'warning' : 'success'}>
                  {(catIcons[d.category] || '📱') + ' ' + d.friendlyName}
                </StatusIndicator>
              </Box>
            ))}
          </div>
        </SpaceBetween>
      )}
    </Container>
  );
}

export default function DevicesPanel({ api }) {
  const [yaml, setYaml] = useState('');
  const [parsed, setParsed] = useState({ vocal_alerts: false, poll_interval_seconds: 30, devices: [] });
  const [stats, setStats] = useState([]);
  const [alert, setAlert] = useState(null);

  const load = useCallback(async () => {
    try {
      const [devRes, cfgRes] = await Promise.all([
        fetch(api + '/api/devices').then(r => r.ok ? r.json() : { devices: [] }),
        fetch(api + '/api/devices/config').then(r => r.ok ? r.json() : { content: '' }),
      ]);
      setStats(groupDevices(devRes.devices || []));
      setYaml(cfgRes.content || '');
      setParsed(parseDevicesYaml(cfgRes.content || ''));
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const updateFromForm = (p) => { setParsed(p); setYaml(buildDevicesYaml(p)); };
  const updateFromYaml = (y) => { setYaml(y); try { setParsed(parseDevicesYaml(y)); } catch {} };

  const save = async () => {
    try {
      const res = await fetch(api + '/api/devices/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: yaml }),
      });
      if (!res.ok) { setAlert({ type: 'error', text: 'Erreur: ' + res.status }); return; }
      setAlert({ type: 'success', text: 'Sauvegardé et rechargé' });
      load();
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const updateDevice = (idx, field, value) => {
    const nd = [...parsed.devices]; nd[idx] = { ...nd[idx], [field]: value }; updateFromForm({ ...parsed, devices: nd });
  };
  const removeDevice = (idx) => updateFromForm({ ...parsed, devices: parsed.devices.filter((_, i) => i !== idx) });
  const addDevice = () => updateFromForm({ ...parsed, devices: [...parsed.devices, {
    bundle_id: 'com.example.app', name: 'Nouvel appareil', icon: '📱', description: '', security_level: 'low',
    normal_hours: [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21], context: '', enabled: true, sources: [{ type: 'alexa_api', from: '', token: '', keywords: [] }],
  }]});

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}

      <Container header={<Header variant="h3">Paramètres</Header>}>
        <ColumnLayout columns={2}>
          <FormField label="Alertes vocales (Sonos/Echo sur anomalies)">
            <Toggle checked={parsed.vocal_alerts} onChange={({ detail }) => updateFromForm({ ...parsed, vocal_alerts: detail.checked })}>
              {parsed.vocal_alerts ? 'Activées' : 'Désactivées'}
            </Toggle>
          </FormField>
          <FormField label="Intervalle de vérification (sec)">
            <Input type="number" value={String(parsed.poll_interval_seconds)} onChange={({ detail }) => updateFromForm({ ...parsed, poll_interval_seconds: parseInt(detail.value) || 30 })} />
          </FormField>
        </ColumnLayout>
      </Container>

      {stats.length > 0 && (
        <Container header={<Header variant="h3">Activité</Header>}>
          <ColumnLayout columns={Math.min(stats.length, 4)}>
            {stats.map(d => (
              <Container key={d.name} variant="stacked">
                <SpaceBetween size="xxs">
                  <Box variant="h4">{d.icon + ' ' + d.name}</Box>
                  <Box variant="small">{d.totalNotifications} notifications — dernière: {timeAgo(d.lastSeen)}</Box>
                  {d.hourCounts?.some(c => c > 0) && (
                    <Box>
                      <Box variant="awsui-key-label">Activité par heure (rouge = nuit)</Box>
                      <div style={{ display: 'flex', gap: '1px', height: '20px', alignItems: 'flex-end', marginTop: '4px' }}>
                        {d.hourCounts.map((c, h) => (<div key={h} title={h + 'h: ' + c} style={{ width: '9px', height: Math.max(1, (c / Math.max(...d.hourCounts, 1)) * 18) + 'px', background: c === 0 ? '#1a1f2e' : (h >= 22 || h < 6) ? '#d13212' : '#0972d3', borderRadius: '1px' }} />))}
                      </div>
                    </Box>
                  )}
                </SpaceBetween>
              </Container>
            ))}
          </ColumnLayout>
        </Container>
      )}

      <ColumnLayout columns={2}>
        <SpaceBetween size="m">
          <Header variant="h3" actions={<Button onClick={addDevice} iconName="add-plus">Ajouter</Button>}>Appareils ({parsed.devices.length})</Header>
          <AlexaDevicesSection api={api} />
          {parsed.devices.map((d, i) => (
            <Container key={i} header={
              <Header variant="h4" actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Toggle checked={d.enabled} onChange={({ detail }) => updateDevice(i, 'enabled', detail.checked)}>{d.enabled ? 'Actif' : 'Inactif'}</Toggle>
                  <Button variant="icon" iconName="close" onClick={() => removeDevice(i)} />
                </SpaceBetween>
              }>{d.icon + ' ' + d.name}</Header>
            }>
              <SpaceBetween size="s">
                <ColumnLayout columns={3}>
                  <FormField label="Bundle ID"><Input value={d.bundle_id} onChange={({ detail }) => updateDevice(i, 'bundle_id', detail.value)} /></FormField>
                  <FormField label="Nom"><Input value={d.name} onChange={({ detail }) => updateDevice(i, 'name', detail.value)} /></FormField>
                  <FormField label="Icône"><Input value={d.icon} onChange={({ detail }) => updateDevice(i, 'icon', detail.value)} /></FormField>
                </ColumnLayout>
                <ColumnLayout columns={2}>
                  <FormField label="Description"><Input value={d.description} onChange={({ detail }) => updateDevice(i, 'description', detail.value)} /></FormField>
                  <FormField label="Sécurité">
                    <Select selectedOption={SEC_OPTIONS.find(o => o.value === d.security_level) || SEC_OPTIONS[3]} onChange={({ detail }) => updateDevice(i, 'security_level', detail.selectedOption.value)} options={SEC_OPTIONS} />
                  </FormField>
                </ColumnLayout>
                <FormField label="Contexte IA"><Input value={d.context} onChange={({ detail }) => updateDevice(i, 'context', detail.value)} /></FormField>
                <FormField label="Heures normales (0-23, séparées par virgules)">
                  <Input value={(d.normal_hours || []).join(', ')} onChange={({ detail }) => updateDevice(i, 'normal_hours', detail.value.split(',').map(h => parseInt(h.trim())).filter(h => !isNaN(h)))} />
                </FormField>
                <SourceEditor sources={d.sources || []} onChange={(s) => updateDevice(i, 'sources', s)} />
              </SpaceBetween>
            </Container>
          ))}
        </SpaceBetween>
        <Container header={<Header variant="h3" actions={<Button variant="primary" onClick={save}>Sauvegarder</Button>}>YAML</Header>}>
          <Textarea value={yaml} onChange={({ detail }) => updateFromYaml(detail.value)} rows={40} />
        </Container>
      </ColumnLayout>
    </SpaceBetween>
  );
}
