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
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Icon from '@cloudscape-design/components/icon';


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

// Per-person presence card editor — expandable cards with name, MAC, language, welcome style, room, notifications
function PresencePersonEditor({ api }) {
  const [people, setPeople] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [voiceDevices, setVoiceDevices] = useState([]);
  const [dirty, setDirty] = useState({});
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [vacationMode, setVacationMode] = useState(false);
  const [dndMode, setDndMode] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(api + '/api/presence/config').then(r => r.json()).catch(() => ({ people: [], settings: {} })),
      fetch(api + '/api/sonos/rooms').then(r => r.json()).catch(() => ({ rooms: [] })),
      fetch(api + '/api/alexa/echo-devices').then(r => r.json()).catch(() => ({ devices: [] })),
      fetch(api + '/api/presence').then(r => r.json()).catch(() => ({ vacationMode: false })),
      fetch(api + '/api/dnd').then(r => r.json()).catch(() => ({ enabled: false })),
    ]).then(([presData, sonosData, echoData, presState, dndState]) => {
      const loadedPeople = presData.people || [];
      setPeople(loadedPeople);
      setSettings(presData.settings || {});
      setVacationMode(!!presState.vacationMode);
      setDndMode(!!dndState.enabled);

      // Build combined voice device list (same approach as ChatPanel)
      const devs = [];
      for (const r of (sonosData.rooms || [])) {
        devs.push({ value: r.name, label: '🔈 ' + r.name + ' (Sonos)' });
      }
      for (const d of (echoData.devices || [])) {
        devs.push({ value: 'echo:' + d.name, label: '🔊 ' + d.name + ' (Echo' + (d.online ? ' 🟢' : '') + ')' });
      }
      setVoiceDevices(devs);

      // Expand all existing people on first load
      const exp = {};
      loadedPeople.forEach((_, i) => { exp[i] = true; });
      setExpanded(exp);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const saveAll = async (newPeople, newSettings) => {
    const ppl = newPeople || people;
    const stg = newSettings || settings;
    setPeople(ppl);
    setSettings(stg);
    setDirty({});
    setSettingsDirty(false);
    try {
      const res = await fetch(api + '/api/presence/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ people: ppl, settings: stg }),
      });
      const data = await res.json();
      if (data.saved) setAlert({ type: 'success', text: 'Présence sauvegardée (' + data.people + ' personnes)' });
      else setAlert({ type: 'error', text: data.error || 'Erreur' });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const updatePerson = (idx, field, value) => {
    const newPeople = [...people];
    newPeople[idx] = { ...newPeople[idx], [field]: value };
    setPeople(newPeople);
    setDirty({ ...dirty, [idx]: true });
  };

  const savePerson = () => { saveAll(people, settings); };

  const removePerson = (idx) => {
    const newPeople = people.filter((_, i) => i !== idx);
    saveAll(newPeople, settings);
  };

  const addPerson = () => {
    const newPeople = [...people, { name: '', mac: '', device: '', language: 'fr', welcome_style: 'briefing', welcome_room: '', notifications: 'both' }];
    setPeople(newPeople);
    setExpanded({ ...expanded, [newPeople.length - 1]: true });
    setDirty({ ...dirty, [newPeople.length - 1]: true });
  };

  const toggleExpand = (idx) => {
    setExpanded({ ...expanded, [idx]: !expanded[idx] });
  };

  const updateSetting = (key, value) => {
    setSettings({ ...settings, [key]: parseInt(value) || 0 });
    setSettingsDirty(true);
  };

  const toggleVacation = async (enabled) => {
    setVacationMode(enabled);
    try {
      const res = await fetch(api + '/api/presence/vacation', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      setVacationMode(!!data.vacationMode);
      setAlert({ type: 'success', text: enabled ? '🏖️ Mode vacances activé' : '🏠 Mode vacances désactivé' });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const toggleDnd = async (enabled) => {
    setDndMode(enabled);
    try {
      const res = await fetch(api + '/api/dnd', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      setDndMode(!!data.enabled);
      setAlert({ type: 'success', text: enabled ? '🔇 Mode silencieux activé' : '🔔 Notifications réactivées' });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const langOptions = [
    { value: 'fr', label: 'Français' },
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Español' },
  ];

  const styleOptions = [
    { value: 'simple', label: 'Simple — "Bienvenue [nom]"' },
    { value: 'briefing', label: 'Briefing — rappels + emails' },
    { value: 'activity_summary', label: 'Résumé complet — briefing + activités' },
  ];

  const notifOptions = [
    { value: 'both', label: 'Telegram + Voix' },
    { value: 'telegram', label: 'Telegram seulement' },
    { value: 'voice', label: 'Voix seulement' },
  ];

  // Build device options — ensure current person values are always in the list
  const buildDeviceOptions = (currentRoom) => {
    const opts = [...voiceDevices];
    if (currentRoom && !opts.find(o => o.value === currentRoom)) {
      opts.push({ value: currentRoom, label: currentRoom + ' (hors ligne)' });
    }
    return opts;
  };

  const pick = (options, value) => options.find(o => o.value === value) || (value ? { value, label: value } : null);

  if (loading) return <Spinner size="large" />;

  const hasDirty = Object.values(dirty).some(Boolean) || settingsDirty;

  return (
    <SpaceBetween size="m">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}
      <Toggle checked={vacationMode} onChange={({ detail }) => toggleVacation(detail.checked)}>
        {vacationMode ? '🏖️ Mode vacances activé — surveillance renforcée' : 'Mode vacances désactivé'}
      </Toggle>
      <Toggle checked={dndMode} onChange={({ detail }) => toggleDnd(detail.checked)}>
        {dndMode ? '🔇 Mode silencieux — toutes les notifications en pause' : '🔔 Notifications actives'}
      </Toggle>
      {people.map((person, idx) => {
        const deviceOpts = buildDeviceOptions(person.welcome_room);
        return (
          <Container key={idx} header={
            <Header variant="h4"
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button variant="icon" iconName={expanded[idx] ? 'angle-up' : 'angle-down'} onClick={() => toggleExpand(idx)} />
                  <Button variant="icon" iconName="close" onClick={() => removePerson(idx)} />
                </SpaceBetween>
              }
            >
              <span onClick={() => toggleExpand(idx)} style={{ cursor: 'pointer' }}>
                {person.name || '(nouveau)'} — {person.device || person.mac || '??:??:??'}
              </span>
            </Header>
          }>
            {expanded[idx] ? (
              <SpaceBetween size="s">
                <ColumnLayout columns={3}>
                  <FormField label="Nom">
                    <Input value={person.name} onChange={({ detail }) => updatePerson(idx, 'name', detail.value)} placeholder="Serge" />
                  </FormField>
                  <FormField label="Adresse MAC">
                    <Input value={person.mac} onChange={({ detail }) => updatePerson(idx, 'mac', detail.value.toLowerCase())} placeholder="aa:bb:cc:dd:ee:ff" />
                  </FormField>
                  <FormField label="Appareil">
                    <Input value={person.device || ''} onChange={({ detail }) => updatePerson(idx, 'device', detail.value)} placeholder="iPhone, Pixel 8 Pro..." />
                  </FormField>
                </ColumnLayout>
                <ColumnLayout columns={2}>
                  <FormField label="Langue">
                    <Select selectedOption={pick(langOptions, person.language)} onChange={({ detail }) => updatePerson(idx, 'language', detail.selectedOption.value)} options={langOptions} />
                  </FormField>
                  <FormField label="Style de bienvenue">
                    <Select selectedOption={pick(styleOptions, person.welcome_style)} onChange={({ detail }) => updatePerson(idx, 'welcome_style', detail.selectedOption.value)} options={styleOptions} />
                  </FormField>
                </ColumnLayout>
                <ColumnLayout columns={2}>
                  <FormField label="Appareil de bienvenue" description="Sonos ou Echo pour l'annonce d'arrivée">
                    <Select
                      selectedOption={pick(deviceOpts, person.welcome_room)}
                      onChange={({ detail }) => updatePerson(idx, 'welcome_room', detail.selectedOption.value)}
                      options={deviceOpts}
                      placeholder="Sélectionner un appareil"
                      filteringType="auto"
                    />
                  </FormField>
                  <FormField label="Notifications">
                    <Select selectedOption={pick(notifOptions, person.notifications)} onChange={({ detail }) => updatePerson(idx, 'notifications', detail.selectedOption.value)} options={notifOptions} />
                  </FormField>
                </ColumnLayout>
              </SpaceBetween>
            ) : (
              <Box variant="small" color="text-body-secondary">
                {person.device ? person.device + ' · ' : ''}{pick(langOptions, person.language)?.label || person.language} · {pick(styleOptions, person.welcome_style)?.label || person.welcome_style} · {person.welcome_room || '(par défaut)'} · {pick(notifOptions, person.notifications)?.label || person.notifications}
              </Box>
            )}
          </Container>
        );
      })}
      <Button onClick={addPerson} iconName="add-plus">Ajouter une personne</Button>

      <Container header={<Header variant="h3">Seuils de détection</Header>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={4}>
            <FormField label="Vérification (sec)" description="Intervalle entre chaque scan réseau">
              <Input type="number" value={String(settings.poll_seconds || 30)} onChange={({ detail }) => updateSetting('poll_seconds', detail.value)} />
            </FormField>
            <FormField label="Absence jour (min)" description="Délai avant de marquer comme parti en journée">
              <Input type="number" value={String(settings.day_away_minutes || 15)} onChange={({ detail }) => updateSetting('day_away_minutes', detail.value)} />
            </FormField>
            <FormField label="Absence nuit (min)" description="Délai la nuit (les téléphones déconnectent le WiFi)">
              <Input type="number" value={String(settings.night_away_minutes || 60)} onChange={({ detail }) => updateSetting('night_away_minutes', detail.value)} />
            </FormField>
            <FormField label="Scans manqués" description="Nombre de scans ratés avant de confirmer le départ">
              <Input type="number" value={String(settings.consecutive_misses || 2)} onChange={({ detail }) => updateSetting('consecutive_misses', detail.value)} />
            </FormField>
          </ColumnLayout>
          <ColumnLayout columns={4}>
            <FormField label="Voyage (heures)" description="Demander si en voyage après cette durée d'absence">
              <Input type="number" value={String(settings.travel_ask_hours || 6)} onChange={({ detail }) => updateSetting('travel_ask_hours', detail.value)} />
            </FormField>
            <FormField label="Vacances (heures)" description="Mode vacances auto quand tous absents depuis">
              <Input type="number" value={String(settings.vacation_hours || 24)} onChange={({ detail }) => updateSetting('vacation_hours', detail.value)} />
            </FormField>
            <FormField label="Début nuit (heure)" description="Heure de début du mode nuit (0-23)">
              <Input type="number" value={String(settings.night_start != null ? settings.night_start : 23)} onChange={({ detail }) => updateSetting('night_start', detail.value)} />
            </FormField>
            <FormField label="Fin nuit (heure)" description="Heure de fin du mode nuit (0-23)">
              <Input type="number" value={String(settings.night_end != null ? settings.night_end : 7)} onChange={({ detail }) => updateSetting('night_end', detail.value)} />
            </FormField>
          </ColumnLayout>
        </SpaceBetween>
      </Container>

      {hasDirty && (
        <Box float="right">
          <Button variant="primary" onClick={savePerson}>Sauvegarder les changements</Button>
        </Box>
      )}
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

// --- Family YAML helpers ---
function parseFamilyYaml(text) {
  const members = [];
  const blocks = text.split(/^\s+-\s+name:/m);
  for (let i = 1; i < blocks.length; i++) {
    const block = '  - name:' + blocks[i];
    const name = (block.match(/name:\s*(.+)/) || [])[1]?.trim() || '';
    const identityId = (block.match(/identity_id:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '';
    const presenceName = (block.match(/presence_name:\s*(.+)/) || [])[1]?.trim() || name;
    const telegram = (block.match(/telegram:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '';
    const hasWeb = /web:\s*true/i.test(block);
    const hasVoice = /voice:\s*true/i.test(block);
    const tone = (block.match(/tone:\s*(\S+)/) || [])[1] || 'concise';
    const briefing = (block.match(/briefing:\s*(\S+)/) || [])[1] || 'summary';
    const proactiveLevel = (block.match(/proactive_level:\s*(\S+)/) || [])[1] || 'medium';
    const humor = (block.match(/humor:\s*(\S+)/) || [])[1] || 'never';
    const morning = (block.match(/morning:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '07:00';
    const workStart = (block.match(/work_start:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '09:00';
    const workEnd = (block.match(/work_end:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '17:00';
    const evening = (block.match(/evening:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '19:00';
    const sleep = (block.match(/sleep:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '23:00';
    const interests = (block.match(/interests:\s*\n((?:\s+-\s+\S+\n)*)/)?.[1] || '').match(/-\s+(\S+)/g)?.map(m => m.slice(2)) || [];
    const notifRules = {};
    const notifMatch = block.match(/notification_rules:\s*\n((?:\s+\w+:.*\n)*)/);
    if (notifMatch) {
      for (const line of notifMatch[1].split('\n')) {
        const kv = line.match(/(\w+):\s*(\S+)/);
        if (kv) notifRules[kv[1]] = kv[2];
      }
    }
    members.push({
      name, identityId, presenceName,
      channels: { telegram, web: hasWeb, voice: hasVoice },
      style: { tone, briefing, proactiveLevel, humor },
      schedule: { morning, workStart, workEnd, evening, sleep },
      interests, notificationRules: notifRules,
    });
  }
  return members;
}

function buildFamilyYaml(members) {
  let yaml = '# Vertex Nova — Family Identity Configuration\n\nfamily:\n';
  for (const m of members) {
    yaml += `  - name: ${m.name}\n`;
    yaml += `    identity_id: "${m.identityId}"\n`;
    yaml += `    presence_name: ${m.presenceName || m.name}\n`;
    yaml += `    channels:\n`;
    if (m.channels?.telegram) yaml += `      telegram: "${m.channels.telegram}"\n`;
    if (m.channels?.web) yaml += `      web: true\n`;
    if (m.channels?.voice) yaml += `      voice: true\n`;
    yaml += `    style:\n`;
    yaml += `      tone: ${m.style?.tone || 'concise'}\n`;
    yaml += `      briefing: ${m.style?.briefing || 'summary'}\n`;
    yaml += `      proactive_level: ${m.style?.proactiveLevel || 'medium'}\n`;
    yaml += `      humor: ${m.style?.humor || 'never'}\n`;
    yaml += `    schedule:\n`;
    yaml += `      morning: "${m.schedule?.morning || '07:00'}"\n`;
    yaml += `      work_start: "${m.schedule?.workStart || '09:00'}"\n`;
    yaml += `      work_end: "${m.schedule?.workEnd || '17:00'}"\n`;
    yaml += `      evening: "${m.schedule?.evening || '19:00'}"\n`;
    yaml += `      sleep: "${m.schedule?.sleep || '23:00'}"\n`;
    if (m.interests?.length > 0) {
      yaml += `    interests:\n`;
      for (const interest of m.interests) yaml += `      - ${interest}\n`;
    }
    if (m.notificationRules && Object.keys(m.notificationRules).length > 0) {
      yaml += `    notification_rules:\n`;
      for (const [key, val] of Object.entries(m.notificationRules)) {
        yaml += `      ${key}: ${val}\n`;
      }
    }
    yaml += '\n';
  }
  return yaml;
}

// Alexa cookie editor — paste both cookies then save with one button
function AlexaCookieEditor({ api, configured, onSaved }) {
  const [ubid, setUbid] = useState('');
  const [atMain, setAtMain] = useState('');
  const [alert, setAlert] = useState(null);
  const [saving, setSaving] = useState(false);

  const canSave = ubid.length > 5 || atMain.length > 5;

  const save = async () => {
    setSaving(true);
    try {
      const body = {};
      if (ubid.trim()) body.ALEXA_UBID_MAIN = ubid.trim();
      if (atMain.trim()) body.ALEXA_AT_MAIN = atMain.trim();
      await fetch(api + '/api/models', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setAlert({ type: 'success', text: 'Cookies Alexa mis à jour. Redémarrage nécessaire pour prendre effet.' });
      setUbid(''); setAtMain('');
      if (onSaved) onSaved();
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
    setSaving(false);
  };

  return (
    <SpaceBetween size="m">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}
      <Alert type="info">
        Cookies extraits de alexa.amazon.com (DevTools → Application → Cookies). Collez les deux valeurs puis cliquez Sauvegarder.
      </Alert>
      <ColumnLayout columns={2}>
        <FormField label="UBID Main" description={configured ? '✅ Configuré' : 'Non configuré'}>
          <Input value={ubid} placeholder="Coller ubid-main ici" onChange={({ detail }) => setUbid(detail.value)} />
        </FormField>
        <FormField label="AT Main" description={configured ? '✅ Configuré' : 'Non configuré'}>
          <Input value={atMain} placeholder="Coller at-main ici" onChange={({ detail }) => setAtMain(detail.value)} />
        </FormField>
      </ColumnLayout>
      {canSave && (
        <Box float="right">
          <Button variant="primary" onClick={save} loading={saving}>Sauvegarder les cookies</Button>
        </Box>
      )}
    </SpaceBetween>
  );
}

// ============================================================
// Sub-panels
// ============================================================

function ModelsPanel({ api }) {
  const [models, setModels] = useState(null);
  const [ollamaModels, setOllamaModels] = useState([]);
  const [usedModels, setUsedModels] = useState([]);
  const [echoDevices, setEchoDevices] = useState([]);
  const [alert, setAlert] = useState(null);
  const [pullModel, setPullModel] = useState('');
  const [pulling, setPulling] = useState(false);

  const load = useCallback(() => {
    fetch(api + '/api/models').then(r => r.json()).then(setModels).catch(() => {});
    fetch(api + '/api/ollama-models').then(r => r.json()).then(d => { setOllamaModels(d.models || []); setUsedModels(d.usedModels || []); }).catch(() => {});
    fetch(api + '/api/alexa/echo-devices').then(r => r.json()).then(d => setEchoDevices(d.devices || [])).catch(() => {});
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const pullNewModel = async () => {
    if (!pullModel.trim()) return;
    setPulling(true);
    try {
      await fetch(api + '/api/ollama-models/pull', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: pullModel.trim() }),
      });
      setAlert({ type: 'success', text: 'Téléchargement de ' + pullModel + ' lancé en arrière-plan...' });
      setPullModel('');
      // Reload after a delay to show the new model
      setTimeout(load, 5000);
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
    setPulling(false);
  };

  const deleteModel = async (name) => {
    try {
      const res = await fetch(api + '/api/ollama-models/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name }),
      });
      const data = await res.json();
      if (data.deleted) { setAlert({ type: 'success', text: name + ' supprimé' }); load(); }
      else setAlert({ type: 'error', text: data.error || 'Erreur' });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const hotSwap = async (name) => {
    try {
      const res = await fetch(api + '/api/ollama-models/swap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name }),
      });
      const data = await res.json();
      if (data.swapped) { setAlert({ type: 'success', text: 'Modèle principal changé à ' + name + ' (sans redémarrage)' }); load(); }
      else setAlert({ type: 'error', text: data.error || 'Erreur' });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

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
    { value: 'qwen3:8b', label: 'Qwen3 8B — principal, outils, français' },
    { value: 'phi4-mini', label: 'Phi-4 Mini — proactif, SKIP logic' },
    { value: 'nemotron-mini', label: 'Nemotron Mini — résumés rapides' },
    { value: 'qwen2.5vl:7b', label: 'Qwen2.5-VL 7B — vision, multimodal' },
    { value: 'gemma4:e2b', label: 'Gemma 4 E2B — vision' },
    { value: 'qwen3', label: 'Qwen3 (sans tag) — dream engine' },
    { value: 'nomic-embed-text', label: 'Nomic Embed Text — embeddings RAG' },
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

      <Container header={<Header variant="h3">Gestionnaire de modèles</Header>}>
        <SpaceBetween size="m">
          <Box variant="small" color="text-body-secondary">
            Modèles installés localement via Ollama. Les modèles marqués "En usage" sont référencés dans la configuration.
          </Box>
          {ollamaModels.length > 0 && (
            <SpaceBetween size="xs">
              {ollamaModels.map((m, i) => (
                <Container key={i} variant="stacked">
                  <SpaceBetween direction="horizontal" size="m" alignItems="center">
                    <Box variant="strong">{m.name}</Box>
                    <Box variant="small" color="text-body-secondary">{Math.round((m.size || 0) / 1e9 * 10) / 10} GB</Box>
                    {m.inUse ? (
                      <StatusIndicator type="success">En usage</StatusIndicator>
                    ) : (
                      <StatusIndicator type="stopped">Inutilisé</StatusIndicator>
                    )}
                    <Button variant="link" onClick={() => hotSwap(m.name)}>Activer</Button>
                    {!m.inUse && <Button variant="link" onClick={() => deleteModel(m.name)}>Supprimer</Button>}
                  </SpaceBetween>
                </Container>
              ))}
            </SpaceBetween>
          )}
          <ColumnLayout columns={2}>
            <FormField label="Télécharger un nouveau modèle" description="Nom Ollama (ex: deepseek-r1:8b, llama3.1:8b, mistral-nemo)">
              <Input value={pullModel} onChange={({ detail }) => setPullModel(detail.value)} placeholder="nom-du-modele"
                onKeyDown={({ detail }) => { if (detail.key === 'Enter') pullNewModel(); }} />
            </FormField>
            <FormField label=" ">
              <Button onClick={pullNewModel} loading={pulling} iconName="download">Télécharger</Button>
            </FormField>
          </ColumnLayout>
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
        <AlexaCookieEditor api={api} configured={models.alexa_configured} onSaved={load} />
      </Container>

      <Container header={<Header variant="h3">Détection de présence (WiFi)</Header>}>
        <SpaceBetween size="m">
          <Alert type="info">
            Détecte qui est à la maison via l'adresse MAC du téléphone sur le réseau WiFi. Chaque personne a ses propres préférences de bienvenue, langue et notifications. Trouvez les MAC avec: arp -a
          </Alert>
          <PresencePersonEditor api={api} />
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

function RoutingPanel({ api, configFile }) {
  const [yaml, setYaml] = useState('');
  const [parsed, setParsed] = useState({ routes: [], defaultModel: 'qwen3:8b' });
  const [alert, setAlert] = useState(null);

  const modelOptions = [
    { value: 'qwen3:8b', label: 'Qwen3 8B (principal, outils, français)' },
    { value: 'phi4-mini', label: 'Phi-4 Mini (proactif, SKIP logic)' },
    { value: 'nemotron-mini', label: 'Nemotron Mini (résumés rapides)' },
    { value: 'qwen2.5vl:7b', label: 'Qwen2.5-VL 7B (vision)' },
    { value: 'gemma4:e2b', label: 'Gemma 4 E2B (vision)' },
    { value: 'claude', label: 'Claude (escalation API)' },
  ];
  const findModel = (val) => modelOptions.find(o => o.value === val) || { value: val, label: val };

  const file = configFile || 'config/routing.yaml';

  const load = useCallback(async () => {
    try {
      const res = await fetch(api + '/api/config?file=' + file);
      const data = await res.json();
      setYaml(data.content || '');
      setParsed(parseRoutingYaml(data.content || ''));
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  }, [api, file]);

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
        body: JSON.stringify({ file: file, content: yaml }),
      });
      const data = await res.json();
      if (data.saved) {
        await fetch(api + '/api/reload', { method: 'POST' });
        setAlert({ type: 'success', text: 'Routage sauvegardé et rechargé (' + file.split('/').pop() + ')' });
      } else {
        setAlert({ type: 'error', text: data.error || 'Erreur' });
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

function ProactivePanel({ api, configFile }) {
  const [yaml, setYaml] = useState('');
  const [parsed, setParsed] = useState({ routing: {}, actions: [], behavior: { max_notifications_per_hour: 4, min_interval_minutes: 10 } });
  const [alert, setAlert] = useState(null);

  const file = configFile || 'config/proactive.yaml';

  const load = useCallback(async () => {
    try {
      const res = await fetch(api + '/api/config?file=' + file);
      const data = await res.json();
      setYaml(data.content || '');
      setParsed(parseProactiveYaml(data.content || ''));
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  }, [api, file]);

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
        body: JSON.stringify({ file: file, content: yaml }),
      });
      const data = await res.json();
      setAlert({ type: data.saved ? 'success' : 'error', text: data.saved ? 'Actions proactives sauvegardées (' + file.split('/').pop() + ')' : data.error });
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

  const addAction = () => {
    const newAction = {
      name: 'new-action-' + (parsed.actions.length + 1),
      description: '',
      interval_minutes: 60,
      model: 'qwen3:8b',
      priority: 'medium',
      day_of_week: '',
      active_hours: [],
      notify_condition: 'not_skip',
      prompt: '',
      enabled: true,
    };
    updateFromForm({ ...parsed, actions: [...parsed.actions, newAction] });
  };

  const ICONS = { 'breaking-news': '🌍', 'weather-alert': '🌪️', 'home-maintenance-check': '🔧', 'email-digest': '📬', 'friday-movies': '🎬', 'weekend-activities': '🎯' };
  const proactiveModelOptions = [
    { value: 'qwen3:8b', label: 'Qwen3 8B (principal)' },
    { value: 'phi4-mini', label: 'Phi-4 Mini (SKIP logic)' },
    { value: 'nemotron-mini', label: 'Nemotron Mini (résumés)' },
    { value: 'claude', label: 'Claude (escalation)' },
  ];
  const findPModel = (val) => proactiveModelOptions.find(o => o.value === val) || { value: val, label: val };

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}
      <ColumnLayout columns={2}>
        <SpaceBetween size="m">
          <Container header={<Header variant="h3" actions={
            <Button iconName="add-plus" onClick={addAction}>Ajouter une action</Button>
          }>Actions proactives</Header>}>
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

// --- Hotel Rooms CRUD Panel ---
function HotelRoomsPanel({ api, onAlert }) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigningRoom, setAssigningRoom] = useState(null);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formLang, setFormLang] = useState('auto');
  const [formCheckIn, setFormCheckIn] = useState('');
  const [formCheckOut, setFormCheckOut] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [showEnrollForm, setShowEnrollForm] = useState(false);
  const [enrollRoom, setEnrollRoom] = useState('');
  const [wifiName, setWifiName] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [hotelRules, setHotelRules] = useState('');
  const [hotelEmergency, setHotelEmergency] = useState('');
  const [hotelPropertyDesc, setHotelPropertyDesc] = useState('');
  const [hotelCheckoutTime, setHotelCheckoutTime] = useState('11:00');
  const [infoDirty, setInfoDirty] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomFloor, setNewRoomFloor] = useState('upper');
  const [floors, setFloors] = useState([]);

  const loadRooms = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(api + '/api/hospitality/hotel/rooms').then(r => r.ok ? r.json() : { rooms: [] }).catch(() => ({ rooms: [] })),
      fetch(api + '/api/config?file=config/hospitality.yaml').then(r => r.ok ? r.json() : { content: '' }).catch(() => ({ content: '' })),
    ]).then(([roomData, yamlData]) => {
      setRooms(roomData.rooms || []);
      setFloors(roomData.floors || [{ id: 'ground', name: 'Rez-de-chaussée' }, { id: 'upper', name: 'Étage' }]);
      const text = yamlData.content || '';
      // Parse shared guest_info section
      const guestInfoMatch = text.match(/guest_info:\s*\n([\s\S]*?)(?=\n\S|\n*$)/);
      const infoText = guestInfoMatch ? guestInfoMatch[1] : '';
      setWifiName((infoText.match(/wifi_name:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '');
      setWifiPass((infoText.match(/wifi_password:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '');
      const rulesMatch = infoText.match(/rules:\s*\|\s*\n((?:\s+.*\n)*)/);
      setHotelRules(rulesMatch ? rulesMatch[1].replace(/^\s{4}/gm, '').trim() : '');
      const emergMatch = infoText.match(/emergency_contacts:\s*\|\s*\n((?:\s+.*\n)*)/);
      setHotelEmergency(emergMatch ? emergMatch[1].replace(/^\s{4}/gm, '').trim() : '');
      const descMatch = infoText.match(/property_description:\s*\|\s*\n((?:\s+.*\n)*)/);
      setHotelPropertyDesc(descMatch ? descMatch[1].replace(/^\s{4}/gm, '').trim() : '');
      setHotelCheckoutTime((infoText.match(/checkout_time:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '11:00');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [api]);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  const resetForm = () => {
    setFormName(''); setFormEmail(''); setFormLang('auto'); setFormCheckIn(''); setFormCheckOut('');
    setAssigningRoom(null); setShowEnrollForm(false); setEnrollRoom('');
  };

  const assignGuest = async (roomId) => {
    if (!formName.trim()) { onAlert({ type: 'error', text: 'Le nom de l\'invité est requis' }); return; }
    try {
      const res = await fetch(api + '/api/hospitality/hotel/guests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          guest: { name: formName, email: formEmail, language: formLang, checkIn: formCheckIn || new Date().toISOString().slice(0, 10), checkOut: formCheckOut },
          sendEmail: sendEmail && !!formEmail,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const emailMsg = data.emailSent ? ' — email envoyé' : '';
        onAlert({ type: 'success', text: formName + ' enregistré dans ' + (rooms.find(r => r.id === roomId)?.name || roomId) + emailMsg });
        resetForm();
        loadRooms();
      } else {
        onAlert({ type: 'error', text: data.error || 'Erreur' });
      }
    } catch (err) { onAlert({ type: 'error', text: err.message }); }
  };

  const checkoutGuest = async (roomId, guestName) => {
    try {
      const res = await fetch(api + '/api/hospitality/hotel/guests/' + roomId, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        onAlert({ type: 'success', text: guestName + ' — checkout complété' });
        loadRooms();
      } else {
        onAlert({ type: 'error', text: data.error || 'Erreur' });
      }
    } catch (err) { onAlert({ type: 'error', text: err.message }); }
  };

  const saveHotelInfo = async () => {
    try {
      const res = await fetch(api + '/api/hospitality/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wifiName, wifiPass, rules: hotelRules, emergency: hotelEmergency, propertyDescription: hotelPropertyDesc, checkoutTime: hotelCheckoutTime }),
      });
      const data = await res.json();
      if (data.saved) { onAlert({ type: 'success', text: 'Infos sauvegardées' }); setInfoDirty(false); }
      else onAlert({ type: 'error', text: data.error || 'Erreur' });
    } catch (err) { onAlert({ type: 'error', text: err.message }); }
  };

  const addRoom = async () => {
    if (!newRoomName.trim()) return;
    try {
      const res = await fetch(api + '/api/hospitality/hotel/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoomName, floor: newRoomFloor }),
      });
      if (!res.ok) { onAlert({ type: 'error', text: 'Erreur serveur (' + res.status + '). Redémarrez l\'agent pour activer les nouvelles routes.' }); return; }
      const data = await res.json();
      if (data.success) {
        onAlert({ type: 'success', text: 'Chambre ajoutée: ' + data.name + ' (ID: ' + data.id + ')' });
        setNewRoomName('');
        loadRooms();
      } else {
        onAlert({ type: 'error', text: data.error || 'Erreur' });
      }
    } catch (err) { onAlert({ type: 'error', text: 'Erreur: ' + err.message + '. Redémarrez l\'agent si le problème persiste.' }); }
  };

  const removeRoom = async (roomId) => {
    try {
      const res = await fetch(api + '/api/hospitality/hotel/rooms/' + roomId, { method: 'DELETE' });
      if (!res.ok) { onAlert({ type: 'error', text: 'Erreur serveur (' + res.status + ')' }); return; }
      const data = await res.json();
      if (data.success) {
        onAlert({ type: 'success', text: 'Chambre supprimée' });
        loadRooms();
      } else {
        onAlert({ type: 'error', text: data.error || 'Erreur' });
      }
    } catch (err) { onAlert({ type: 'error', text: err.message }); }
  };

  const langOptions = [
    { value: 'auto', label: 'Auto-détection' }, { value: 'fr', label: 'Français' },
    { value: 'en', label: 'English' }, { value: 'es', label: 'Español' },
    { value: 'de', label: 'Deutsch' }, { value: 'ja', label: '日本語' },
    { value: 'zh', label: '中文' }, { value: 'pt', label: 'Português' }, { value: 'ar', label: 'العربية' },
  ];

  if (loading) return <Spinner size="large" />;

  const occupied = rooms.filter(r => r.guest).length;
  const vacantRooms = rooms.filter(r => !r.guest);

  const nightsLeft = (checkOut) => {
    if (!checkOut) return null;
    const diff = Math.ceil((new Date(checkOut) - new Date()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
  };

  const enrollmentForm = (targetRoomId) => (
    <Container header={<Header variant="h4"><Icon name="user-profile" /> Enregistrer un invité</Header>}>
      <SpaceBetween size="s">
        {!targetRoomId && (
          <FormField label="Chambre" description="Sélectionnez la chambre à attribuer">
            <Select
              selectedOption={vacantRooms.find(r => r.id === enrollRoom) ? { value: enrollRoom, label: rooms.find(r => r.id === enrollRoom)?.name } : null}
              onChange={({ detail }) => setEnrollRoom(detail.selectedOption.value)}
              options={vacantRooms.map(r => ({ value: r.id, label: r.name + ' (' + r.floor + ')' }))}
              placeholder="Choisir une chambre disponible"
            />
          </FormField>
        )}
        <ColumnLayout columns={2}>
          <FormField label="Nom complet" description="L'invité utilisera ce nom pour se connecter au portail">
            <Input value={formName} onChange={({ detail }) => setFormName(detail.value)} placeholder="Marie Dupont" />
          </FormField>
          <FormField label="Email" description="Pour envoyer les infos d'accès automatiquement">
            <Input value={formEmail} onChange={({ detail }) => setFormEmail(detail.value)} placeholder="invité@email.com" type="email" />
          </FormField>
        </ColumnLayout>
        <ColumnLayout columns={3}>
          <FormField label="Langue">
            <Select selectedOption={langOptions.find(o => o.value === formLang)} onChange={({ detail }) => setFormLang(detail.selectedOption.value)} options={langOptions} />
          </FormField>
          <FormField label="Arrivée">
            <Input type="date" value={formCheckIn} onChange={({ detail }) => setFormCheckIn(detail.value)} />
          </FormField>
          <FormField label="Départ">
            <Input type="date" value={formCheckOut} onChange={({ detail }) => setFormCheckOut(detail.value)} />
          </FormField>
        </ColumnLayout>
        <Toggle checked={sendEmail} onChange={({ detail }) => setSendEmail(detail.checked)}>
          Envoyer un email de bienvenue (portail, WiFi, infos chambre)
        </Toggle>
        <Alert type="info">
          L'invité pourra se connecter au portail (port 3082) avec son <strong>nom</strong> et le <strong>nom de la chambre</strong>. L'email contiendra toutes les infos nécessaires.
        </Alert>
        <SpaceBetween direction="horizontal" size="xs">
          <Button variant="primary" onClick={() => assignGuest(targetRoomId || enrollRoom)} iconName="check"
            disabled={!formName.trim() || (!targetRoomId && !enrollRoom)}>
            Confirmer le check-in
          </Button>
          <Button variant="link" onClick={resetForm}>Annuler</Button>
        </SpaceBetween>
      </SpaceBetween>
    </Container>
  );

  return (
    <SpaceBetween size="m">
      {/* Occupancy + enroll */}
      <Container header={
        <Header variant="h3" counter={'(' + occupied + '/' + rooms.length + ')'} actions={
          !showEnrollForm ? (
            <Button variant="primary" iconName="add-plus" disabled={vacantRooms.length === 0} onClick={() => { setShowEnrollForm(true); setFormCheckIn(new Date().toISOString().slice(0, 10)); }}>
              Enregistrer un invité
            </Button>
          ) : null
        }>
          Chambres
        </Header>
      }>
        <SpaceBetween size="m">
          <div style={{ display: 'flex', gap: '4px', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
            {rooms.map(room => (
              <div key={room.id} style={{ flex: 1, background: room.guest ? '#0972d3' : '#e9ebed', borderRadius: '2px' }} title={room.name + (room.guest ? ' — ' + room.guest.name : ' — vacante')} />
            ))}
          </div>
          {showEnrollForm && enrollmentForm(null)}
        </SpaceBetween>
      </Container>

      {/* Room cards */}
      <ColumnLayout columns={rooms.length > 2 ? 3 : rooms.length}>
        {rooms.map(room => {
          const nights = room.guest ? nightsLeft(room.guest.checkOut) : null;
          return (
            <Container key={room.id} header={
              <Header variant="h4" actions={
                room.guest ? (
                  <Button onClick={() => checkoutGuest(room.id, room.guest.name)} variant="normal" iconName="remove">Checkout</Button>
                ) : (
                  <Button onClick={() => { setAssigningRoom(assigningRoom === room.id ? null : room.id); setShowEnrollForm(false); setFormCheckIn(new Date().toISOString().slice(0, 10)); }} iconName="add-plus" variant="primary">Check-in</Button>
                )
              }>
                <StatusIndicator type={room.guest ? 'success' : 'stopped'}>{room.name}</StatusIndicator>
              </Header>
            }>
              <SpaceBetween size="xs">
                <SpaceBetween direction="horizontal" size="xs">
                  <Box variant="small" color="text-body-secondary"><Icon name="status-info" /> {floors.find(f => f.id === room.floor)?.name || room.floor}</Box>
                  {room.devices.length > 0 && <Box variant="small" color="text-body-secondary"><Icon name="audio-full" /> {room.devices.join(', ')}</Box>}
                </SpaceBetween>
                {room.amenities.length > 0 && (
                  <Box variant="small" color="text-body-secondary">{room.amenities.join(' · ')}</Box>
                )}
                {room.guest ? (
                  <Container>
                    <SpaceBetween size="xxs">
                      <SpaceBetween direction="horizontal" size="xs">
                        <Icon name="user-profile" />
                        <Box fontWeight="bold">{room.guest.name}</Box>
                        {nights !== null && (
                          <StatusIndicator type={nights <= 1 ? 'warning' : 'info'}>
                            {nights === 0 ? 'Checkout aujourd\'hui' : nights + ' nuit' + (nights > 1 ? 's' : '')}
                          </StatusIndicator>
                        )}
                      </SpaceBetween>
                      <Box variant="small" color="text-body-secondary">
                        {langOptions.find(o => o.value === room.guest.language)?.label || room.guest.language} · {room.guest.checkIn} → {room.guest.checkOut || '—'}
                      </Box>
                    </SpaceBetween>
                  </Container>
                ) : (
                  <Box textAlign="center" padding="m">
                    <StatusIndicator type="stopped">Libre</StatusIndicator>
                  </Box>
                )}
                {assigningRoom === room.id && enrollmentForm(room.id)}
              </SpaceBetween>
            </Container>
          );
        })}
      </ColumnLayout>

      {/* Add/remove rooms */}
      <Container header={<Header variant="h3">Gérer les chambres</Header>}>
        <SpaceBetween size="m">
          <Alert type="info">
            Ajoutez ou supprimez des chambres. Un identifiant unique est généré automatiquement à partir du nom.
          </Alert>
          <ColumnLayout columns={3}>
            <FormField label="Nom de la chambre">
              <Input value={newRoomName} onChange={({ detail }) => setNewRoomName(detail.value)} placeholder="Chambre Rose" />
            </FormField>
            <FormField label="Étage">
              <Select selectedOption={floors.find(f => f.id === newRoomFloor) ? { value: newRoomFloor, label: floors.find(f => f.id === newRoomFloor)?.name } : { value: newRoomFloor, label: newRoomFloor }}
                onChange={({ detail }) => setNewRoomFloor(detail.selectedOption.value)}
                options={floors.map(f => ({ value: f.id, label: f.name }))} />
            </FormField>
            <FormField label="Action">
              <Button variant="primary" iconName="add-plus" onClick={addRoom} disabled={!newRoomName.trim()}>
                Ajouter
              </Button>
            </FormField>
          </ColumnLayout>
          {rooms.length > 0 && (
            <SpaceBetween size="xs">
              <Box variant="awsui-key-label">Chambres existantes (cliquez pour supprimer)</Box>
              {rooms.map(r => (
                <SpaceBetween key={r.id} direction="horizontal" size="xs">
                  <Box variant="small"><strong>{r.name}</strong> (ID: {r.id}) — {r.floor}</Box>
                  {!r.guest && <Button variant="icon" iconName="remove" onClick={() => removeRoom(r.id)} />}
                  {r.guest && <Box variant="small" color="text-body-secondary">occupée</Box>}
                </SpaceBetween>
              ))}
            </SpaceBetween>
          )}
        </SpaceBetween>
      </Container>

      {/* Hotel info for invités */}
      <Container header={<Header variant="h3" actions={
        infoDirty ? <Button variant="primary" onClick={saveHotelInfo} iconName="upload">Sauvegarder</Button> : null
      }>Infos pour les invités</Header>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={2}>
            <FormField label="WiFi — Réseau">
              <Input value={wifiName} onChange={({ detail }) => { setWifiName(detail.value); setInfoDirty(true); }} placeholder="MonWiFi" />
            </FormField>
            <FormField label="WiFi — Mot de passe">
              <Input value={wifiPass} onChange={({ detail }) => { setWifiPass(detail.value); setInfoDirty(true); }} placeholder="MotDePasse123" />
            </FormField>
          </ColumnLayout>
          <FormField label="Description de la propriété">
            <Textarea value={hotelPropertyDesc} onChange={({ detail }) => { setHotelPropertyDesc(detail.value); setInfoDirty(true); }} rows={3} placeholder="Bienvenue dans notre maison..." />
          </FormField>
          <FormField label="Règles de la maison">
            <Textarea value={hotelRules} onChange={({ detail }) => { setHotelRules(detail.value); setInfoDirty(true); }} rows={3} placeholder="- Silence après 22h&#10;- Petit-déjeuner 7h-9h" />
          </FormField>
          <FormField label="Contacts d'urgence">
            <Textarea value={hotelEmergency} onChange={({ detail }) => { setHotelEmergency(detail.value); setInfoDirty(true); }} rows={2} placeholder="Urgences: 911&#10;Hôte: 514-xxx-xxxx" />
          </FormField>
          <FormField label="Heure de checkout">
            <Input value={hotelCheckoutTime} onChange={({ detail }) => { setHotelCheckoutTime(detail.value); setInfoDirty(true); }} placeholder="11:00" />
          </FormField>
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}

function HospitalityPanel({ api }) {
  const [status, setStatus] = useState(null);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [yaml, setYaml] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestLang, setGuestLang] = useState('auto');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [wifiName, setWifiName] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [rules, setRules] = useState('');
  const [emergency, setEmergency] = useState('');
  const [propertyDesc, setPropertyDesc] = useState('');
  const [checkoutTime, setCheckoutTime] = useState('11:00');
  const [sendingEmail, setSendingEmail] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(api + '/api/hospitality').then(r => r.ok ? r.json() : { mode: 'residence' }).catch(() => ({ mode: 'residence' })),
      fetch(api + '/api/config?file=config/hospitality.yaml').then(r => r.ok ? r.json() : { content: '' }).catch(() => ({ content: '' })),
    ]).then(([hospData, yamlData]) => {
      setStatus(hospData);
      setYaml(yamlData.content || '');
      const text = yamlData.content || '';
      setGuestName((text.match(/guest:\s*\n\s+name:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '');
      setGuestEmail((text.match(/email:\s*"?([^"\n]*@[^"\n]*)"?/) || [])[1]?.trim() || '');
      setGuestLang((text.match(/language:\s*(\S+)/) || [])[1] || 'auto');
      setCheckIn((text.match(/check_in:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '');
      setCheckOut((text.match(/check_out:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '');
      // Parse shared guest_info section
      const guestInfoMatch = text.match(/guest_info:\s*\n([\s\S]*?)(?=\n\S|\n*$)/);
      const infoText = guestInfoMatch ? guestInfoMatch[1] : '';
      setWifiName((infoText.match(/wifi_name:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '');
      setWifiPass((infoText.match(/wifi_password:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '');
      const rulesMatch = infoText.match(/rules:\s*\|\s*\n((?:\s+.*\n)*)/);
      if (rulesMatch) setRules(rulesMatch[1].replace(/^\s{4}/gm, '').trim());
      const emergMatch = infoText.match(/emergency_contacts:\s*\|\s*\n((?:\s+.*\n)*)/);
      if (emergMatch) setEmergency(emergMatch[1].replace(/^\s{4}/gm, '').trim());
      const descMatch = infoText.match(/property_description:\s*\|\s*\n((?:\s+.*\n)*)/);
      if (descMatch) setPropertyDesc(descMatch[1].replace(/^\s{4}/gm, '').trim());
      setCheckoutTime((infoText.match(/checkout_time:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '11:00');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const setMode = async (mode) => {
    try {
      const res = await fetch(api + '/api/hospitality/mode', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (data.success) { setAlert({ type: 'success', text: 'Mode changé: ' + mode }); load(); }
      else setAlert({ type: 'error', text: 'Erreur' });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const generateCode = async () => {
    try {
      const res = await fetch(api + '/api/hospitality/guest-code', { method: 'POST' });
      const data = await res.json();
      setAlert({ type: 'success', text: 'Code: ' + data.code });
      load();
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const sendCodeEmail = async () => {
    setSendingEmail(true);
    try {
      const res = await fetch(api + '/api/hospitality/send-code-email', { method: 'POST' });
      const data = await res.json();
      if (data.sent) setAlert({ type: 'success', text: 'Email envoyé à ' + (guestEmail || 'invité') });
      else setAlert({ type: 'error', text: data.error || 'Échec de l\'envoi' });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
    setSendingEmail(false);
  };

  const revoke = async () => {
    try {
      await fetch(api + '/api/hospitality/revoke', { method: 'POST' });
      setAlert({ type: 'success', text: 'Accès invité révoqué' });
      load();
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const saveAirbnbConfig = async () => {
    try {
      const res = await fetch(api + '/api/hospitality/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestName, guestEmail, guestLang, checkIn, checkOut, wifiName, wifiPass, rules, emergency, propertyDescription: propertyDesc, checkoutTime }),
      });
      const data = await res.json();
      if (data.saved) setAlert({ type: 'success', text: 'Configuration sauvegardée' });
      else setAlert({ type: 'error', text: data.error || 'Erreur' });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  if (loading) return <Spinner size="large" />;

  const modeOptions = [
    { value: 'residence', label: 'Résidence — mode famille (défaut)' },
    { value: 'airbnb', label: 'Airbnb — location courte durée' },
    { value: 'hotel', label: 'Hôtel — chambres individuelles' },
  ];

  const stayDays = (checkIn && checkOut) ? Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24)) : null;
  const daysUntilCheckout = checkOut ? Math.ceil((new Date(checkOut) - new Date()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}

      <Container header={<Header variant="h3">Mode d'exploitation</Header>}>
        <SpaceBetween size="m">
          <Select
            selectedOption={modeOptions.find(o => o.value === (status?.mode || 'residence'))}
            onChange={({ detail }) => setMode(detail.selectedOption.value)}
            options={modeOptions}
          />
          {status?.mode !== 'residence' && (
            <Alert type="info">
              Portail invité actif — <a href={'https://' + window.location.hostname + ':' + (status?.mode === 'airbnb' ? '3081' : '3082')} target="_blank" rel="noreferrer">
                https://{window.location.hostname}:{status?.mode === 'airbnb' ? '3081' : '3082'}
              </a> — Dream Engine désactivé
            </Alert>
          )}
        </SpaceBetween>
      </Container>

      {status?.mode === 'airbnb' && (
        <SpaceBetween size="m">
          <Container header={<Header variant="h3" actions={
            <Button onClick={saveAirbnbConfig} variant="primary" iconName="upload">Sauvegarder</Button>
          }>Invité actuel</Header>}>
            <SpaceBetween size="m">
              {guestName && (
                <Container>
                  <ColumnLayout columns={3}>
                    <SpaceBetween size="xxs">
                      <Box variant="awsui-key-label">Nom</Box>
                      <Box><Icon name="user-profile" /> {guestName}</Box>
                    </SpaceBetween>
                    <SpaceBetween size="xxs">
                      <Box variant="awsui-key-label">Email</Box>
                      <Box>{guestEmail || '—'}</Box>
                    </SpaceBetween>
                    <SpaceBetween size="xxs">
                      <Box variant="awsui-key-label">Jours restants</Box>
                      <Box>{daysUntilCheckout !== null ? (
                        <StatusIndicator type={daysUntilCheckout <= 1 ? 'warning' : 'success'}>
                          {daysUntilCheckout} jour{daysUntilCheckout !== 1 ? 's' : ''}
                        </StatusIndicator>
                      ) : '—'}</Box>
                    </SpaceBetween>
                  </ColumnLayout>
                </Container>
              )}
              <ColumnLayout columns={3}>
                <FormField label="Nom de l'invité">
                  <Input value={guestName} onChange={({ detail }) => setGuestName(detail.value)} placeholder="John Smith" />
                </FormField>
                <FormField label="Email">
                  <Input value={guestEmail} onChange={({ detail }) => setGuestEmail(detail.value)} placeholder="guest@email.com" type="email" />
                </FormField>
                <FormField label="Langue">
                  <Select selectedOption={{ value: guestLang, label: guestLang }} onChange={({ detail }) => setGuestLang(detail.selectedOption.value)}
                    options={[{ value: 'auto', label: '🌐 Auto' }, { value: 'fr', label: '🇫🇷 Français' }, { value: 'en', label: '🇬🇧 English' }, { value: 'es', label: '🇪🇸 Español' }, { value: 'de', label: '🇩🇪 Deutsch' }, { value: 'ja', label: '🇯🇵 日本語' }, { value: 'zh', label: '🇨🇳 中文' }, { value: 'pt', label: '🇧🇷 Português' }, { value: 'ar', label: '🇸🇦 العربية' }]} />
                </FormField>
              </ColumnLayout>
              <ColumnLayout columns={2}>
                <FormField label="Check-in">
                  <Input type="date" value={checkIn} onChange={({ detail }) => setCheckIn(detail.value)} />
                </FormField>
                <FormField label="Check-out">
                  <Input type="date" value={checkOut} onChange={({ detail }) => setCheckOut(detail.value)} />
                </FormField>
              </ColumnLayout>
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h3">Accès au portail</Header>}>
            <SpaceBetween size="m">
              <StatusIndicator type={status.airbnb?.hasCode ? 'success' : 'warning'}>
                {status.airbnb?.hasCode ? 'Code actif — l\'invité peut se connecter' : 'Aucun code généré'}
              </StatusIndicator>
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={generateCode} iconName="key" variant={status.airbnb?.hasCode ? 'normal' : 'primary'}>{status.airbnb?.hasCode ? 'Régénérer' : 'Générer un code'}</Button>
                {status.airbnb?.hasCode && guestEmail && (
                  <Button onClick={sendCodeEmail} loading={sendingEmail} iconName="envelope">Envoyer par email</Button>
                )}
                {status.airbnb?.hasCode && <Button onClick={revoke} variant="link">Révoquer</Button>}
              </SpaceBetween>
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h3">Infos pour l'invité</Header>}>
            <SpaceBetween size="m">
              <ColumnLayout columns={2}>
                <FormField label="WiFi — Réseau">
                  <Input value={wifiName} onChange={({ detail }) => setWifiName(detail.value)} placeholder="MonWiFi" />
                </FormField>
                <FormField label="WiFi — Mot de passe">
                  <Input value={wifiPass} onChange={({ detail }) => setWifiPass(detail.value)} placeholder="MotDePasse123" />
                </FormField>
              </ColumnLayout>
              <FormField label="Description de la propriété">
                <Textarea value={propertyDesc} onChange={({ detail }) => setPropertyDesc(detail.value)} rows={3} placeholder="Bienvenue dans notre maison..." />
              </FormField>
              <FormField label="Règles de la maison">
                <Textarea value={rules} onChange={({ detail }) => setRules(detail.value)} rows={3} placeholder="- Pas de fête&#10;- Silence après 22h" />
              </FormField>
              <FormField label="Contacts d'urgence">
                <Textarea value={emergency} onChange={({ detail }) => setEmergency(detail.value)} rows={2} placeholder="Urgences: 911&#10;Hôte: 514-xxx-xxxx" />
              </FormField>
              <FormField label="Heure de checkout">
                <Input value={checkoutTime} onChange={({ detail }) => setCheckoutTime(detail.value)} placeholder="11:00" />
              </FormField>
            </SpaceBetween>
          </Container>
        </SpaceBetween>
      )}

      {status?.mode === 'hotel' && (
        <HotelRoomsPanel api={api} onAlert={setAlert} />
      )}
    </SpaceBetween>
  );
}

function FamilyPanel({ api }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [dirty, setDirty] = useState(false);
  const [availableChannels, setAvailableChannels] = useState({ telegram: false, whatsapp: false, sonos: false, echo: false });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(api + '/api/config?file=config/family.yaml').then(r => r.json()),
      fetch(api + '/api/models').then(r => r.json()).catch(() => ({})),
    ]).then(([familyData, models]) => {
      const parsed = parseFamilyYaml(familyData.content || '');
      setMembers(parsed);
      const exp = {};
      parsed.forEach((_, i) => { exp[i] = true; });
      setExpanded(exp);
      // Determine which channels are actually configured
      setAvailableChannels({
        telegram: models.telegram_enabled === true,
        whatsapp: models.whatsapp_enabled === true,
        sonos: !!models.sonos_default_room,
        echo: models.alexa_configured === true,
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const save = async (newMembers) => {
    const m = newMembers || members;
    setMembers(m);
    setDirty(false);
    try {
      const yaml = buildFamilyYaml(m);
      const res = await fetch(api + '/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'config/family.yaml', content: yaml }),
      });
      const data = await res.json();
      setAlert({ type: data.saved ? 'success' : 'error', text: data.saved ? 'Configuration famille sauvegardée' : data.error });
    } catch (err) { setAlert({ type: 'error', text: err.message }); }
  };

  const updateMember = (idx, field, value) => {
    const m = [...members];
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      m[idx] = { ...m[idx], [parent]: { ...m[idx][parent], [child]: value } };
    } else {
      m[idx] = { ...m[idx], [field]: value };
    }
    setMembers(m);
    setDirty(true);
  };

  const updateInterest = (idx, interests) => {
    const m = [...members];
    m[idx] = { ...m[idx], interests };
    setMembers(m);
    setDirty(true);
  };

  const updateNotifRule = (idx, rule, value) => {
    const m = [...members];
    m[idx] = { ...m[idx], notificationRules: { ...m[idx].notificationRules, [rule]: value } };
    setMembers(m);
    setDirty(true);
  };

  const addMember = () => {
    const m = [...members, {
      name: '', identityId: '', presenceName: '',
      channels: { telegram: '', web: false, voice: false },
      style: { tone: 'concise', briefing: 'summary', proactiveLevel: 'medium', humor: 'never' },
      schedule: { morning: '07:00', workStart: '09:00', workEnd: '17:00', evening: '19:00', sleep: '23:00' },
      interests: [],
      notificationRules: { news: 'always', weather: 'severe_only', home_maintenance: 'when_due', movies: 'friday_evening', email: 'immediate' },
    }];
    setMembers(m);
    setExpanded({ ...expanded, [m.length - 1]: true });
    setDirty(true);
  };

  const removeMember = (idx) => {
    const m = members.filter((_, i) => i !== idx);
    save(m);
  };

  const toneOptions = [
    { value: 'warm_detailed', label: '🌟 Chaleureux et détaillé' },
    { value: 'concise', label: '⚡ Concis et direct' },
    { value: 'formal', label: '👔 Formel' },
  ];
  const briefingOptions = [
    { value: 'full', label: '📋 Complet — tout le contexte' },
    { value: 'summary', label: '📝 Résumé — points clés' },
    { value: 'minimal', label: '💬 Minimal — essentiel seulement' },
  ];
  const proactiveOptions = [
    { value: 'high', label: '🔔 Élevé — toutes les notifications' },
    { value: 'medium', label: '🔕 Moyen — importantes seulement' },
    { value: 'low', label: '🔇 Bas — urgences seulement' },
  ];
  const humorOptions = [
    { value: 'never', label: 'Jamais' },
    { value: 'occasional', label: 'Occasionnel' },
    { value: 'frequent', label: 'Fréquent' },
  ];
  const notifOptions = [
    { value: 'always', label: 'Toujours' },
    { value: 'important_only', label: 'Importantes seulement' },
    { value: 'severe_only', label: 'Sévères seulement' },
    { value: 'when_due', label: 'Quand dû' },
    { value: 'friday_evening', label: 'Vendredi soir' },
    { value: 'immediate', label: 'Immédiat' },
    { value: 'digest', label: 'Digest' },
    { value: 'never', label: 'Jamais' },
  ];

  const pick = (options, value) => options.find(o => o.value === value) || (value ? { value, label: value } : null);

  if (loading) return <Spinner size="large" />;

  return (
    <SpaceBetween size="l">
      {alert && <Alert type={alert.type} dismissible onDismiss={() => setAlert(null)}>{alert.text}</Alert>}
      <Alert type="info">
        L'agent adapte son comportement (ton, notifications, recommandations) selon la personne à qui il parle.
        Modifiez les préférences de chaque membre de la famille ici.
      </Alert>

      {members.map((member, idx) => (
        <Container key={idx} header={
          <Header variant="h3" actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="icon" iconName={expanded[idx] ? 'angle-up' : 'angle-down'} onClick={() => setExpanded({ ...expanded, [idx]: !expanded[idx] })} />
              <Button variant="icon" iconName="close" onClick={() => removeMember(idx)} />
            </SpaceBetween>
          }>
            {member.name || '(nouveau membre)'}
          </Header>
        }>
          {expanded[idx] && (
            <SpaceBetween size="m">
              {/* Identity */}
              <Container header={<Header variant="h4">Identité</Header>}>
                <ColumnLayout columns={3}>
                  <FormField label="Nom">
                    <Input value={member.name} onChange={({ detail }) => updateMember(idx, 'name', detail.value)} placeholder="Serge" />
                  </FormField>
                  <FormField label="ID identité" description="Telegram ID ou nom interne">
                    <Input value={member.identityId} onChange={({ detail }) => updateMember(idx, 'identityId', detail.value)} placeholder="787677377" />
                  </FormField>
                  <FormField label="Nom présence" description="Doit correspondre à presence.yaml">
                    <Input value={member.presenceName} onChange={({ detail }) => updateMember(idx, 'presenceName', detail.value)} placeholder="Serge" />
                  </FormField>
                </ColumnLayout>
              </Container>

              {/* Channels */}
              {/* Channels — only show configured ones */}
              <Container header={<Header variant="h4">Canaux</Header>}>
                <ColumnLayout columns={3}>
                  {availableChannels.telegram && (
                    <FormField label="Telegram ID">
                      <Input value={member.channels?.telegram || ''} onChange={({ detail }) => updateMember(idx, 'channels.telegram', detail.value)} placeholder="123456789" />
                    </FormField>
                  )}
                  <FormField label="Web dashboard">
                    <Toggle checked={!!member.channels?.web} onChange={({ detail }) => updateMember(idx, 'channels.web', detail.checked)}>
                      {member.channels?.web ? 'Activé' : 'Désactivé'}
                    </Toggle>
                  </FormField>
                  {(availableChannels.sonos || availableChannels.echo) && (
                    <FormField label="Voix (Sonos/Echo)">
                      <Toggle checked={!!member.channels?.voice} onChange={({ detail }) => updateMember(idx, 'channels.voice', detail.checked)}>
                        {member.channels?.voice ? 'Activé' : 'Désactivé'}
                      </Toggle>
                    </FormField>
                  )}
                </ColumnLayout>
              </Container>

              {/* Style */}
              <Container header={<Header variant="h4">Style de communication</Header>}>
                <ColumnLayout columns={2}>
                  <FormField label="Ton">
                    <Select selectedOption={pick(toneOptions, member.style?.tone)} onChange={({ detail }) => updateMember(idx, 'style.tone', detail.selectedOption.value)} options={toneOptions} />
                  </FormField>
                  <FormField label="Profondeur des briefings">
                    <Select selectedOption={pick(briefingOptions, member.style?.briefing)} onChange={({ detail }) => updateMember(idx, 'style.briefing', detail.selectedOption.value)} options={briefingOptions} />
                  </FormField>
                  <FormField label="Niveau proactif">
                    <Select selectedOption={pick(proactiveOptions, member.style?.proactiveLevel)} onChange={({ detail }) => updateMember(idx, 'style.proactiveLevel', detail.selectedOption.value)} options={proactiveOptions} />
                  </FormField>
                  <FormField label="Humour">
                    <Select selectedOption={pick(humorOptions, member.style?.humor)} onChange={({ detail }) => updateMember(idx, 'style.humor', detail.selectedOption.value)} options={humorOptions} />
                  </FormField>
                </ColumnLayout>
              </Container>

              {/* Schedule */}
              <Container header={<Header variant="h4">Horaires</Header>}>
                <ColumnLayout columns={5}>
                  <FormField label="Matin">
                    <Input value={member.schedule?.morning || ''} onChange={({ detail }) => updateMember(idx, 'schedule.morning', detail.value)} placeholder="07:00" />
                  </FormField>
                  <FormField label="Début travail">
                    <Input value={member.schedule?.workStart || ''} onChange={({ detail }) => updateMember(idx, 'schedule.workStart', detail.value)} placeholder="09:00" />
                  </FormField>
                  <FormField label="Fin travail">
                    <Input value={member.schedule?.workEnd || ''} onChange={({ detail }) => updateMember(idx, 'schedule.workEnd', detail.value)} placeholder="17:00" />
                  </FormField>
                  <FormField label="Soirée">
                    <Input value={member.schedule?.evening || ''} onChange={({ detail }) => updateMember(idx, 'schedule.evening', detail.value)} placeholder="19:00" />
                  </FormField>
                  <FormField label="Coucher">
                    <Input value={member.schedule?.sleep || ''} onChange={({ detail }) => updateMember(idx, 'schedule.sleep', detail.value)} placeholder="23:00" />
                  </FormField>
                </ColumnLayout>
              </Container>

              {/* Interests */}
              <Container header={<Header variant="h4">Intérêts</Header>}>
                <TagListEditor
                  items={member.interests || []}
                  onChange={(items) => updateInterest(idx, items)}
                  placeholder="technologie, films, cameroun..."
                />
              </Container>

              {/* Notification rules */}
              <Container header={<Header variant="h4">Règles de notification</Header>}>
                <ColumnLayout columns={3}>
                  {[
                    { key: 'news', label: 'Actualités' },
                    { key: 'weather', label: 'Météo' },
                    { key: 'home_maintenance', label: 'Entretien maison' },
                    { key: 'movies', label: 'Films' },
                    { key: 'email', label: 'Emails' },
                  ].map(({ key, label }) => (
                    <FormField key={key} label={label}>
                      <Select
                        selectedOption={pick(notifOptions, member.notificationRules?.[key])}
                        onChange={({ detail }) => updateNotifRule(idx, key, detail.selectedOption.value)}
                        options={notifOptions}
                      />
                    </FormField>
                  ))}
                </ColumnLayout>
              </Container>
            </SpaceBetween>
          )}
        </Container>
      ))}

      <SpaceBetween direction="horizontal" size="xs">
        <Button onClick={addMember} iconName="add-plus">Ajouter un membre</Button>
        {dirty && <Button variant="primary" onClick={() => save()}>Sauvegarder les changements</Button>}
      </SpaceBetween>
    </SpaceBetween>
  );
}

// ============================================================
// Main ConfigPanel with tabs
// ============================================================

export default function ConfigPanel({ api }) {
  const [mode, setMode] = useState(null);

  useEffect(() => {
    fetch(api + '/api/hospitality').then(r => r.ok ? r.json() : { mode: 'residence' }).then(data => {
      setMode(data.mode || 'residence');
    }).catch(() => setMode('residence'));
  }, [api]);

  if (!mode) return <Spinner size="large" />;

  // Hospitality modes: different tab layout focused on guest management
  if (mode === 'airbnb' || mode === 'hotel') {
    return (
      <SpaceBetween size="s">
        <Alert type="info">
          Mode {mode === 'airbnb' ? 'Airbnb' : 'Hôtel'} actif — Dream Engine désactivé — Portail invité sur port {mode === 'airbnb' ? '3081' : '3082'}
        </Alert>
        <Tabs tabs={[
          { id: 'hospitality', label: mode === 'airbnb' ? 'Invité & Accès' : 'Chambres & Invités', content: <HospitalityPanel api={api} /> },
          { id: 'routing', label: 'Routage (hospitalité)', content: <RoutingPanel api={api} configFile="config/routing-hospitality.yaml" /> },
          { id: 'proactive', label: 'Actions (hospitalité)', content: <ProactivePanel api={api} configFile="config/proactive-hospitality.yaml" /> },
          { id: 'models', label: 'Modèles & Appareils', content: <ModelsPanel api={api} /> },
        ]} />
      </SpaceBetween>
    );
  }

  // Residence mode: full dashboard
  return (
    <Tabs tabs={[
      { id: 'models', label: 'Modèles & Appareils', content: <ModelsPanel api={api} /> },
      { id: 'family', label: 'Famille', content: <FamilyPanel api={api} /> },
      { id: 'hospitality', label: 'Hospitalité', content: <HospitalityPanel api={api} /> },
      { id: 'routing', label: 'Routage', content: <RoutingPanel api={api} configFile="config/routing.yaml" /> },
      { id: 'proactive', label: 'Actions proactives', content: <ProactivePanel api={api} configFile="config/proactive.yaml" /> },
      { id: 'prompt', label: 'Prompt agent', content: <AgentPromptPanel api={api} /> },
    ]} />
  );
}
