import { useState, useEffect, useCallback } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Tabs from '@cloudscape-design/components/tabs';
import Select from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import Textarea from '@cloudscape-design/components/textarea';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Toggle from '@cloudscape-design/components/toggle';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Spinner from '@cloudscape-design/components/spinner';
import TokenGroup from '@cloudscape-design/components/token-group';

// Reusable tag list editor: type in the input, press Enter to add, click X to remove
function TagListEditor({ items, onChange, placeholder }) {
  const [inputVal, setInputVal] = useState('');
  const tokens = (items || []).filter(Boolean).map(v => ({ label: v, dismissLabel: 'Retirer ' + v }));
  return (
    <SpaceBetween size="xs">
      <div style={{ display: 'flex', gap: '6px' }}>
        <div style={{ flex: 1 }}>
          <Input value={inputVal} onChange={({ detail }) => setInputVal(detail.value)}
            onKeyDown={({ detail }) => {
              if (detail.key === 'Enter' && inputVal.trim()) {
                onChange([...(items || []), inputVal.trim()]);
                setInputVal('');
              }
            }}
            placeholder={placeholder || 'Tapez et appuyez Entrée'}
          />
        </div>
        <Button onClick={() => { if (inputVal.trim()) { onChange([...(items || []), inputVal.trim()]); setInputVal(''); } }} iconName="add-plus">Ajouter</Button>
      </div>
      {tokens.length > 0 && (
        <TokenGroup items={tokens} onDismiss={({ detail }) => {
          const newItems = [...(items || [])];
          newItems.splice(detail.itemIndex, 1);
          onChange(newItems);
        }} />
      )}
    </SpaceBetween>
  );
}

// Presence device editor: Name + MAC pairs
function PresenceDeviceEditor({ devices, onChange }) {
  // Parse "Name1:mac1,Name2:mac2" into array of {name, mac}
  const parsed = (devices || '').split(',').map(e => {
    const parts = e.trim().split(':');
    if (parts.length < 2) return null;
    return { name: parts[0].trim(), mac: parts.slice(1).join(':').trim() };
  }).filter(Boolean);

  const [newName, setNewName] = useState('');
  const [newMac, setNewMac] = useState('');

  const serialize = (list) => list.map(d => d.name + ':' + d.mac).join(',');
  const add = () => {
    if (!newName.trim() || !newMac.trim()) return;
    onChange(serialize([...parsed, { name: newName.trim(), mac: newMac.trim().toLowerCase() }]));
    setNewName(''); setNewMac('');
  };
  const remove = (idx) => { const n = [...parsed]; n.splice(idx, 1); onChange(serialize(n)); };

  return (
    <SpaceBetween size="s">
      {parsed.length > 0 && (
        <TokenGroup items={parsed.map(d => ({ label: d.name + '  (' + d.mac + ')', dismissLabel: 'Retirer ' + d.name }))}
          onDismiss={({ detail }) => remove(detail.itemIndex)} />
      )}
      <ColumnLayout columns={3}>
        <FormField label="Nom">
          <Input value={newName} onChange={({ detail }) => setNewName(detail.value)} placeholder="Serge"
            onKeyDown={({ detail }) => { if (detail.key === 'Enter') add(); }} />
        </FormField>
        <FormField label="Adresse MAC">
          <Input value={newMac} onChange={({ detail }) => setNewMac(detail.value)} placeholder="aa:bb:cc:dd:ee:ff"
            onKeyDown={({ detail }) => { if (detail.key === 'Enter') add(); }} />
        </FormField>
        <FormField label=" ">
          <Button onClick={add} iconName="add-plus">Ajouter</Button>
        </FormField>
      </ColumnLayout>
    </SpaceBetween>
  );
}

// --- Minimal YAML helpers for our config shapes ---
function parseRoutingYaml(text) {
  const routes = [];
  let defaultModel = 'qwen3:8b';
  const routeBlocks = text.split(/^\s+-\s+name:/m);
  // parse default
  const defMatch = text.match(/default:\s*\n\s+model:\s*(.+)/);
  if (defMatch) defaultModel = defMatch[1].trim();
  // parse routes
  for (let i = 1; i < routeBlocks.length; i++) {
    const block = '  - name:' + routeBlocks[i];
    const name = (block.match(/name:\s*(.+)/) || [])[1]?.trim() || '';
    const model = (block.match(/model:\s*(.+)/) || [])[1]?.trim() || defaultModel;
    const patterns = [];
    const patternMatches = block.matchAll(/^\s+-\s+"(.+)"/gm);
    for (const m of patternMatches) patterns.push(m[1]);
    routes.push({ name, model, patterns });
  }
  return { routes, defaultModel };
}

