import { useState, useEffect, useCallback } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Button from '@cloudscape-design/components/button';
import Textarea from '@cloudscape-design/components/textarea';
import Input from '@cloudscape-design/components/input';
import FormField from '@cloudscape-design/components/form-field';
import Toggle from '@cloudscape-design/components/toggle';
import Select from '@cloudscape-design/components/select';
import TokenGroup from '@cloudscape-design/components/token-group';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

function parseKbYaml(text) {
  const kbs = [];
  const blocks = text.split(/^\s+-\s+name:/m);
  for (let i = 1; i < blocks.length; i++) {
    const b = '  - name:' + blocks[i];
    const name = (b.match(/name:\s*(.+)/) || [])[1]?.trim() || '';
    const desc = (b.match(/description:\s*"([^"]*)"/) || [])[1]?.trim() || '';
    const repo = (b.match(/repo:\s*(.+)/) || [])[1]?.trim() || '';
    const branch = (b.match(/branch:\s*(.+)/) || [])[1]?.trim() || 'main';
    const syncH = parseInt((b.match(/sync_interval_hours:\s*(\d+)/) || [])[1] || '24');
    const enabled = (b.match(/enabled:\s*(.+)/) || [])[1]?.trim() !== 'false';
    const ftMatch = b.match(/file_types:\s*\[([^\]]*)\]/);
    const fileTypes = ftMatch ? ftMatch[1].split(',').map(s => s.trim().replace(/"/g, '')) : ['.md', '.html', '.json'];
    if (name) kbs.push({ name, description: desc, repo, branch, sync_interval_hours: syncH, file_types: fileTypes, enabled });
  }
  return kbs;
}

function buildKbYaml(kbs) {
  let y = '# Vertex Nova — Family Knowledge Bases\n\nknowledgebases:\n';
  for (const kb of kbs) {
    y += '  - name: ' + kb.name + '\n';
    y += '    description: "' + (kb.description || '').replace(/"/g, '\\"') + '"\n';
    y += '    repo: ' + kb.repo + '\n';
    y += '    branch: ' + (kb.branch || 'main') + '\n';
    y += '    sync_interval_hours: ' + (kb.sync_interval_hours || 24) + '\n';
    y += '    file_types: ["' + (kb.file_types || ['.md']).join('", "') + '"]\n';
    y += '    enabled: ' + kb.enabled + '\n\n';
  }
  return y;
}

// File type tag editor
function FileTypeEditor({ items, onChange }) {
  const [val, setVal] = useState('');
  const tokens = (items || []).map(v => ({ label: v, dismissLabel: 'Retirer ' + v }));
  return (
    <SpaceBetween size="xs">
      <div style={{ display: 'flex', gap: '6px' }}>
        <div style={{ flex: 1 }}>
          <Input value={val} onChange={({ detail }) => setVal(detail.value)}
            onKeyDown={({ detail }) => { if (detail.key === 'Enter' && val.trim()) { onChange([...(items || []), val.trim()]); setVal(''); } }}
            placeholder=".md, .html, .json..."
          />
        </div>
        <Button onClick={() => { if (val.trim()) { onChange([...(items || []), val.trim()]); setVal(''); } }} iconName="add-plus">Ajouter</Button>
      </div>
      {tokens.length > 0 && <TokenGroup items={tokens} onDismiss={({ detail }) => { const n = [...items]; n.splice(detail.itemIndex, 1); onChange(n); }} />}
    </SpaceBetween>
  );
}

export default function KnowledgeBasePanel({ api }) {
  const [yaml, setYaml] = useState('');
  const [parsed, setParsed] = useState([]);
  const [stats, setStats] = useState([]);
  const [alert, setAlert] = useState(null);
  const [syncing, setSyncing] = useState(null);

  const load = useCallback(async () => {
    try {
      const kbRes = await fetch(api + '/api/knowledgebases');
      const cfgRes = await fetch(api + '/api/knowledgebases/config');
      if (kbRes.ok) setStats((await kbRes.json()).knowledgebases || []);
      if (cfgRes.ok) {
        const content = (await cfgRes.json()).content || '';
        setYaml(content);
        setParsed(parseKbYaml(content));
      }
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const updateFromForm = (newParsed) => { setParsed(newParsed); setYaml(buildKbYaml(newParsed)); };
  const updateFromYaml = (y) => { setYaml(y); try { setParsed(parseKbYaml(y)); } catch {} };

  const save = async () => {
    try {
      const res = await fetch(api + '/api/knowledgebases/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: yaml }),
      });
      if (!res.ok) { setAlert({ type: 'error', text: 'Erreur: ' + res.status }); return; }
      setAlert({ type: 'success', text: 'Sauvegardé' });
      load();
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const sync = async (name) => {
    setSyncing(name);
    try {
      const res = await fetch(api + '/api/knowledgebases/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) { const d = await res.json(); setAlert({ type: 'success', text: d.result || 'Synced' }); }
      load();
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
    setSyncing(null);
  };

  const updateKb = (idx, field, value) => {
    const n = [...parsed]; n[idx] = { ...n[idx], [field]: value }; updateFromForm(n);
  };
  const removeKb = (idx) => updateFromForm(parsed.filter((_, i) => i !== idx));
  const addKb = () => updateFromForm([...parsed, {
    name: 'new-kb', description: '', repo: 'https://github.com/user/repo.git',
    branch: 'main', sync_interval_hours: 24, file_types: ['.md', '.html', '.json'], enabled: true,
  }]);

  // Match stats to parsed KBs
  const getStats = (name) => stats.find(s => s.name === name) || {};

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}
      <ColumnLayout columns={2}>
        <SpaceBetween size="m">
          <Header variant="h3" actions={<Button onClick={addKb} iconName="add-plus">Ajouter une base</Button>}>
            Bases de connaissances ({parsed.length})
          </Header>
          {parsed.map((kb, i) => {
            const st = getStats(kb.name);
            return (
              <Container key={i} header={
                <Header variant="h4" actions={
                  <SpaceBetween direction="horizontal" size="xs">
                    <Toggle checked={kb.enabled} onChange={({ detail }) => updateKb(i, 'enabled', detail.checked)}>
                      {kb.enabled ? 'Actif' : 'Inactif'}
                    </Toggle>
                    <Button onClick={() => sync(kb.name)} loading={syncing === kb.name} iconName="refresh">Sync</Button>
                    <Button variant="icon" iconName="close" onClick={() => removeKb(i)} />
                  </SpaceBetween>
                }>{kb.name}</Header>
              }>
                <SpaceBetween size="s">
                  <ColumnLayout columns={2}>
                    <FormField label="Nom">
                      <Input value={kb.name} onChange={({ detail }) => updateKb(i, 'name', detail.value)} />
                    </FormField>
                    <FormField label="Branche">
                      <Input value={kb.branch || 'main'} onChange={({ detail }) => updateKb(i, 'branch', detail.value)} />
                    </FormField>
                  </ColumnLayout>
                  <FormField label="Description">
                    <Input value={kb.description} onChange={({ detail }) => updateKb(i, 'description', detail.value)} />
                  </FormField>
                  <FormField label="URL du dépôt Git">
                    <Input value={kb.repo} onChange={({ detail }) => updateKb(i, 'repo', detail.value)} placeholder="https://github.com/user/repo.git" />
                  </FormField>
                  <ColumnLayout columns={2}>
                    <FormField label="Sync (heures)">
                      <Input type="number" value={String(kb.sync_interval_hours || 24)} onChange={({ detail }) => updateKb(i, 'sync_interval_hours', parseInt(detail.value) || 24)} />
                    </FormField>
                    <FormField label="Types de fichiers">
                      <FileTypeEditor items={kb.file_types || []} onChange={(ft) => updateKb(i, 'file_types', ft)} />
                    </FormField>
                  </ColumnLayout>
                  {st.synced !== undefined && (
                    <ColumnLayout columns={2}>
                      <SpaceBetween direction="horizontal" size="xs">
                        <StatusIndicator type={st.synced ? 'success' : 'warning'}>
                          {st.synced ? 'Synchronisé' : 'Non synchronisé'}
                        </StatusIndicator>
                      </SpaceBetween>
                      <Box variant="small">{st.chunks || 0} chunks indexés</Box>
                    </ColumnLayout>
                  )}
                </SpaceBetween>
              </Container>
            );
          })}
        </SpaceBetween>
        <Container header={
          <Header variant="h3" actions={<Button variant="primary" onClick={save}>Sauvegarder</Button>}>YAML</Header>
        }>
          <Textarea value={yaml} onChange={({ detail }) => updateFromYaml(detail.value)} rows={30} />
        </Container>
      </ColumnLayout>
    </SpaceBetween>
  );
}
