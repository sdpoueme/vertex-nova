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

function formatCapValue(key, val) {
  if (key.includes('powerState')) return val === 'ON' ? '🟢 Allumé' : '⚫ Éteint';
  if (key.includes('lockState')) return val === 'LOCKED' ? '🔒 Verrouillé' : '🔓 Déverrouillé';
  if (key.includes('armState')) {
    const labels = { ARMED_AWAY: '🔒 Armé (absent)', ARMED_STAY: '🔒 Armé (présent)', DISARMED: '🔓 Désarmé' };
    return labels[val] || val;
  }
  if (key.includes('detectionState')) return val === 'DETECTED' ? '🔴 Détecté' : '🟢 Aucun';
  if (key.includes('temperature') || key.includes('Setpoint')) {
    const t = typeof val === 'object' ? val.value : val;
    const unit = typeof val === 'object' && val.scale === 'FAHRENHEIT' ? '°F' : '°C';
    return t != null ? t + unit : '—';
  }
  if (key.includes('thermostatMode')) return val || '—';
  if (key.includes('connectivity')) return typeof val === 'object' ? (val.value === 'OK' ? '🟢 Connecté' : '🔴 Hors ligne') : String(val);
  if (key.includes('rangeValue')) return typeof val === 'object' ? val.value : val;
  if (key.includes('toggleState')) return val === 'ON' ? 'Activé' : 'Désactivé';
  return typeof val === 'object' ? JSON.stringify(val) : String(val);
}

function friendlyCapName(key) {
  if (key.includes('powerState')) return 'Alimentation';
  if (key.includes('lockState')) return 'Serrure';
  if (key.includes('armState')) return 'Sécurité';
  if (key.includes('detectionState') && key.includes('Motion')) return 'Mouvement';
  if (key.includes('detectionState')) return 'Contact';
  if (key.includes('temperature') && !key.includes('Setpoint')) return 'Température';
  if (key.includes('Setpoint')) return 'Consigne';
  if (key.includes('thermostatMode')) return 'Mode';
  if (key.includes('connectivity')) return 'Connexion';
  if (key.includes('rangeValue')) return 'Valeur';
  if (key.includes('toggleState')) return 'État';
  return key.split('.').pop();
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'j';
}


