import { useState, useEffect, useRef } from 'react';
import AppLayout from '@cloudscape-design/components/app-layout';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Input from '@cloudscape-design/components/input';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import Spinner from '@cloudscape-design/components/spinner';
import Tabs from '@cloudscape-design/components/tabs';
import Alert from '@cloudscape-design/components/alert';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import FormField from '@cloudscape-design/components/form-field';
import Textarea from '@cloudscape-design/components/textarea';

const API = window.location.origin;

function LoginPage({ onLogin }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const mode = window.location.port === '3082' ? 'hotel' : 'airbnb';

  const submit = async () => {
    setLoading(true); setError('');
    try {
      const body = mode === 'airbnb' ? { code } : { name, room };
      const res = await fetch(API + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.valid) { localStorage.setItem('guest-auth', JSON.stringify(data)); onLogin(data); }
      else setError(mode === 'airbnb' ? 'Code invalide ou expiré' : (data.error || 'Nom ou chambre invalide'));
    } catch { setError('Erreur de connexion'); }
    setLoading(false);
  };

  return (
    <AppLayout
      content={
        <Box padding={{ top: 'xxxl' }}>
          <SpaceBetween size="l">
            <Box textAlign="center" padding={{ top: 'xxxl' }}>
              <Container header={<Header variant="h1">{mode === 'hotel' ? '🏨 Bienvenue' : '🏠 Bienvenue'}</Header>}>
                <SpaceBetween size="l">
                  <Box variant="p" color="text-body-secondary">
                    {mode === 'airbnb' ? 'Entrez votre code d\'accès pour continuer' : 'Entrez votre nom et le nom de votre chambre pour accéder au portail'}
                  </Box>
                  {mode === 'airbnb' ? (
                    <Input value={code} onChange={({ detail }) => setCode(detail.value)}
                      onKeyDown={({ detail }) => { if (detail.key === 'Enter') submit(); }}
                      placeholder="Code d'accès (ex: A1B2C3)" autoFocus />
                  ) : (
                    <SpaceBetween size="s">
                      <Input value={name} onChange={({ detail }) => setName(detail.value)} placeholder="Votre nom complet (tel qu'enregistré)" autoFocus />
                      <Input value={room} onChange={({ detail }) => setRoom(detail.value)}
                        onKeyDown={({ detail }) => { if (detail.key === 'Enter') submit(); }}
                        placeholder="Nom de la chambre (ex: Chambre Bleue)" />
                    </SpaceBetween>
                  )}
                  {error && <Alert type="error">{error}</Alert>}
                  <Button variant="primary" onClick={submit} loading={loading} fullWidth>Entrer</Button>
                </SpaceBetween>
              </Container>
            </Box>
          </SpaceBetween>
        </Box>
      }
      navigationHide
      toolsHide
    />
  );
}

function RecommendationChoice({ onGenerated }) {
  const [mode, setMode] = useState(null); // null | 'personalized' | 'loading'
  const [preferences, setPreferences] = useState('');
  const [loading, setLoading] = useState(false);

  const generateRecommendations = async (prefs) => {
    setLoading(true);
    try {
      const res = await fetch(API + '/api/guest/local-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: prefs || '' }),
      });
      const data = await res.json();
      if (data.localInfo) {
        localStorage.setItem('guest-local-info', data.localInfo);
        onGenerated(data.localInfo);
      }
    } catch (err) {
      console.error('Failed to generate recommendations:', err);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <SpaceBetween size="m" alignItems="center">
            <Spinner size="large" />
            <Box variant="p">Génération des recommandations en cours...</Box>
          </SpaceBetween>
        </Box>
      </Container>
    );
  }

  if (mode === 'personalized') {
    return (
      <Container header={<Header variant="h3">🎯 Vos préférences</Header>}>
        <SpaceBetween size="m">
          <Box variant="p" color="text-body-secondary">
            Décrivez vos intérêts pour des recommandations personnalisées (types de cuisine, activités, budget, etc.)
          </Box>
          <FormField label="Préférences">
            <Textarea
              value={preferences}
              onChange={({ detail }) => setPreferences(detail.value)}
              rows={3}
              placeholder="Ex: cuisine italienne, activités en plein air, budget modéré, famille avec enfants..."
            />
          </FormField>
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="primary" onClick={() => generateRecommendations(preferences)} disabled={!preferences.trim()}>
              Générer mes recommandations
            </Button>
            <Button variant="link" onClick={() => setMode(null)}>Retour</Button>
          </SpaceBetween>
        </SpaceBetween>
      </Container>
    );
  }

  return (
    <Container header={<Header variant="h3">🗺️ Recommandations locales</Header>}>
      <SpaceBetween size="m">
        <Box variant="p">
          Souhaitez-vous des recommandations locales personnalisées ou les recommandations standard de l'établissement?
        </Box>
        <SpaceBetween direction="horizontal" size="xs">
          <Button variant="primary" onClick={() => setMode('personalized')}>
            Recommandations personnalisées
          </Button>
          <Button variant="normal" onClick={() => generateRecommendations('')}>
            Recommandations standard
          </Button>
          <Button variant="link" onClick={() => onGenerated(null)}>
            Plus tard
          </Button>
        </SpaceBetween>
      </SpaceBetween>
    </Container>
  );
}

