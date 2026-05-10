import { useState, useEffect, useCallback } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Button from '@cloudscape-design/components/button';
import Alert from '@cloudscape-design/components/alert';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import Toggle from '@cloudscape-design/components/toggle';
import Spinner from '@cloudscape-design/components/spinner';
import DateRangePicker from '@cloudscape-design/components/date-range-picker';

export default function DreamPanel({ api }) {
  const [config, setConfig] = useState(null);
  const [dreams, setDreams] = useState([]);
  const [dreamDays, setDreamDays] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [status, setStatus] = useState(null);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedDream, setExpandedDream] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [dateRange, setDateRange] = useState(null);
  const [page, setPage] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const PAGE_SIZE = 5;

  const dreamModelOptions = [
    { value: 'phi4-mini', label: 'Phi-4 Mini (recommandé)' },
    { value: 'nemotron-mini', label: 'Nemotron Mini (rapide)' },
    { value: 'qwen3:8b', label: 'Qwen3 8B (polyvalent)' },
  ];

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(api + '/api/config?file=config/dream-layer.yaml').then(r => r.ok ? r.json() : { content: '' }).catch(() => ({ content: '' })),
      fetch(api + '/api/dreams/status').then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(api + '/api/dreams/recent?days=60').then(r => r.ok ? r.json() : { dreams: [], dreamDays: [] }).catch(() => ({ dreams: [], dreamDays: [] })),
      fetch(api + '/api/dreams/policies').then(r => r.ok ? r.json() : { policies: [] }).catch(() => ({ policies: [] })),
    ]).then(([cfgData, statusData, dreamsData, policiesData]) => {
      const text = cfgData.content || '';
      const enabled = !/enabled:\s*false/.test(text);
      const model = (text.match(/generator:[\s\S]*?model:\s*(\S+)/) || [])[1] || 'phi4-mini';
      const maxDreams = parseInt((text.match(/max_dreams_per_night:\s*(\d+)/) || [])[1]) || 5;
      const temperature = parseFloat((text.match(/generator:[\s\S]*?temperature:\s*(\S+)/) || [])[1]) || 1.4;
      const scenariosEnabled = !/scenarios:\s*\n\s+enabled:\s*false/.test(text);
      const ephemeralDays = parseInt((text.match(/max_age_days:\s*(\d+)/) || [])[1]) || 14;
      setConfig({ enabled, model, maxDreams, temperature, scenariosEnabled, ephemeralDays, raw: text });
      setStatus(statusData);
      setDreams(dreamsData.dreams || []);
      setDreamDays(dreamsData.dreamDays || []);
      setPolicies(policiesData.policies || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async () => {
    if (!config) return;
    let text = config.raw;
    text = text.replace(/(dream_layer:\s*\n\s+enabled:\s*)(true|false)/, '$1' + config.enabled);
    text = text.replace(/(generator:\s*\n(?:\s+\S+.*\n)*?\s+model:\s*)\S+/, '$1' + config.model);
    text = text.replace(/max_dreams_per_night:\s*\d+/, 'max_dreams_per_night: ' + config.maxDreams);
    text = text.replace(/(generator:\s*\n\s+temperature:\s*)\S+/, '$1' + config.temperature);
    text = text.replace(/(scenarios:\s*\n\s+enabled:\s*)(true|false)/, '$1' + config.scenariosEnabled);
    text = text.replace(/max_age_days:\s*\d+/, 'max_age_days: ' + config.ephemeralDays);
    try {
      const res = await fetch(api + '/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: 'config/dream-layer.yaml', content: text }) });
      const data = await res.json();
      if (data.saved) setAlert({ type: 'success', text: 'Configuration sauvegardée' });
      else setAlert({ type: 'error', text: data.error || 'Erreur' });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const approvePolicy = async (policy) => {
    try {
      await fetch(api + '/api/dreams/policies/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: policy.id, title: policy.title, description: policy.description, rule: policy.rule }) });
      setAlert({ type: 'success', text: 'Politique approuvée: ' + policy.title }); load();
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const rejectPolicy = async (policy) => {
    try {
      await fetch(api + '/api/dreams/policies/reject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: policy.id, title: policy.title, description: policy.description }) });
      setAlert({ type: 'success', text: 'Politique rejetée' }); load();
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const analyzeDreams = async () => {
    setAnalyzing(true);
    setAnalysis('');
    try {
      const dreamTexts = filteredDreams.slice(0, 10).map(d => (d.narrative || '').slice(0, 300)).join('\n---\n');
      if (!dreamTexts.trim()) { setAnalysis('Aucun rêve à analyser.'); setAnalyzing(false); return; }
      const res = await fetch(api + '/api/dreams/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dreams: dreamTexts }),
      });
      if (!res.ok) { setAnalysis('Erreur serveur (' + res.status + ')'); setAnalyzing(false); return; }
      const data = await res.json();
      setAnalysis(data.analysis || data.error || 'Aucune analyse disponible.');
    } catch (err) { setAnalysis('Erreur réseau: ' + err.message); }
    setAnalyzing(false);
  };

  if (loading || !config) return <Spinner size="large" />;

  const pendingPolicies = policies.filter(p => p.status === 'pending');
  const approvedPolicies = policies.filter(p => p.status === 'approved');
  const lastDream = dreamDays.length > 0 ? dreamDays[0] : null;
  const totalDreamsGenerated = dreamDays.reduce((sum, d) => sum + (d.dreamsGenerated || 0), 0);

  // Filter dreams by date selection
  let filteredDreams = dreams;
  if (selectedDate) {
    filteredDreams = dreams.filter(d => d.created_at && d.created_at.startsWith(selectedDate));
  } else if (dateRange) {
    if (dateRange.type === 'absolute') {
      filteredDreams = dreams.filter(d => {
        if (!d.created_at) return false;
        const date = d.created_at.slice(0, 10);
        if (dateRange.startDate && date < dateRange.startDate) return false;
        if (dateRange.endDate && date > dateRange.endDate) return false;
        return true;
      });
    } else if (dateRange.type === 'relative') {
      const now = new Date();
      const msPerUnit = { day: 86400000, week: 604800000, month: 2592000000 };
      const cutoff = new Date(now.getTime() - (dateRange.amount * (msPerUnit[dateRange.unit] || 86400000)));
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      filteredDreams = dreams.filter(d => d.created_at && d.created_at.slice(0, 10) >= cutoffStr);
    }
  }

  // Pagination
  const totalPages = Math.ceil(filteredDreams.length / PAGE_SIZE);
  const pagedDreams = filteredDreams.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}

      {/* Metrics */}
      <ColumnLayout columns={5}>
        <Container><SpaceBetween size="xxs"><Box variant="awsui-key-label">Statut</Box><StatusIndicator type={config.enabled ? 'success' : 'stopped'}>{config.enabled ? 'Actif' : 'Désactivé'}</StatusIndicator></SpaceBetween></Container>
        <Container><SpaceBetween size="xxs"><Box variant="awsui-key-label">Dernier cycle</Box><Box variant="p" fontWeight="bold">{lastDream ? lastDream.date : '—'}</Box><Box variant="small" color="text-body-secondary">{lastDream?.time || ''}</Box></SpaceBetween></Container>
        <Container><SpaceBetween size="xxs"><Box variant="awsui-key-label">Rêves générés</Box><Box variant="p" fontWeight="bold">{totalDreamsGenerated}</Box><Box variant="small" color="text-body-secondary">{dreamDays.length} nuits</Box></SpaceBetween></Container>
        <Container><SpaceBetween size="xxs"><Box variant="awsui-key-label">Pool ACU</Box><Box variant="p" fontWeight="bold">{status?.pool?.total || 0} templates</Box></SpaceBetween></Container>
        <Container><SpaceBetween size="xxs"><Box variant="awsui-key-label">Politiques</Box><Box variant="p" fontWeight="bold" color={pendingPolicies.length > 0 ? 'text-status-warning' : undefined}>{pendingPolicies.length} en attente</Box><Box variant="small" color="text-body-secondary">{approvedPolicies.length} actives</Box></SpaceBetween></Container>
      </ColumnLayout>

      {/* Policies */}
      {pendingPolicies.length > 0 && (
        <Container header={<Header variant="h3" counter={'(' + pendingPolicies.length + ')'}>Politiques à approuver</Header>}>
          <SpaceBetween size="m">
            <Alert type="warning">Ces politiques optimisent le comportement de l'agent.</Alert>
            {pendingPolicies.map(p => (
              <Container key={p.id} header={<Header variant="h4" actions={<SpaceBetween direction="horizontal" size="xs"><Button variant="primary" onClick={() => approvePolicy(p)} iconName="check">Approuver</Button><Button onClick={() => rejectPolicy(p)} iconName="close">Rejeter</Button></SpaceBetween>}>{p.title || p.id}</Header>}>
                <SpaceBetween size="xs">
                  <Box variant="p">{p.description || p.rule}</Box>
                  {p.frequency && <Box variant="small" color="text-body-secondary">Fréquence: {p.frequency} occurrences</Box>}
                </SpaceBetween>
              </Container>
            ))}
          </SpaceBetween>
        </Container>
      )}

      {/* Date filters + Analysis */}
      <Container header={<Header variant="h3" actions={
        <Button variant="primary" onClick={analyzeDreams} loading={analyzing} iconName="gen-ai">Analyser les rêves</Button>
      }>Filtres et analyse</Header>}>
        <SpaceBetween size="m">
          <FormField label="Période">
            <DateRangePicker
              value={dateRange}
              onChange={({ detail }) => { setDateRange(detail.value); setSelectedDate(''); setPage(0); }}
              relativeOptions={[
                { key: 'last-7', amount: 7, unit: 'day', type: 'relative' },
                { key: 'last-14', amount: 14, unit: 'day', type: 'relative' },
                { key: 'last-30', amount: 30, unit: 'day', type: 'relative' },
              ]}
              isValidRange={(range) => {
                if (range.type === 'absolute') {
                  if (!range.startDate || !range.endDate) return { valid: false, errorMessage: 'Sélectionnez les deux dates' };
                }
                return { valid: true };
              }}
              i18nStrings={{
                todayAriaLabel: "Aujourd'hui",
                nextMonthAriaLabel: 'Mois suivant',
                previousMonthAriaLabel: 'Mois précédent',
                relativeModeTitle: 'Relatif',
                absoluteModeTitle: 'Absolu',
                relativeRangeSelectionHeading: 'Période relative',
                startDateLabel: 'Date de début',
                endDateLabel: 'Date de fin',
                startTimeLabel: 'Heure de début',
                endTimeLabel: 'Heure de fin',
                applyButtonLabel: 'Appliquer',
                cancelButtonLabel: 'Annuler',
                clearButtonLabel: 'Effacer',
                customRelativeRangeOptionLabel: 'Personnalisé',
                customRelativeRangeOptionDescription: 'Définir une période personnalisée',
                customRelativeRangeUnitLabel: 'Unité',
                customRelativeRangeDurationLabel: 'Durée',
                customRelativeRangeDurationPlaceholder: 'Nombre',
                formatRelativeRange: (range) => `${range.amount} dernier${range.amount > 1 ? 's' : ''} ${range.unit === 'day' ? 'jour' : range.unit === 'week' ? 'semaine' : 'mois'}${range.amount > 1 ? 's' : ''}`,
                formatUnit: (unit, value) => value === 1 ? (unit === 'day' ? 'jour' : unit === 'week' ? 'semaine' : 'mois') : (unit === 'day' ? 'jours' : unit === 'week' ? 'semaines' : 'mois'),
                dateTimeConstraintText: '',
                renderSelectedAbsoluteRangeAriaLive: (startDate, endDate) => `Du ${startDate} au ${endDate}`,
              }}
              dateOnly
              placeholder="Sélectionner une période"
            />
          </FormField>
          {(selectedDate || dateRange) && (
            <Button variant="link" onClick={() => { setSelectedDate(''); setDateRange(null); setPage(0); }}>Réinitialiser les filtres</Button>
          )}
          {analysis && (
            <Container header={<Header variant="h4">Analyse IA</Header>}>
              <Box variant="p">{analysis}</Box>
            </Container>
          )}
        </SpaceBetween>
      </Container>

      {/* Activity heatmap + dream cards */}
      <Container header={<Header variant="h3">Activité nocturne ({dreamDays.length} nuits)</Header>}>
        <SpaceBetween size="s">
          {dreamDays.length > 0 && (
            <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
              {dreamDays.slice(0, 30).map(d => (
                <div key={d.date} onClick={() => { setSelectedDate(d.date); setDateRange(null); setPage(0); }}
                  title={d.date + ' — ' + d.dreamsGenerated + ' rêves (' + d.time + ')'}
                  style={{ width: '28px', height: '28px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: '#fff', background: d.dreamsGenerated >= 4 ? '#0972d3' : d.dreamsGenerated >= 2 ? '#5f9fd4' : '#b8d4e3', border: selectedDate === d.date ? '2px solid #000' : '1px solid transparent' }}>
                  {d.dreamsGenerated}
                </div>
              ))}
            </div>
          )}
          <Box variant="small" color="text-body-secondary">
            Cliquez sur un carré pour filtrer par nuit. Couleur = nombre de rêves générés.
          </Box>
        </SpaceBetween>
      </Container>

      {/* Dream cards in 2-column grid */}
      <Container header={<Header variant="h3" counter={'(' + filteredDreams.length + ')'} description={'Page ' + (page + 1) + '/' + Math.max(totalPages, 1)}>
        {selectedDate ? 'Rêves du ' + selectedDate : dateRange ? 'Rêves filtrés' : 'Tous les rêves'}
      </Header>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={2}>
            {pagedDreams.length === 0 ? (
              <Box color="text-body-secondary" textAlign="center" padding="l">Aucun rêve pour cette sélection.</Box>
            ) : pagedDreams.map((dream, i) => {
              const globalIdx = page * PAGE_SIZE + i;
              return (
                <Container key={dream.id || globalIdx} header={<Header variant="h5" actions={<Button variant="icon" iconName={expandedDream === globalIdx ? 'angle-up' : 'angle-down'} onClick={() => setExpandedDream(expandedDream === globalIdx ? null : globalIdx)} />}><SpaceBetween direction="horizontal" size="xs"><Box variant="small" color="text-body-secondary">{dream.created_at ? new Date(dream.created_at).toLocaleDateString('fr-CA') : ''}</Box>{dream.metadata?.type && <StatusIndicator type={dream.metadata.type === 'edge_case' ? 'warning' : 'info'}>{dream.metadata.type}</StatusIndicator>}</SpaceBetween></Header>}>
                  {expandedDream !== globalIdx && <Box variant="small">{(dream.narrative || '').slice(0, 120)}...</Box>}
                  {expandedDream === globalIdx && (
                    <SpaceBetween size="m">
                      <Box variant="p">{dream.narrative}</Box>
                      {dream.extracted_motifs?.length > 0 && <Box><Box variant="awsui-key-label">Motifs</Box><Box>{dream.extracted_motifs.join(', ')}</Box></Box>}
                      {dream.scenario && (<Container header={<Header variant="h5">Scénario</Header>}><SpaceBetween size="xs">{dream.scenario.setup && <Box><Box variant="awsui-key-label">Setup</Box><Box variant="small">{dream.scenario.setup}</Box></Box>}{dream.scenario.trigger && <Box><Box variant="awsui-key-label">Trigger</Box><Box variant="small">{dream.scenario.trigger}</Box></Box>}{dream.scenario.expected_behavior && <Box><Box variant="awsui-key-label">Attendu</Box><Box variant="small">{dream.scenario.expected_behavior}</Box></Box>}</SpaceBetween></Container>)}
                      {dream.actionable_test && <Box><Box variant="awsui-key-label">Test</Box><Box variant="small">{dream.actionable_test}</Box></Box>}
                      <Box variant="small" color="text-body-secondary">ID: {dream.id} · Expire: {dream.expires_at ? new Date(dream.expires_at).toLocaleDateString('fr-CA') : '—'}</Box>
                    </SpaceBetween>
                  )}
                </Container>
              );
            })}
          </ColumnLayout>
          {totalPages > 1 && (
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={page === 0} onClick={() => setPage(page - 1)} iconName="angle-left">Précédent</Button>
              <Box variant="small" padding={{ top: 'xs' }}>Page {page + 1} / {totalPages}</Box>
              <Button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} iconName="angle-right" iconAlign="right">Suivant</Button>
            </SpaceBetween>
          )}
        </SpaceBetween>
      </Container>

      {/* Active policies */}
      {approvedPolicies.length > 0 && (<Container header={<Header variant="h3" counter={'(' + approvedPolicies.length + ')'}>Politiques actives</Header>}><SpaceBetween size="xs">{approvedPolicies.map(p => (<SpaceBetween key={p.id} direction="horizontal" size="xs"><StatusIndicator type="success">{p.title || p.id}</StatusIndicator><Box variant="small" color="text-body-secondary">{p.description}</Box></SpaceBetween>))}</SpaceBetween></Container>)}

      {/* Configuration */}
      <Container header={<Header variant="h3" actions={<Button variant="primary" onClick={saveConfig} iconName="upload">Sauvegarder</Button>}>Configuration</Header>}>
        <SpaceBetween size="m">
          <Toggle checked={config.enabled} onChange={({ detail }) => setConfig({ ...config, enabled: detail.checked })}>{config.enabled ? 'Dream Engine activé (1h-5h)' : 'Dream Engine désactivé'}</Toggle>
          <ColumnLayout columns={3}>
            <FormField label="Modèle"><Select selectedOption={dreamModelOptions.find(o => o.value === config.model) || { value: config.model, label: config.model }} onChange={({ detail }) => setConfig({ ...config, model: detail.selectedOption.value })} options={dreamModelOptions} /></FormField>
            <FormField label="Rêves max / nuit"><Input type="number" value={String(config.maxDreams)} onChange={({ detail }) => setConfig({ ...config, maxDreams: parseInt(detail.value) || 5 })} /></FormField>
            <FormField label="Température"><Input type="number" value={String(config.temperature)} onChange={({ detail }) => setConfig({ ...config, temperature: parseFloat(detail.value) || 1.4 })} /></FormField>
          </ColumnLayout>
          <ColumnLayout columns={2}>
            <FormField label="Expiration (jours)"><Input type="number" value={String(config.ephemeralDays)} onChange={({ detail }) => setConfig({ ...config, ephemeralDays: parseInt(detail.value) || 14 })} /></FormField>
            <FormField label="Scénarios edge-case"><Toggle checked={config.scenariosEnabled} onChange={({ detail }) => setConfig({ ...config, scenariosEnabled: detail.checked })}>{config.scenariosEnabled ? 'Activés' : 'Désactivés'}</Toggle></FormField>
          </ColumnLayout>
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}
