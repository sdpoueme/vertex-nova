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

// Group devices by name to avoid duplicates (same device, multiple bundle IDs)
function groupDevices(devices) {
  const groups = {};
  for (const d of devices) {
    const key = d.name;
    if (!groups[key]) {
      groups[key] = { ...d, bundleIds: [d.bundle_id], totalNotifications: d.totalNotifications || 0, hourCounts: [...(d.hourCounts || new Array(24).fill(0))] };
    } else {
      groups[key].bundleIds.push(d.bundle_id);
      groups[key].totalNotifications += (d.totalNotifications || 0);
      if (d.lastSeen && (!groups[key].lastSeen || d.lastSeen > groups[key].lastSeen)) groups[key].lastSeen = d.lastSeen;
      // Merge hour counts
      if (d.hourCounts) {
        for (let h = 0; h < 24; h++) groups[key].hourCounts[h] += (d.hourCounts[h] || 0);
      }
    }
  }
  return Object.values(groups);
}

// Parse devices YAML into structured data for form editing
function parseDevicesYaml(text) {
  const result = { vocal_alerts: false, poll_interval_seconds: 30, devices: [] };
  const vocalMatch = text.match(/vocal_alerts:\s*(true|false)/);
  if (vocalMatch) result.vocal_alerts = vocalMatch[1] === 'true';
  const pollMatch = text.match(/poll_interval_seconds:\s*(\d+)/);
  if (pollMatch) result.poll_interval_seconds = parseInt(pollMatch[1]);

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
    const hoursMatch = b.match(/normal_hours:\s*\[([^\]]*)\]/);
    const normalHours = hoursMatch ? hoursMatch[1].split(',').map(h => parseInt(h.trim())) : [];
    if (bundleId) result.devices.push({ bundle_id: bundleId, name, icon, description: desc, security_level: secLevel, normal_hours: normalHours, context, enabled });
  }
  return result;
}

