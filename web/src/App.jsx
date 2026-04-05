import { useState, useEffect } from 'react';
import AppLayout from '@cloudscape-design/components/app-layout';
import SideNavigation from '@cloudscape-design/components/side-navigation';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import ChatPanel from './panels/ChatPanel';
import ConfigPanel from './panels/ConfigPanel';
import LogsPanel from './panels/LogsPanel';

const API = '';

export default function App() {
  const [activePanel, setActivePanel] = useState('chat');
  const [status, setStatus] = useState({});

  useEffect(() => {
    const load = () => fetch(API + '/api/status').then(r => r.json()).then(setStatus).catch(() => {});
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <TopNavigation
        identity={{ title: 'Vertex Nova', href: '#' }}
        utilities={[
          { type: 'button', text: status.model || '...', iconName: 'settings' },
          { type: 'button', text: status.memory || '...', iconName: 'status-info' },
        ]}
      />
      <AppLayout
        navigation={
          <SideNavigation
            activeHref={'#/' + activePanel}
            header={{ text: 'Navigation', href: '#' }}
            items={[
              { type: 'link', text: 'Chat', href: '#/chat' },
              { type: 'link', text: 'Configuration', href: '#/config' },
              { type: 'link', text: 'Logs', href: '#/logs' },
              { type: 'divider' },
              { type: 'link', text: 'Statut', href: '#/status', info: (
                <StatusIndicator type={status.ollama ? 'success' : 'error'}>
                  {status.ollama ? 'En ligne' : 'Hors ligne'}
                </StatusIndicator>
              )},
            ]}
            onFollow={e => { e.preventDefault(); setActivePanel(e.detail.href.replace('#/', '')); }}
          />
        }
        content={
          activePanel === 'chat' ? <ChatPanel api={API} /> :
          activePanel === 'config' ? <ConfigPanel api={API} /> :
          activePanel === 'logs' ? <LogsPanel api={API} /> :
          <div>Statut: {JSON.stringify(status, null, 2)}</div>
        }
        toolsHide
        navigationWidth={220}
      />
    </div>
  );
}
