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
import Spinner from '@cloudscape-design/components/spinner';

const SKIP_CATEGORIES = new Set(['ALEXA_VOICE_ENABLED', 'TV', 'GAME_CONSOLE', 'SPEAKERS', 'PRINTER']);
const CAT_ICONS = { WASHER: '👕', DRYER: '👕', THERMOSTAT: '🌡️', SMARTLOCK: '🔐', SECURITY_PANEL: '🔒', CAMERA: '📹', LIGHT: '💡', SMARTPLUG: '🔌', SWITCH: '🔌', OVEN: '🍳', OTHER: '📱', DOORBELL: '🔔', GARAGE_DOOR: '🚗' };
const CAT_SEC = { SECURITY_PANEL: 'critical', SMARTLOCK: 'critical', CAMERA: 'high', GARAGE_DOOR: 'high', DOORBELL: 'high' };

function parseDevicesYaml(text) {
  const result = { vocal_alerts: false, poll_interval_seconds: 60, devices: [] };
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
    if (d.sources?.length > 0) {
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
  const update = (idx, field, val) => { const ns = [...sources]; ns[idx] = { ...ns[idx], [field]: val }; onChange(ns); };
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
              <Select selectedOption={SRC_TYPE_OPTIONS.find(o => o.value === s.type) || SRC_TYPE_OPTIONS[0]} onChange={({ detail }) => update(i, 'type', detail.selectedOption.value)} options={SRC_TYPE_OPTIONS} />
            </FormField>
            {s.type === 'email' && (
              <ColumnLayout columns={2}>
                <FormField label="Expéditeur"><Input value={s.from || ''} onChange={({ detail }) => update(i, 'from', detail.value)} placeholder="noreply@myqdevice.com" /></FormField>
                <FormField label="Mots-clés"><Input value={(s.keywords || []).join(', ')} onChange={({ detail }) => update(i, 'keywords', detail.value.split(',').map(k => k.trim()).filter(Boolean))} /></FormField>
              </ColumnLayout>
            )}
            {s.type === 'webhook' && (
              <FormField label="Token"><Input value={s.token || ''} onChange={({ detail }) => update(i, 'token', detail.value)} /></FormField>
            )}
            {s.type === 'alexa_api' && (
              <Box variant="small" color="text-body-secondary">Surveillance automatique via l'API Alexa Smart Home.</Box>
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

export default function DevicesPanel({ api }) {
  const [yaml, setYaml] = useState('');
  const [parsed, setParsed] = useState({ vocal_alerts: false, poll_interval_seconds: 60, devices: [] });
  const [alexaDevices, setAlexaDevices] = useState(null); // null = loading, [] = empty
  const [alexaLoading, setAlexaLoading] = useState(true);
  const [alert, setAlert] = useState(null);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(api + '/api/devices/config');
      if (res.ok) { const d = await res.json(); setYaml(d.content || ''); setParsed(parseDevicesYaml(d.content || '')); }
    } catch {}
  }, [api]);

  const loadAlexaDevices = useCallback(async () => {
    setAlexaLoading(true);
    try {
      const res = await fetch(api + '/api/alexa/discovered');
      if (res.ok) { const d = await res.json(); setAlexaDevices(d); }
    } catch {} finally { setAlexaLoading(false); }
  }, [api]);

  const forceRediscover = async () => {
    setAlexaLoading(true);
    try {
      const res = await fetch(api + '/api/alexa/devices');
      if (res.ok) {
        const d = await res.json();
        setAlexaDevices(d);
        setAlert({ type: 'success', text: d.devices?.length + ' appareils découverts via Alexa' });
      }
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
    finally { setAlexaLoading(false); }
  };

  useEffect(() => { loadConfig(); loadAlexaDevices(); }, [loadConfig, loadAlexaDevices]);

  const updateFromForm = (p) => { setParsed(p); setYaml(buildDevicesYaml(p)); };
  const updateFromYaml = (y) => { setYaml(y); try { setParsed(parseDevicesYaml(y)); } catch {} };

  const save = async () => {
    try {
      const res = await fetch(api + '/api/devices/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: yaml }) });
      if (!res.ok) { setAlert({ type: 'error', text: 'Erreur: ' + res.status }); return; }
      setAlert({ type: 'success', text: 'Configuration sauvegardée' });
      loadConfig();
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const updateDevice = (idx, field, value) => { const nd = [...parsed.devices]; nd[idx] = { ...nd[idx], [field]: value }; updateFromForm({ ...parsed, devices: nd }); };
  const removeDevice = (idx) => updateFromForm({ ...parsed, devices: parsed.devices.filter((_, i) => i !== idx) });
  const addDevice = () => updateFromForm({ ...parsed, devices: [...parsed.devices, {
    bundle_id: 'com.example.app', name: 'Nouvel appareil', icon: '📱', description: '', security_level: 'low',
    normal_hours: [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21], context: '', enabled: true, sources: [{ type: 'alexa_api' }],
  }]});

  // Filter Alexa devices to monitorable ones
  const monitorable = (alexaDevices?.devices || []).filter(d => !SKIP_CATEGORIES.has(d.category));

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}

      <Container header={
        <Header variant="h3" actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button loading={alexaLoading} onClick={forceRediscover} iconName="refresh">Redécouvrir</Button>
          </SpaceBetween>
        }>Appareils Alexa Smart Home</Header>
      }>
        {alexaLoading && !alexaDevices ? (
          <Box textAlign="center" padding="l"><Spinner size="large" /> Chargement des appareils...</Box>
        ) : alexaDevices?.configured === false ? (
          <Alert type="warning">Alexa non configuré. Ajoutez les cookies dans Configuration → Alexa Smart Home API.</Alert>
        ) : monitorable.length === 0 ? (
          <Box variant="small">Aucun appareil détecté. Cliquez Redécouvrir ou vérifiez les cookies Alexa.</Box>
        ) : (
          <SpaceBetween size="s">
            <Box variant="small">{monitorable.length} appareils surveillés (redécouverte automatique toutes les 6h)</Box>
            <ColumnLayout columns={Math.min(monitorable.length, 4)}>
              {monitorable.map((d, i) => (
                <Container key={i} variant="stacked">
                  <SpaceBetween size="xxs">
                    <Box variant="h4">{(CAT_ICONS[d.category] || '📱') + ' ' + d.friendlyName}</Box>
                    <StatusIndicator type={CAT_SEC[d.category] ? 'warning' : 'success'}>
                      {d.category}
                    </StatusIndicator>
                    <Box variant="small" color="text-body-secondary">{d.description}</Box>
                  </SpaceBetween>
                </Container>
              ))}
            </ColumnLayout>
          </SpaceBetween>
        )}
      </Container>

      <Container header={<Header variant="h3">Paramètres</Header>}>
        <ColumnLayout columns={2}>
          <FormField label="Alertes vocales (Sonos/Echo sur anomalies)">
            <Toggle checked={parsed.vocal_alerts} onChange={({ detail }) => updateFromForm({ ...parsed, vocal_alerts: detail.checked })}>
              {parsed.vocal_alerts ? 'Activées' : 'Désactivées'}
            </Toggle>
          </FormField>
          <FormField label="Intervalle de vérification (sec)">
            <Input type="number" value={String(parsed.poll_interval_seconds)} onChange={({ detail }) => updateFromForm({ ...parsed, poll_interval_seconds: parseInt(detail.value) || 60 })} />
          </FormField>
        </ColumnLayout>
      </Container>

      <ColumnLayout columns={2}>
        <SpaceBetween size="m">
          <Header variant="h3" actions={<Button onClick={addDevice} iconName="add-plus">Ajouter</Button>}>Règles d'alerte ({parsed.devices.length})</Header>
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
                <FormField label="Heures normales (0-23, virgules)">
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