// --- New YAML schema: rules keyed by device_id (friendly name) ---
function parseDevicesYaml(text) {
  const result = { vocal_alerts: false, poll_interval_seconds: 60, rules: [] };
  const vm = text.match(/vocal_alerts:\s*(true|false)/);
  if (vm) result.vocal_alerts = vm[1] === 'true';
  const pm = text.match(/poll_interval_seconds:\s*(\d+)/);
  if (pm) result.poll_interval_seconds = parseInt(pm[1]);

  // New format: rules keyed by device_id
  const blocks = text.split(/^\s+-\s+device_id:/m);
  for (let i = 1; i < blocks.length; i++) {
    const b = '  - device_id:' + blocks[i];
    const deviceId = (b.match(/device_id:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '';
    const icon = (b.match(/icon:\s*"([^"]*)"/) || [])[1] || '📱';
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
    if (deviceId) result.rules.push({ device_id: deviceId, icon, security_level: secLevel, normal_hours: normalHours, context, enabled, sources });
  }

  // Legacy fallback: parse old bundle_id format
  if (result.rules.length === 0) {
    const oldBlocks = text.split(/^\s+-\s+bundle_id:/m);
    for (let i = 1; i < oldBlocks.length; i++) {
      const b = '  - bundle_id:' + oldBlocks[i];
      const name = (b.match(/name:\s*(.+)/) || [])[1]?.trim() || '';
      if (name) result.rules.push({ device_id: name, icon: (b.match(/icon:\s*"([^"]*)"/) || [])[1] || '📱', security_level: (b.match(/security_level:\s*(\S+)/) || [])[1]?.trim() || 'low', normal_hours: [], context: (b.match(/context:\s*"([^"]*)"/) || [])[1] || '', enabled: true, sources: [{ type: 'alexa_api' }] });
    }
  }
  return result;
}

function buildDevicesYaml(data) {
  let y = '# Vertex Nova — Device Alert Rules\n\nsettings:\n';
  y += '  vocal_alerts: ' + data.vocal_alerts + '\n';
  y += '  poll_interval_seconds: ' + data.poll_interval_seconds + '\n\nrules:\n';
  for (const r of data.rules) {
    y += '  - device_id: "' + (r.device_id || '').replace(/"/g, '\\"') + '"\n';
    y += '    icon: "' + r.icon + '"\n';
    y += '    security_level: ' + r.security_level + '\n';
    if (r.normal_hours?.length) y += '    normal_hours: [' + r.normal_hours.join(',') + ']\n';
    if (r.context) y += '    context: "' + (r.context || '').replace(/"/g, '\\"') + '"\n';
    if (r.sources?.length > 0) {
      y += '    sources:\n';
      for (const s of r.sources) {
        y += '      - type: ' + s.type + '\n';
        if (s.type === 'email' && s.from) y += '        from: "' + s.from + '"\n';
        if (s.type === 'email' && s.keywords?.length) y += '        keywords: ["' + s.keywords.join('", "') + '"]\n';
        if (s.type === 'webhook' && s.token) y += '        token: "' + s.token + '"\n';
      }
    }
    y += '    enabled: ' + r.enabled + '\n\n';
  }
  return y;
}

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
  const [parsed, setParsed] = useState({ vocal_alerts: false, poll_interval_seconds: 60, rules: [] });
  const [alexaDevices, setAlexaDevices] = useState(null);
  const [alexaLoading, setAlexaLoading] = useState(true);
  const [deviceStates, setDeviceStates] = useState([]);
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

  const loadStates = useCallback(async () => {
    try {
      const res = await fetch(api + '/api/alexa/states');
      if (res.ok) { const d = await res.json(); setDeviceStates(d.devices || []); }
    } catch {}
  }, [api]);

  const forceRediscover = async () => {
    setAlexaLoading(true);
    try {
      const res = await fetch(api + '/api/alexa/devices');
      if (res.ok) { const d = await res.json(); setAlexaDevices(d); setAlert({ type: 'success', text: d.devices?.length + ' appareils découverts' }); }
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
    finally { setAlexaLoading(false); }
  };

  useEffect(() => { loadConfig(); loadAlexaDevices(); loadStates(); }, [loadConfig, loadAlexaDevices, loadStates]);
  useEffect(() => { const t = setInterval(loadStates, 30000); return () => clearInterval(t); }, [loadStates]);

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

  const updateRule = (idx, field, value) => { const nr = [...parsed.rules]; nr[idx] = { ...nr[idx], [field]: value }; updateFromForm({ ...parsed, rules: nr }); };
  const removeRule = (idx) => updateFromForm({ ...parsed, rules: parsed.rules.filter((_, i) => i !== idx) });

  // Build device options for the Select dropdown — from Alexa discovered + custom
  const monitorable = (alexaDevices?.devices || []).filter(d => !SKIP_CATEGORIES.has(d.category));
  const deviceOptions = monitorable.map(d => ({
    value: d.friendlyName,
    label: (CAT_ICONS[d.category] || '📱') + ' ' + d.friendlyName + ' [' + d.category + ']',
    tags: [d.category],
  }));
  // Add a "custom" option for email/webhook-only devices
  deviceOptions.push({ value: '__custom__', label: '✏️ Appareil personnalisé (email, webhook, autre)' });

  const addRule = (deviceId) => {
    const alexaDev = monitorable.find(d => d.friendlyName === deviceId);
    const icon = alexaDev ? (CAT_ICONS[alexaDev.category] || '📱') : '📱';
    const sec = alexaDev ? (CAT_SEC[alexaDev.category] || 'low') : 'low';
    const src = alexaDev ? [{ type: 'alexa_api' }] : [];
    updateFromForm({ ...parsed, rules: [...parsed.rules, {
      device_id: deviceId === '__custom__' ? '' : deviceId,
      icon, security_level: sec,
      normal_hours: [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21],
      context: '', enabled: true, sources: src,
    }]});
  };

  // Already-configured device IDs for filtering
  const configuredIds = new Set(parsed.rules.map(r => r.device_id));

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}

      <Container header={
        <Header variant="h3" actions={<Button loading={alexaLoading} onClick={forceRediscover} iconName="refresh">Redécouvrir</Button>}>
          Appareils détectés
        </Header>
      }>
        {alexaLoading && !alexaDevices ? (
          <Box textAlign="center" padding="l"><Spinner size="large" /> Chargement...</Box>
        ) : alexaDevices?.configured === false ? (
          <Alert type="warning">Alexa non configuré. Ajoutez les cookies dans Configuration.</Alert>
        ) : monitorable.length === 0 ? (
          <Box variant="small">Aucun appareil détecté.</Box>
        ) : (
          <SpaceBetween size="s">
            <Box variant="small">{monitorable.length} appareils (redécouverte auto toutes les 6h) — états rafraîchis toutes les 30s</Box>
            <ColumnLayout columns={Math.min(monitorable.length, 3)}>
              {monitorable.map((d, i) => {
                const hasRule = configuredIds.has(d.friendlyName);
                const state = deviceStates.find(s => s.friendlyName === d.friendlyName);
                const caps = state?.capabilities || {};
                const capEntries = Object.entries(caps).filter(([k]) => !k.includes('EndpointHealth'));
                const connectivity = caps['Alexa.EndpointHealth.connectivity'];
                const isOnline = connectivity && (typeof connectivity === 'object' ? connectivity.value === 'OK' : connectivity === 'OK');
                return (
                  <Container key={i} variant="stacked">
                    <SpaceBetween size="xxs">
                      <SpaceBetween direction="horizontal" size="xs">
                        <Box variant="h4">{(CAT_ICONS[d.category] || '📱') + ' ' + d.friendlyName}</Box>
                        {connectivity && <StatusIndicator type={isOnline ? 'success' : 'error'}>{isOnline ? 'En ligne' : 'Hors ligne'}</StatusIndicator>}
                      </SpaceBetween>
                      {capEntries.length > 0 ? (
                        <Box>
                          {capEntries.map(([k, v]) => (
                            <Box key={k} variant="small">{friendlyCapName(k)}: {formatCapValue(k, v)}</Box>
                          ))}
                          {state?.lastUpdated && <Box variant="small" color="text-body-secondary">Mis à jour il y a {timeAgo(state.lastUpdated)}</Box>}
                        </Box>
                      ) : (
                        <Box variant="small" color="text-body-secondary">{d.category} — en attente de données</Box>
                      )}
                      <StatusIndicator type={hasRule ? 'success' : 'stopped'}>{hasRule ? 'Règle active' : 'Pas de règle'}</StatusIndicator>
                      {!hasRule && <Button variant="link" onClick={() => addRule(d.friendlyName)}>Ajouter une règle</Button>}
                    </SpaceBetween>
                  </Container>
                );
              })}
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
          <Header variant="h3" actions={
            <Select placeholder="Ajouter une règle pour..." options={deviceOptions.filter(o => !configuredIds.has(o.value))}
              onChange={({ detail }) => addRule(detail.selectedOption.value)}
              selectedOption={null} />
          }>Règles d'alerte ({parsed.rules.length})</Header>
          {parsed.rules.map((r, i) => (
            <Container key={i} header={
              <Header variant="h4" actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Toggle checked={r.enabled} onChange={({ detail }) => updateRule(i, 'enabled', detail.checked)}>{r.enabled ? 'Actif' : 'Inactif'}</Toggle>
                  <Button variant="icon" iconName="close" onClick={() => removeRule(i)} />
                </SpaceBetween>
              }>{r.icon + ' ' + (r.device_id || 'Nouvel appareil')}</Header>
            }>
              <SpaceBetween size="s">
                <ColumnLayout columns={3}>
                  <FormField label="Appareil">
                    {monitorable.length > 0 ? (
                      <Select
                        selectedOption={r.device_id ? { value: r.device_id, label: r.device_id } : null}
                        onChange={({ detail }) => updateRule(i, 'device_id', detail.selectedOption.value)}
                        options={[...deviceOptions.filter(o => o.value !== '__custom__'), { value: '__custom_input__', label: '✏️ Saisie libre' }]}
                        placeholder="Sélectionner un appareil"
                        filteringType="auto"
                      />
                    ) : (
                      <Input value={r.device_id || ''} onChange={({ detail }) => updateRule(i, 'device_id', detail.value)} placeholder="Nom de l'appareil" />
                    )}
                  </FormField>
                  <FormField label="Icône"><Input value={r.icon} onChange={({ detail }) => updateRule(i, 'icon', detail.value)} /></FormField>
                  <FormField label="Sécurité">
                    <Select selectedOption={SEC_OPTIONS.find(o => o.value === r.security_level) || SEC_OPTIONS[3]} onChange={({ detail }) => updateRule(i, 'security_level', detail.selectedOption.value)} options={SEC_OPTIONS} />
                  </FormField>
                </ColumnLayout>
                <FormField label="Contexte IA (instructions pour l'agent)"><Input value={r.context} onChange={({ detail }) => updateRule(i, 'context', detail.value)} placeholder="Ex: Si la porte s'ouvre la nuit, c'est suspect" /></FormField>
                <FormField label="Heures normales (0-23, virgules)">
                  <Input value={(r.normal_hours || []).join(', ')} onChange={({ detail }) => updateRule(i, 'normal_hours', detail.value.split(',').map(h => parseInt(h.trim())).filter(h => !isNaN(h)))} />
                </FormField>
                <SourceEditor sources={r.sources || []} onChange={(s) => updateRule(i, 'sources', s)} />
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