function buildRoutingYaml(data) {
  let yaml = `# Vertex Nova — Model Routing\n\nroutes:\n`;
  for (const r of data.routes) {
    yaml += `  - name: ${r.name}\n    patterns:\n`;
    for (const p of r.patterns) yaml += `      - "${p}"\n`;
    yaml += `    model: ${r.model}\n\n`;
  }
  yaml += `default:\n  model: ${data.defaultModel}\n`;
  return yaml;
}

function parseProactiveYaml(text) {
  const actions = [];
  const routing = {};
  // Parse routing blocks
  const routingMatch = text.match(/routing:([\s\S]*?)actions:/);
  if (routingMatch) {
    const rBlock = routingMatch[1];
    const sections = rBlock.matchAll(/(\w+):\s*\n((?:\s{4,}.+\n)*)/g);
    for (const s of sections) {
      const name = s[1];
      const block = s[2];
      const channel = (block.match(/channel:\s*(.+)/) || [])[1]?.trim() || '';
      const device = (block.match(/device:\s*(.+)/) || [])[1]?.trim() || '';
      const room = (block.match(/room:\s*(.+)/) || [])[1]?.trim() || '';
      const hours = (block.match(/hours:\s*\[([^\]]+)\]/) || [])[1]?.split(',').map(h => parseInt(h.trim())) || [];
      routing[name] = { channel, device, room, hours };
    }
  }
  // Parse actions
  const actionBlocks = text.split(/^\s+-\s+name:/m);
  for (let i = 1; i < actionBlocks.length; i++) {
    const block = '  - name:' + actionBlocks[i];
    const name = (block.match(/name:\s*(.+)/) || [])[1]?.trim() || '';
    const desc = (block.match(/description:\s*"(.+)"/) || [])[1]?.trim() || '';
    const interval = parseInt((block.match(/interval_minutes:\s*(\d+)/) || [])[1] || '60');
    const model = (block.match(/model:\s*(.+)/) || [])[1]?.trim() || 'qwen3:8b';
    const priority = (block.match(/priority:\s*(.+)/) || [])[1]?.trim() || 'medium';
    const dayOfWeek = (block.match(/day_of_week:\s*(.+)/) || [])[1]?.trim() || '';
    const activeHours = (block.match(/active_hours:\s*\[([^\]]+)\]/) || [])[1]?.split(',').map(h => parseInt(h.trim())) || [];
    const notify = (block.match(/notify_condition:\s*(.+)/) || [])[1]?.trim() || 'not_skip';
    const prompt = (block.match(/prompt:\s*>\s*\n((?:\s{6,}.+\n?)*)/) || [])[1]?.replace(/^\s{6}/gm, '').trim() || '';
    actions.push({ name, description: desc, interval_minutes: interval, model, priority, day_of_week: dayOfWeek, active_hours: activeHours, notify_condition: notify, prompt, enabled: true });
  }
  // Parse behavior
  const maxNotif = parseInt((text.match(/max_notifications_per_hour:\s*(\d+)/) || [])[1] || '4');
  const minInterval = parseInt((text.match(/min_interval_minutes:\s*(\d+)/) || [])[1] || '10');
  return { routing, actions, behavior: { max_notifications_per_hour: maxNotif, min_interval_minutes: minInterval } };
}

function buildProactiveYaml(data) {
  let yaml = `# Vertex Nova — Proactive Actions Configuration\n\nrouting:\n`;
  for (const [name, r] of Object.entries(data.routing)) {
    yaml += `  ${name}:\n    hours: [${r.hours.join(', ')}]\n    channel: ${r.channel}\n`;
    if (r.device) yaml += `    device: ${r.device}\n`;
    if (r.room) yaml += `    room: ${r.room}\n`;
  }
  yaml += `\nactions:\n`;
  for (const a of data.actions) {
    yaml += `  - name: ${a.name}\n    description: "${a.description}"\n    interval_minutes: ${a.interval_minutes}\n    model: ${a.model}\n`;
    if (a.day_of_week) yaml += `    day_of_week: ${a.day_of_week}\n`;
    if (a.active_hours?.length) yaml += `    active_hours: [${a.active_hours.join(', ')}]\n`;
    yaml += `    prompt: >\n`;
    for (const line of a.prompt.split('\n')) yaml += `      ${line}\n`;
    yaml += `    notify_condition: ${a.notify_condition}\n    priority: ${a.priority}\n\n`;
  }
  yaml += `behavior:\n  max_notifications_per_hour: ${data.behavior.max_notifications_per_hour}\n  min_interval_minutes: ${data.behavior.min_interval_minutes}\n  high_priority_bypass: true\n`;
  return yaml;
}

