import { useState, useEffect } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Select from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import Textarea from '@cloudscape-design/components/textarea';
import FormField from '@cloudscape-design/components/form-field';
import Alert from '@cloudscape-design/components/alert';

const FILES = [
  { value: 'config/routing.yaml', label: '🔀 Routing' },
  { value: 'config/proactive.yaml', label: '⏰ Actions proactives' },
  { value: 'agent.md', label: '🤖 Agent prompt' },
];

export default function ConfigPanel({ api }) {
  const [file, setFile] = useState(FILES[0]);
  const [content, setContent] = useState('');
  const [alert, setAlert] = useState(null);

  const load = async (f) => {
    try {
      const res = await fetch(api + '/api/config?file=' + encodeURIComponent(f || file.value));
      const data = await res.json();
      setContent(data.content || '');
    } catch (err) { setContent('Erreur: ' + err.message); }
  };

  useEffect(() => { load(); }, [file]);

  const save = async () => {
    try {
      const res = await fetch(api + '/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: file.value, content }),
      });
      const data = await res.json();
      setAlert({ type: data.saved ? 'success' : 'error', text: data.saved ? 'Sauvegardé!' : data.error });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const reload = async () => {
    try {
      const res = await fetch(api + '/api/reload', { method: 'POST' });
      const data = await res.json();
      setAlert({ type: data.reloaded ? 'success' : 'error', text: data.reloaded ? 'Moteur rechargé!' : data.error });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}
      <Container header={
        <Header variant="h2" actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={save} variant="primary">Sauvegarder</Button>
            <Button onClick={reload}>Recharger le moteur</Button>
          </SpaceBetween>
        }>Configuration</Header>
      }>
        <SpaceBetween size="m">
          <FormField label="Fichier">
            <Select
              selectedOption={file}
              onChange={({ detail }) => { setFile(detail.selectedOption); load(detail.selectedOption.value); }}
              options={FILES}
            />
          </FormField>
          <ColumnLayout columns={1}>
            <FormField label="Contenu" description="Éditez le YAML ou le prompt directement">
              <Textarea
                value={content}
                onChange={({ detail }) => setContent(detail.value)}
                rows={25}
              />
            </FormField>
          </ColumnLayout>
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}