function buildDevicesYaml(data) {
  let yaml = '# Vertex Nova — Device Notification Monitoring\n\nsettings:\n';
  yaml += '  vocal_alerts: ' + data.vocal_alerts + '\n';
  yaml += '  poll_interval_seconds: ' + data.poll_interval_seconds + '\n\ndevices:\n';
  for (const d of data.devices) {
    yaml += '  - bundle_id: ' + d.bundle_id + '\n';
    yaml += '    name: ' + d.name + '\n';
    yaml += '    icon: "' + d.icon + '"\n';
    yaml += '    description: "' + d.description + '"\n';
    yaml += '    security_level: ' + d.security_level + '\n';
    yaml += '    normal_hours: [' + d.normal_hours.join(',') + ']\n';
    yaml += '    context: "' + d.context.replace(/"/g, '\\"') + '"\n';
    yaml += '    enabled: ' + d.enabled + '\n\n';
  }
  return yaml;
}

const SEC_OPTIONS = [
  { value: 'critical', label: 'Critique — alerte immédiate' },
  { value: 'high', label: 'Élevé — attention requise' },
  { value: 'medium', label: 'Moyen — à surveiller' },
  { value: 'low', label: 'Bas — informatif' },
];
const secColors = { critical: 'error', high: 'warning', medium: 'info', low: 'success' };

export default function DevicesPanel({ api }) {
  const [devices, setDevices] = useState([]);
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

  const updateFromForm = (newParsed) => {
    setParsed(newParsed);
    setYaml(buildDevicesYaml(newParsed));
  };

  const updateFromYaml = (newYaml) => {
    setYaml(newYaml);
    try { setParsed(parseDevicesYaml(newYaml)); } catch {}
  };

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

  const updateDevice = (idx, field, value) => {
    const newDevices = [...parsed.devices];
    newDevices[idx] = { ...newDevices[idx], [field]: value };
    updateFromForm({ ...parsed, devices: newDevices });
  };

  const removeDevice = (idx) => {
    updateFromForm({ ...parsed, devices: parsed.devices.filter((_, i) => i !== idx) });
  };

  const addDevice = () => {
    updateFromForm({ ...parsed, devices: [...parsed.devices, {
      bundle_id: 'com.example.app', name: 'Nouvel appareil', icon: '📱',
      description: 'Description', security_level: 'low',
      normal_hours: [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21],
      context: 'Notification de cet appareil.', enabled: true,
    }]});
  };

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}

      <Container header={<Header variant="h3">Paramètres globaux</Header>}>
        <ColumnLayout columns={2}>
          <FormField label="Alertes vocales (Sonos/Echo)">
            <Toggle checked={parsed.vocal_alerts} onChange={({ detail }) => updateFromForm({ ...parsed, vocal_alerts: detail.checked })}>
              {parsed.vocal_alerts ? 'Activées — les anomalies seront annoncées sur Sonos' : 'Désactivées — Telegram uniquement'}
            </Toggle>
          </FormField>
          <FormField label="Intervalle de vérification (secondes)">
            <Input type="number" value={String(parsed.poll_interval_seconds)} onChange={({ detail }) => updateFromForm({ ...parsed, poll_interval_seconds: parseInt(detail.value) || 30 })} />
          </FormField>
        </ColumnLayout>
      </Container>

      {stats.length > 0 && (
        <Container header={<Header variant="h3">Activité récente</Header>}>
          <ColumnLayout columns={stats.length > 3 ? 3 : stats.length}>
            {stats.map(d => (
              <div key={d.name}>
                <Box variant="h4">{d.icon + ' ' + d.name}</Box>
                <Box>{d.totalNotifications} notifications — dernière: {timeAgo(d.lastSeen)}</Box>
                {d.hourCounts && d.hourCounts.some(c => c > 0) && (
                  <div style={{ display: 'flex', gap: '1px', height: '24px', alignItems: 'flex-end', marginTop: '4px' }}>
                    {d.hourCounts.map((c, h) => {
                      const max = Math.max(...d.hourCounts, 1);
                      return (<div key={h} title={h + 'h: ' + c} style={{ width: '10px', height: Math.max(2, (c / max) * 22) + 'px', background: c === 0 ? '#1a1f2e' : (h >= 22 || h < 6) ? '#d13212' : '#0972d3', borderRadius: '1px' }} />);
                    })}
                  </div>
                )}
              </div>
            ))}
          </ColumnLayout>
        </Container>
      )}

      <ColumnLayout columns={2}>
        <SpaceBetween size="m">
          <Container header={
            <Header variant="h3" actions={<Button onClick={addDevice} iconName="add-plus">Ajouter</Button>}>
              Appareils ({parsed.devices.length})
            </Header>
          }>
            <SpaceBetween size="m">
              {parsed.devices.map((d, i) => (
                <Container key={i} header={
                  <Header variant="h4" actions={
                    <SpaceBetween direction="horizontal" size="xs">
                      <Toggle checked={d.enabled} onChange={({ detail }) => updateDevice(i, 'enabled', detail.checked)}>
                        {d.enabled ? 'Actif' : 'Inactif'}
                      </Toggle>
                      <Button variant="icon" iconName="close" onClick={() => removeDevice(i)} />
                    </SpaceBetween>
                  }>
                    {d.icon + ' ' + d.name}
                  </Header>
                }>
                  <SpaceBetween size="xs">
                    <ColumnLayout columns={2}>
                      <FormField label="Bundle ID">
                        <Input value={d.bundle_id} onChange={({ detail }) => updateDevice(i, 'bundle_id', detail.value)} />
                      </FormField>
                      <FormField label="Nom">
                        <Input value={d.name} onChange={({ detail }) => updateDevice(i, 'name', detail.value)} />
                      </FormField>
                      <FormField label="Icône">
                        <Input value={d.icon} onChange={({ detail }) => updateDevice(i, 'icon', detail.value)} />
                      </FormField>
                      <FormField label="Niveau sécurité">
                        <Select
                          selectedOption={SEC_OPTIONS.find(o => o.value === d.security_level) || SEC_OPTIONS[3]}
                          onChange={({ detail }) => updateDevice(i, 'security_level', detail.selectedOption.value)}
                          options={SEC_OPTIONS}
                        />
                      </FormField>
                    </ColumnLayout>
                    <FormField label="Description">
                      <Input value={d.description} onChange={({ detail }) => updateDevice(i, 'description', detail.value)} />
                    </FormField>
                    <FormField label="Contexte d'analyse (pour l'IA)">
                      <Input value={d.context} onChange={({ detail }) => updateDevice(i, 'context', detail.value)} />
                    </FormField>
                    <FormField label="Heures normales (séparées par virgules)">
                      <Input value={d.normal_hours.join(',')} onChange={({ detail }) => updateDevice(i, 'normal_hours', detail.value.split(',').map(h => parseInt(h.trim())).filter(h => !isNaN(h)))} />
                    </FormField>
                  </SpaceBetween>
                </Container>
              ))}
            </SpaceBetween>
          </Container>
        </SpaceBetween>
        <Container header={
          <Header variant="h3" actions={<Button variant="primary" onClick={save}>Sauvegarder</Button>}>YAML</Header>
        }>
          <Textarea value={yaml} onChange={({ detail }) => updateFromYaml(detail.value)} rows={35} />
        </Container>
      </ColumnLayout>
    </SpaceBetween>
  );
}