function GuestDashboard({ guest }) {
  const [info, setInfo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [localInfo, setLocalInfo] = useState(() => localStorage.getItem('guest-local-info') || '');
  const [welcomeDismissed, setWelcomeDismissed] = useState(() => localStorage.getItem('guest-welcome-done') === 'true');
  const [activeTab, setActiveTab] = useState('info');
  const bottomRef = useRef(null);
  const mode = window.location.port === '3082' ? 'hotel' : 'airbnb';

  useEffect(() => {
    fetch(API + '/api/guest/info').then(r => r.json()).then(setInfo).catch(() => {});
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim()) return;
    const text = input; setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      const res = await fetch(API + '/api/guest/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
      const data = await res.json();
      setMessages(m => [...m, { role: 'assistant', text: data.response || data.error }]);
    } catch (err) { setMessages(m => [...m, { role: 'assistant', text: 'Erreur: ' + err.message }]); }
    setLoading(false);
  };

  const guestName = guest?.guest?.name || guest?.name || 'Invité';
  const roomName = guest?.roomName || '';

  const handleRecommendationGenerated = (result) => {
    if (result) {
      setLocalInfo(result);
    }
    setWelcomeDismissed(true);
    localStorage.setItem('guest-welcome-done', 'true');
  };

  const handleRegenerate = () => {
    localStorage.removeItem('guest-local-info');
    setLocalInfo('');
  };

  // Welcome flow (shown before tabs if not dismissed)
  if (!welcomeDismissed && info) {
    return (
      <AppLayout
        content={
          <SpaceBetween size="l">
            <Header variant="h1">{mode === 'hotel' ? '🏨' : '🏠'} Bienvenue, {guestName}!</Header>

            {/* Property info */}
            <Container header={<Header variant="h3">📋 Informations sur la propriété</Header>}>
              <SpaceBetween size="m">
                {info.propertyDescription && (
                  <Box variant="p">{info.propertyDescription}</Box>
                )}
                {info.wifi?.name && (
                  <ColumnLayout columns={2}>
                    <Box><Box variant="awsui-key-label">📶 WiFi</Box><Box>{info.wifi.name}</Box></Box>
                    <Box><Box variant="awsui-key-label">🔑 Mot de passe</Box><Box>{info.wifi.password}</Box></Box>
                  </ColumnLayout>
                )}
                {info.rules && (
                  <Box>
                    <Box variant="awsui-key-label">📜 Règles</Box>
                    <Box variant="p">{info.rules}</Box>
                  </Box>
                )}
                {info.emergency && (
                  <Box>
                    <Box variant="awsui-key-label">🚨 Urgences</Box>
                    <Box variant="p">{info.emergency}</Box>
                  </Box>
                )}
                {info.checkoutTime && (
                  <Box>
                    <Box variant="awsui-key-label">🕐 Checkout</Box>
                    <Box variant="p">{info.checkoutTime}</Box>
                  </Box>
                )}
              </SpaceBetween>
            </Container>

            {/* Recommendation choice */}
            <RecommendationChoice onGenerated={handleRecommendationGenerated} />
          </SpaceBetween>
        }
        navigationHide
        toolsHide
      />
    );
  }

  const infoTab = (
    <SpaceBetween size="m">
      {mode === 'hotel' && roomName && (
        <Container header={<Header variant="h3">🛏️ Votre chambre</Header>}>
          <Box variant="p"><strong>{roomName}</strong></Box>
          {guest?.checkIn && <Box variant="p">📅 {guest.checkIn} → {guest.checkOut || 'Ouvert'}</Box>}
        </Container>
      )}
      {info?.propertyDescription && (
        <Container header={<Header variant="h3">🏠 La propriété</Header>}>
          <Box variant="p">{info.propertyDescription}</Box>
        </Container>
      )}
      {info?.wifi?.name && (
        <Container header={<Header variant="h3">📶 WiFi</Header>}>
          <ColumnLayout columns={2}>
            <Box><Box variant="awsui-key-label">Réseau</Box><Box>{info.wifi.name}</Box></Box>
            <Box><Box variant="awsui-key-label">Mot de passe</Box><Box>{info.wifi.password}</Box></Box>
          </ColumnLayout>
        </Container>
      )}
      {info?.rules && (
        <Container header={<Header variant="h3">📜 Règles de la maison</Header>}>
          <Box variant="p">{info.rules}</Box>
        </Container>
      )}
      {info?.emergency && (
        <Container header={<Header variant="h3">🚨 Urgences</Header>}>
          <Box variant="p">{info.emergency}</Box>
        </Container>
      )}
      {info?.checkoutTime && (
        <Container header={<Header variant="h3">🕐 Checkout</Header>}>
          <Box variant="p">{guest?.checkOut || info?.guest?.checkOut || 'Voir l\'hôte'} à {info.checkoutTime}</Box>
        </Container>
      )}
    </SpaceBetween>
  );

  const chatTab = (
    <Container>
      <SpaceBetween size="m">
        <Box padding="s">
          <SpaceBetween size="m">
            {messages.length === 0 && (
              <Box textAlign="center" color="text-body-secondary" padding={{ top: 'xxl' }}>
                <Box variant="p" fontSize="heading-m">Posez-moi une question!</Box>
                <Box variant="p">Restaurants, transport, activités, infos maison...</Box>
              </Box>
            )}
            {messages.map((m, i) => (
              <Box key={i} textAlign={m.role === 'user' ? 'right' : 'left'}>
                <Container variant="default">
                  <Box variant="p" color={m.role === 'user' ? 'text-status-info' : 'text-body-secondary'}>
                    <Box variant="small" fontWeight="bold">{m.role === 'user' ? 'Vous' : 'Assistant'}</Box>
                    {m.text}
                  </Box>
                </Container>
              </Box>
            ))}
            {loading && <Box textAlign="center"><Spinner size="normal" /></Box>}
            <Box><span ref={bottomRef} /></Box>
          </SpaceBetween>
        </Box>
        <ColumnLayout columns={4}>
          <Box gridDefinition={[{ colspan: 3 }]}>
            <Input value={input} onChange={({ detail }) => setInput(detail.value)}
              onKeyDown={({ detail }) => { if (detail.key === 'Enter' && !loading) send(); }}
              placeholder="Posez une question..." disabled={loading} />
          </Box>
          <Button variant="primary" onClick={send} loading={loading}>Envoyer</Button>
        </ColumnLayout>
      </SpaceBetween>
    </Container>
  );

  const localTab = (
    <SpaceBetween size="m">
      {localInfo ? (
        <Container header={<Header variant="h3" actions={
          <Button onClick={handleRegenerate} iconName="refresh">Régénérer</Button>
        }>🗺️ Recommandations locales</Header>}>
          <Box variant="p" style={{ whiteSpace: 'pre-wrap' }}>{localInfo}</Box>
        </Container>
      ) : (
        <RecommendationChoice onGenerated={(result) => { if (result) setLocalInfo(result); }} />
      )}
    </SpaceBetween>
  );

  return (
    <AppLayout
      content={
        <SpaceBetween size="l">
          <Header variant="h1">{mode === 'hotel' ? '🏨' : '🏠'} Bienvenue, {guestName}!{roomName ? ' — ' + roomName : ''}</Header>
          <Tabs
            activeTabId={activeTab}
            onChange={({ detail }) => setActiveTab(detail.activeTabId)}
            tabs={[
              { id: 'info', label: '📋 Info', content: infoTab },
              { id: 'chat', label: '💬 Chat', content: chatTab },
              { id: 'local', label: '🗺️ Local', content: localTab },
            ]}
          />
        </SpaceBetween>
      }
      navigationHide
      toolsHide
    />
  );
}

export default function GuestPortal() {
  const [auth, setAuth] = useState(false);
  const [guest, setGuest] = useState(null);

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem('guest-auth')); if (s?.valid) { setAuth(true); setGuest(s); } } catch {}
  }, []);

  if (!auth) return <LoginPage onLogin={d => { setAuth(true); setGuest(d); }} />;
  return <GuestDashboard guest={guest} />;
}
