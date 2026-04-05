import { useState, useEffect, useCallback } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Button from '@cloudscape-design/components/button';
import Textarea from '@cloudscape-design/components/textarea';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Spinner from '@cloudscape-design/components/spinner';

export default function KnowledgeBasePanel({ api }) {
  const [kbs, setKbs] = useState([]);
  const [yaml, setYaml] = useState('');
  const [alert, setAlert] = useState(null);
  const [syncing, setSyncing] = useState(null);

  const load = useCallback(async () => {
    try {
      const [kbRes, cfgRes] = await Promise.all([
        fetch(api + '/api/knowledgebases').then(r => r.json()),
        fetch(api + '/api/knowledgebases/config').then(r => r.json()),
      ]);
      setKbs(kbRes.knowledgebases || []);
      setYaml(cfgRes.content || '');
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      const res = await fetch(api + '/api/knowledgebases/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: yaml }),
      });
      const data = await res.json();
      if (data.saved) {
        setAlert({ type: 'success', text: 'Configuration sauvegardée' });
        load();
      }
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const sync = async (name) => {
    setSyncing(name);
    try {
      const res = await fetch(api + '/api/knowledgebases/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      setAlert({ type: 'success', text: data.result || 'Synced' });
      load();
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
    setSyncing(null);
  };

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}
      <ColumnLayout columns={2}>
        <SpaceBetween size="m">
          <Container header={<Header variant="h3">Bases de connaissances</Header>}>
            <SpaceBetween size="m">
              {kbs.length === 0 && <Box color="text-body-secondary">Aucune base configurée</Box>}
              {kbs.map(kb => (
                <Container key={kb.name} header={
                  <Header variant="h4" actions={
                    <Button onClick={() => sync(kb.name)} loading={syncing === kb.name} iconName="refresh">
                      Synchroniser
                    </Button>
                  }>
                    {'📚 ' + kb.name}
                  </Header>
                }>
                  <SpaceBetween size="xs">
                    <Box variant="p">{kb.description}</Box>
                    <ColumnLayout columns={3}>
                      <div>
                        <Box variant="awsui-key-label">Statut</Box>
                        <StatusIndicator type={kb.synced ? 'success' : 'warning'}>
                          {kb.synced ? 'Synchronisé' : 'Non synchronisé'}
                        </StatusIndicator>
                      </div>
                      <div>
                        <Box variant="awsui-key-label">Chunks indexés</Box>
                        <Box>{kb.chunks || 0}</Box>
                      </div>
                      <div>
                        <Box variant="awsui-key-label">Activé</Box>
                        <StatusIndicator type={kb.enabled ? 'success' : 'stopped'}>
                          {kb.enabled ? 'Oui' : 'Non'}
                        </StatusIndicator>
                      </div>
                    </ColumnLayout>
                    <Box variant="small" color="text-body-secondary">{kb.repo}</Box>
                  </SpaceBetween>
                </Container>
              ))}
            </SpaceBetween>
          </Container>
        </SpaceBetween>
        <Container header={
          <Header variant="h3" actions={<Button variant="primary" onClick={save}>Sauvegarder</Button>}>
            Configuration YAML
          </Header>
        }>
          <Textarea value={yaml} onChange={({ detail }) => setYaml(detail.value)} rows={25} />
        </Container>
      </ColumnLayout>
    </SpaceBetween>
  );
}