// ============================================================
// Sub-panels
// ============================================================

function ModelsPanel({ api }) {
  const [models, setModels] = useState(null);
  const [ollamaModels, setOllamaModels] = useState([]);
  const [echoDevices, setEchoDevices] = useState([]);
  const [alert, setAlert] = useState(null);

  const load = useCallback(() => {
    fetch(api + '/api/models').then(r => r.json()).then(setModels).catch(() => {});
    fetch(api + '/api/ollama-models').then(r => r.json()).then(d => setOllamaModels(d.models || [])).catch(() => {});
    fetch(api + '/api/alexa/echo-devices').then(r => r.json()).then(d => setEchoDevices(d.devices || [])).catch(() => {});
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const save = async (key, val) => {
    try {
      await fetch(api + '/api/models', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: val }),
      });
      setAlert({ type: 'success', text: key + ' mis à jour' });
      // Reload all values from server to stay in sync
      load();
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  if (!models) return <Spinner size="large" />;

  // Build Ollama model options
  const installedNames = new Set(ollamaModels.map(m => m.name));
  const knownOllamaModels = [
    { value: 'qwen3:8b', label: 'Qwen3 8B — rapide, bon français, outils' },
    { value: 'qwen3:4b', label: 'Qwen3 4B — très rapide, qualité OK' },
    { value: 'qwen3:14b', label: 'Qwen3 14B — meilleur raisonnement, lent' },
    { value: 'gemma4:e2b', label: 'Gemma 4 E2B — vision, multimodal' },
    { value: 'gemma4', label: 'Gemma 4 12B — bon raisonnement, lent' },
    { value: 'mistral', label: 'Mistral 7B — léger, français moyen' },
    { value: 'llama3.1:8b', label: 'Llama 3.1 8B — polyvalent' },
  ];
  const ollamaOptions = knownOllamaModels.map(m => ({
    value: m.value,
    label: m.label + (installedNames.has(m.value) ? ' ✅' : ''),
  }));
  for (const m of ollamaModels) {
    if (!knownOllamaModels.find(k => k.value === m.name)) {
      ollamaOptions.push({ value: m.name, label: m.name + ' (' + Math.round(m.size / 1e9 * 10) / 10 + ' GB) ✅' });
    }
  }
  // Ensure current model is always in the list
  const currentOllama = models.ollama_model || 'qwen3:8b';
  if (!ollamaOptions.find(o => o.value === currentOllama)) {
    ollamaOptions.unshift({ value: currentOllama, label: currentOllama + ' (actuel)' });
  }

  const claudeOptions = [
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 (le plus capable)' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (recommandé — équilibré)' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (rapide, économique)' },
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (ancien)' },
    { value: 'claude-opus-4-20250514', label: 'Claude Opus 4 (ancien)' },
  ];
  const currentClaude = models.claude_model || 'claude-sonnet-4-6';
  if (!claudeOptions.find(o => o.value === currentClaude)) {
    claudeOptions.unshift({ value: currentClaude, label: currentClaude + ' (actuel)' });
  }

  const pick = (options, value) => options.find(o => o.value === value) || options[0] || { value: '', label: '—' };

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}

      <Container header={<Header variant="h3">Modèles IA</Header>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={2}>
            <FormField label="Modèle principal (Ollama)" description="Utilisé pour 80%+ des requêtes. Les modèles avec ✅ sont installés.">
              <Select
                selectedOption={pick(ollamaOptions, currentOllama)}
                onChange={({ detail }) => save('OLLAMA_MODEL', detail.selectedOption.value)}
                options={ollamaOptions}
              />
            </FormField>
            <FormField label="Modèle Claude (escalation)" description="Utilisé pour vision, raisonnement complexe, et quand Ollama échoue.">
              <Select
                selectedOption={pick(claudeOptions, currentClaude)}
                onChange={({ detail }) => save('CLAUDE_MODEL', detail.selectedOption.value)}
                options={claudeOptions}
              />
            </FormField>
          </ColumnLayout>
          <Box variant="small" color="text-body-secondary">
            Clé API Claude: {models.has_claude_key ? '✅ Configurée' : '❌ Non configurée (modifier dans .env)'}
          </Box>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h3">Sonos</Header>}>
        <ColumnLayout columns={2}>
          <FormField label="Pièce par défaut">
            <Input value={models.sonos_default_room || ''} onChange={({ detail }) => save('SONOS_DEFAULT_ROOM', detail.value)} placeholder="Living Room" />
          </FormField>
          <FormField label="Volume TTS (0-100)">
            <Input type="number" value={String(models.sonos_tts_volume || 30)} onChange={({ detail }) => save('SONOS_TTS_VOLUME', detail.value)} />
          </FormField>
          <FormField label="Pièce de jour" description="Utilisée entre 7h et 22h">
            <Input value={models.sonos_day_room || ''} onChange={({ detail }) => save('SONOS_DAY_ROOM', detail.value)} placeholder="Living Room" />
          </FormField>
          <FormField label="Pièce de nuit" description="Utilisée entre 22h et 7h">
            <Input value={models.sonos_night_room || ''} onChange={({ detail }) => save('SONOS_NIGHT_ROOM', detail.value)} placeholder="Basement" />
          </FormField>
        </ColumnLayout>
      </Container>

      <Container header={<Header variant="h3">Echo (Alexa API)</Header>}>
        {echoDevices.length > 0 ? (
          <SpaceBetween size="m">
            <Box variant="small" color="text-body-secondary">
              {echoDevices.length} appareil(s) Echo détecté(s): {echoDevices.map(d => d.name + (d.online ? ' 🟢' : ' ⚫')).join(', ')}
            </Box>
            <ColumnLayout columns={3}>
              <FormField label="Matin (7-9h)">
                <Select
                  selectedOption={models.echo_morning_device ? { value: models.echo_morning_device, label: models.echo_morning_device } : null}
                  onChange={({ detail }) => save('ECHO_MORNING_DEVICE', detail.selectedOption.value)}
                  options={echoDevices.map(d => ({ value: d.name, label: d.name + (d.online ? ' 🟢' : ' ⚫') }))}
                  placeholder="Sélectionner"
                />
              </FormField>
              <FormField label="Bureau (9-17h)">
                <Select
                  selectedOption={models.echo_workday_device ? { value: models.echo_workday_device, label: models.echo_workday_device } : null}
                  onChange={({ detail }) => save('ECHO_WORKDAY_DEVICE', detail.selectedOption.value)}
                  options={echoDevices.map(d => ({ value: d.name, label: d.name + (d.online ? ' 🟢' : ' ⚫') }))}
                  placeholder="Sélectionner"
                />
              </FormField>
              <FormField label="Soir (17-19h)">
                <Select
                  selectedOption={models.echo_evening_device ? { value: models.echo_evening_device, label: models.echo_evening_device } : null}
                  onChange={({ detail }) => save('ECHO_EVENING_DEVICE', detail.selectedOption.value)}
                  options={echoDevices.map(d => ({ value: d.name, label: d.name + (d.online ? ' 🟢' : ' ⚫') }))}
                  placeholder="Sélectionner"
                />
              </FormField>
            </ColumnLayout>
          </SpaceBetween>
        ) : (
          <Box color="text-body-secondary">Aucun appareil Echo détecté. Vérifiez les cookies Alexa dans la section ci-dessous.</Box>
        )}
      </Container>

      <Container header={<Header variant="h3">Maison & Actualités</Header>}>
        <ColumnLayout columns={2}>
          <FormField label="Localisation" description="Pour météo et actions proactives">
            <Input value={models.home_location || ''} onChange={({ detail }) => save('HOME_LOCATION', detail.value)} placeholder="Montreal, QC" />
          </FormField>
          <FormField label="Pays">
            <Input value={models.home_country || ''} onChange={({ detail }) => save('HOME_COUNTRY', detail.value)} placeholder="Canada" />
          </FormField>
          <FormField label="Locale Google News">
            <Input value={models.news_locale || ''} onChange={({ detail }) => save('NEWS_LOCALE', detail.value)} placeholder="fr-CA" />
          </FormField>
          <FormField label="Code pays Google News">
            <Input value={models.news_country || ''} onChange={({ detail }) => save('NEWS_COUNTRY', detail.value)} placeholder="CA" />
          </FormField>
          <FormField label="Sujets d'actualité supplémentaires">
            <TagListEditor
              items={(models.news_extra_topics || '').split(',').filter(Boolean).map(s => s.trim())}
              onChange={(items) => save('NEWS_EXTRA_TOPICS', items.join(','))}
              placeholder="Ex: Cameroun, Technology..."
            />
          </FormField>
        </ColumnLayout>
      </Container>

      <Container header={<Header variant="h3">Agent IA (Strands)</Header>}>
        <Toggle checked={models.use_strands === true} onChange={({ detail }) => save('USE_STRANDS', detail.checked ? 'true' : 'false')}>
          {models.use_strands ? 'Strands activé — agents spécialisés avec Ollama' : 'Strands désactivé — mode natif'}
        </Toggle>
      </Container>

      <Container header={<Header variant="h3">Films & Divertissement</Header>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={2}>
            <FormField label="Clé API TMDB (v3)" description="Gratuite sur themoviedb.org">
              <Input value={models.tmdb_api_key || ''} onChange={({ detail }) => save('TMDB_API_KEY', detail.value)} placeholder="Clé API v3" />
            </FormField>
            <FormField label="Token TMDB (Read Access)" description={models.tmdb_read_token ? '✅ Configuré' : 'Bearer token pour l\'API v4 — themoviedb.org/settings/api'}>
              <Input value={models.tmdb_read_token ? '' : ''} onChange={({ detail }) => { if (detail.value.length > 10) save('TMDB_READ_TOKEN', detail.value); }} placeholder={models.tmdb_read_token ? 'Token configuré — collez un nouveau pour remplacer' : 'eyJhbGci...'} />
            </FormField>
            <FormField label="Région">
              <Input value={models.movie_region || 'CA'} onChange={({ detail }) => save('MOVIE_REGION', detail.value)} placeholder="CA" />
            </FormField>
          </ColumnLayout>
          <FormField label="Langues des films" description="Ajoutez les codes langue (fr, en, es...)">
            <TagListEditor
              items={(models.movie_languages || 'fr').split(',').filter(Boolean).map(s => s.trim())}
              onChange={(items) => save('MOVIE_LANGUAGES', items.join(','))}
              placeholder="fr, en, es..."
            />
          </FormField>
          <FormField label="Genres préférés">
            <TagListEditor
              items={(models.movie_genres || '').split(',').filter(Boolean).map(s => s.trim())}
              onChange={(items) => save('MOVIE_GENRES', items.join(','))}
              placeholder="action, comedy, drama..."
            />
          </FormField>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h3">Alexa Smart Home API</Header>}>
        <SpaceBetween size="m">
          <Alert type="info">
            Cookies extraits de alexa.amazon.com (DevTools → Application → Cookies). Permet de surveiller les appareils connectés à Alexa.
          </Alert>
          <ColumnLayout columns={2}>
            <FormField label="UBID Main" description={models.alexa_configured ? '✅ Configuré' : 'Non configuré'}>
              <Input value="" placeholder="Coller ubid-main ici pour remplacer" onChange={({ detail }) => { if (detail.value) save('ALEXA_UBID_MAIN', detail.value); }} />
            </FormField>
            <FormField label="AT Main" description={models.alexa_configured ? '✅ Configuré' : 'Non configuré'}>
              <Input value="" placeholder="Coller at-main ici pour remplacer" onChange={({ detail }) => { if (detail.value) save('ALEXA_AT_MAIN', detail.value); }} />
            </FormField>
          </ColumnLayout>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h3">Détection de présence (WiFi)</Header>}>
        <SpaceBetween size="m">
          <Alert type="info">
            Détecte qui est à la maison via l'adresse MAC du téléphone sur le réseau WiFi. Trouvez les MAC avec la commande: arp -a
          </Alert>
          <PresenceDeviceEditor
            devices={models.presence_devices || ''}
            onChange={(val) => save('PRESENCE_DEVICES', val)}
          />
          <FormField label="Intervalle de vérification (secondes)">
            <Input type="number" value={models.presence_poll_seconds || '30'} onChange={({ detail }) => save('PRESENCE_POLL_SECONDS', detail.value)} />
          </FormField>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h3">Canaux de communication</Header>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={2}>
            <Container header={<Header variant="h4">Telegram</Header>}>
              <SpaceBetween size="s">
                <Toggle checked={models.telegram_enabled === true} onChange={({ detail }) => save('TELEGRAM_ENABLED', detail.checked ? 'true' : 'false')}>
                  {models.telegram_enabled ? 'Activé' : 'Désactivé'}
                </Toggle>
                <FormField label="Bot token" description="Masqué pour sécurité (modifier dans .env)">
                  <Input value={models.telegram_bot_token || ''} disabled />
                </FormField>
                <FormField label="User IDs autorisés" description="Ajoutez les IDs Telegram des utilisateurs autorisés">
                  <TagListEditor
                    items={(models.telegram_allowed_user_ids || '').split(',').filter(Boolean)}
                    onChange={(items) => save('TELEGRAM_ALLOWED_USER_IDS', items.join(','))}
                    placeholder="Entrez un User ID et appuyez Entrée"
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h4">WhatsApp</Header>}>
              <SpaceBetween size="s">
                <Toggle checked={models.whatsapp_enabled === true} onChange={({ detail }) => save('WHATSAPP_ENABLED', detail.checked ? 'true' : 'false')}>
                  {models.whatsapp_enabled ? 'Activé' : 'Désactivé'}
                </Toggle>
                <FormField label="Phone ID">
                  <Input value={models.whatsapp_phone_id || ''} onChange={({ detail }) => save('WHATSAPP_PHONE_ID', detail.value)} />
                </FormField>
                <FormField label="Webhook port">
                  <Input type="number" value={models.whatsapp_webhook_port || '3001'} onChange={({ detail }) => save('WHATSAPP_WEBHOOK_PORT', detail.value)} />
                </FormField>
              </SpaceBetween>
            </Container>
          </ColumnLayout>
          <Alert type="info">
            Les changements de canaux nécessitent un redémarrage. Les User IDs Telegram acceptent plusieurs valeurs séparées par virgules.
          </Alert>
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}

function RoutingPanel({ api }) {
  const [yaml, setYaml] = useState('');
  const [parsed, setParsed] = useState({ routes: [], defaultModel: 'qwen3:8b' });
  const [alert, setAlert] = useState(null);

  const modelOptions = [
    { value: 'qwen3:8b', label: 'Qwen3 8B (local, rapide)' },
    { value: 'qwen3:4b', label: 'Qwen3 4B (très rapide)' },
    { value: 'qwen3:14b', label: 'Qwen3 14B (meilleur raisonnement)' },
    { value: 'claude', label: 'Claude (API, escalation)' },
    { value: 'gemma4:e2b', label: 'Gemma 4 E2B (vision)' },
    { value: 'gemma4', label: 'Gemma 4 12B' },
    { value: 'mistral', label: 'Mistral 7B' },
  ];
  const findModel = (val) => modelOptions.find(o => o.value === val) || { value: val, label: val };

  const load = useCallback(async () => {
    try {
      const res = await fetch(api + '/api/config?file=config/routing.yaml');
      const data = await res.json();
      setYaml(data.content || '');
      setParsed(parseRoutingYaml(data.content || ''));
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  // Form → YAML sync
  const updateFromForm = (newParsed) => {
    setParsed(newParsed);
    const newYaml = buildRoutingYaml(newParsed);
    setYaml(newYaml);
  };

  // YAML → Form sync
  const updateFromYaml = (newYaml) => {
    setYaml(newYaml);
    try {
      const newParsed = parseRoutingYaml(newYaml);
      setParsed(newParsed);
    } catch {}
  };

  const save = async () => {
    try {
      const res = await fetch(api + '/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'config/routing.yaml', content: yaml }),
      });
      const data = await res.json();
      if (data.saved) {
        await fetch(api + '/api/reload', { method: 'POST' });
        setAlert({ type: 'success', text: 'Routing sauvegardé et rechargé' });
      }
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const setRouteModel = (idx, model) => {
    const newRoutes = [...parsed.routes];
    newRoutes[idx] = { ...newRoutes[idx], model };
    updateFromForm({ ...parsed, routes: newRoutes });
  };

  const removeRoute = (idx) => {
    const newRoutes = parsed.routes.filter((_, i) => i !== idx);
    updateFromForm({ ...parsed, routes: newRoutes });
  };

  const addRoute = () => {
    updateFromForm({ ...parsed, routes: [...parsed.routes, { name: 'new-route', model: parsed.defaultModel, patterns: ['pattern'] }] });
  };

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}
      <ColumnLayout columns={2}>
        <Container header={<Header variant="h3">Règles de routage</Header>}>
          <SpaceBetween size="m">
            <FormField label="Modèle par défaut">
              <Select
                selectedOption={findModel(parsed.defaultModel)}
                onChange={({ detail }) => updateFromForm({ ...parsed, defaultModel: detail.selectedOption.value })}
                options={modelOptions}
              />
            </FormField>
            {parsed.routes.map((r, i) => (
              <Container key={i} header={<Header variant="h4" actions={<Button variant="icon" iconName="close" onClick={() => removeRoute(i)} />}>{r.name}</Header>}>
                <SpaceBetween size="xs">
                  <FormField label="Modèle">
                    <Select
                      selectedOption={findModel(r.model)}
                      onChange={({ detail }) => setRouteModel(i, detail.selectedOption.value)}
                      options={modelOptions}
                    />
                  </FormField>
                  <FormField label="Patterns">
                    <Input value={r.patterns.join(', ')} onChange={({ detail }) => {
                      const newRoutes = [...parsed.routes];
                      newRoutes[i] = { ...r, patterns: detail.value.split(',').map(p => p.trim()).filter(Boolean) };
                      updateFromForm({ ...parsed, routes: newRoutes });
                    }} />
                  </FormField>
                </SpaceBetween>
              </Container>
            ))}
            <Button onClick={addRoute} iconName="add-plus">Ajouter une règle</Button>
          </SpaceBetween>
        </Container>
        <Container header={
          <Header variant="h3" actions={<Button variant="primary" onClick={save}>Sauvegarder</Button>}>
            YAML
          </Header>
        }>
          <Textarea value={yaml} onChange={({ detail }) => updateFromYaml(detail.value)} rows={20} />
        </Container>
      </ColumnLayout>
    </SpaceBetween>
  );
}

function ProactivePanel({ api }) {
  const [yaml, setYaml] = useState('');
  const [parsed, setParsed] = useState({ routing: {}, actions: [], behavior: { max_notifications_per_hour: 4, min_interval_minutes: 10 } });
  const [alert, setAlert] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(api + '/api/config?file=config/proactive.yaml');
      const data = await res.json();
      setYaml(data.content || '');
      setParsed(parseProactiveYaml(data.content || ''));
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const updateFromForm = (newParsed) => {
    setParsed(newParsed);
    setYaml(buildProactiveYaml(newParsed));
  };

  const updateFromYaml = (newYaml) => {
    setYaml(newYaml);
    try { setParsed(parseProactiveYaml(newYaml)); } catch {}
  };

  const save = async () => {
    try {
      const res = await fetch(api + '/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'config/proactive.yaml', content: yaml }),
      });
      const data = await res.json();
      setAlert({ type: data.saved ? 'success' : 'error', text: data.saved ? 'Actions proactives sauvegardées' : data.error });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const updateAction = (idx, field, value) => {
    const newActions = [...parsed.actions];
    newActions[idx] = { ...newActions[idx], [field]: value };
    updateFromForm({ ...parsed, actions: newActions });
  };

  const removeAction = (idx) => {
    updateFromForm({ ...parsed, actions: parsed.actions.filter((_, i) => i !== idx) });
  };

  const ICONS = { 'breaking-news': '🌍', 'weather-alert': '🌪️', 'home-maintenance-check': '🔧', 'email-digest': '📬', 'friday-movies': '🎬', 'weekend-activities': '🎯' };
  const proactiveModelOptions = [
    { value: 'qwen3:8b', label: 'Qwen3 8B' },
    { value: 'claude', label: 'Claude' },
    { value: 'gemma4:e2b', label: 'Gemma 4 E2B' },
    { value: 'mistral', label: 'Mistral 7B' },
  ];
  const findPModel = (val) => proactiveModelOptions.find(o => o.value === val) || { value: val, label: val };

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}
      <ColumnLayout columns={2}>
        <SpaceBetween size="m">
          <Container header={<Header variant="h3">Actions proactives</Header>}>
            <SpaceBetween size="m">
              {parsed.actions.map((a, i) => (
                <Container key={i} header={
                  <Header variant="h4" actions={<Button variant="icon" iconName="close" onClick={() => removeAction(i)} />}>
                    {(ICONS[a.name] || '🏠') + ' ' + a.name}
                  </Header>
                }>
                  <ColumnLayout columns={2}>
                    <FormField label="Intervalle (min)">
                      <Input type="number" value={String(a.interval_minutes)} onChange={({ detail }) => updateAction(i, 'interval_minutes', parseInt(detail.value) || 60)} />
                    </FormField>
                    <FormField label="Modèle">
                      <Select
                        selectedOption={findPModel(a.model)}
                        onChange={({ detail }) => updateAction(i, 'model', detail.selectedOption.value)}
                        options={proactiveModelOptions}
                      />
                    </FormField>
                    <FormField label="Priorité">
                      <Select
                        selectedOption={{ 'high': { value: 'high', label: 'Haute' }, 'medium': { value: 'medium', label: 'Moyenne' }, 'low': { value: 'low', label: 'Basse' } }[a.priority] || { value: a.priority, label: a.priority }}
                        onChange={({ detail }) => updateAction(i, 'priority', detail.selectedOption.value)}
                        options={[
                          { value: 'high', label: 'Haute' },
                          { value: 'medium', label: 'Moyenne' },
                          { value: 'low', label: 'Basse' },
                        ]}
                      />
                    </FormField>
                    {a.day_of_week && (
                      <FormField label="Jour">
                        <Select
                          selectedOption={{ value: a.day_of_week, label: a.day_of_week }}
                          onChange={({ detail }) => updateAction(i, 'day_of_week', detail.selectedOption.value)}
                          options={['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d => ({ value: d, label: d }))}
                        />
                      </FormField>
                    )}
                  </ColumnLayout>
                  <FormField label="Prompt" stretch>
                    <Textarea value={a.prompt} onChange={({ detail }) => updateAction(i, 'prompt', detail.value)} rows={3} />
                  </FormField>
                </Container>
              ))}
            </SpaceBetween>
          </Container>
          <Container header={<Header variant="h3">Limites</Header>}>
            <ColumnLayout columns={2}>
              <FormField label="Max notifications / heure">
                <Input type="number" value={String(parsed.behavior.max_notifications_per_hour)} onChange={({ detail }) => updateFromForm({ ...parsed, behavior: { ...parsed.behavior, max_notifications_per_hour: parseInt(detail.value) || 4 } })} />
              </FormField>
              <FormField label="Intervalle minimum (min)">
                <Input type="number" value={String(parsed.behavior.min_interval_minutes)} onChange={({ detail }) => updateFromForm({ ...parsed, behavior: { ...parsed.behavior, min_interval_minutes: parseInt(detail.value) || 10 } })} />
              </FormField>
            </ColumnLayout>
          </Container>
        </SpaceBetween>
        <Container header={
          <Header variant="h3" actions={<Button variant="primary" onClick={save}>Sauvegarder</Button>}>
            YAML
          </Header>
        }>
          <Textarea value={yaml} onChange={({ detail }) => updateFromYaml(detail.value)} rows={30} />
        </Container>
      </ColumnLayout>
    </SpaceBetween>
  );
}

function AgentPromptPanel({ api }) {
  const [content, setContent] = useState('');
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    fetch(api + '/api/config?file=agent.md').then(r => r.json()).then(d => setContent(d.content || '')).catch(() => {});
  }, [api]);

  const save = async () => {
    try {
      const res = await fetch(api + '/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'agent.md', content }),
      });
      const data = await res.json();
      setAlert({ type: data.saved ? 'success' : 'error', text: data.saved ? 'Prompt sauvegardé' : data.error });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}
      <Container header={
        <Header variant="h2" actions={<Button variant="primary" onClick={save}>Sauvegarder</Button>}>
          Prompt de l'agent (agent.md)
        </Header>
      }>
        <Textarea value={content} onChange={({ detail }) => setContent(detail.value)} rows={30} />
      </Container>
    </SpaceBetween>
  );
}

// ============================================================
// Main ConfigPanel with tabs
// ============================================================

export default function ConfigPanel({ api }) {
  return (
    <Tabs tabs={[
      { id: 'models', label: 'Modèles & Appareils', content: <ModelsPanel api={api} /> },
      { id: 'routing', label: 'Routage', content: <RoutingPanel api={api} /> },
      { id: 'proactive', label: 'Actions proactives', content: <ProactivePanel api={api} /> },
      { id: 'prompt', label: 'Prompt agent', content: <AgentPromptPanel api={api} /> },
    ]} />
  );
}
