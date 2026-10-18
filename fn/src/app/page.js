'use client'

import './App.css';
import { useContext, useEffect, useState } from 'react';
import { Layout, Card, Drawer, Input, Segmented } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import Head from 'next/head';
import useLocalStorage from 'use-local-storage';
import Content from '../components/mymail/content/content';
import BrowserSmtp from '@/components/browserSmtp';
import DirectSend from '@/components/directSend';
import Setting from '@/components/mymail/setting';
import { Context } from '@/context/mymailContext';
import { AuthContext } from '@/context/authContext';
import { useRouter } from 'next/navigation';

const SEND_METHODS = [
  { label: 'Browser', value: 'BROWSER' },
  { label: 'App Password', value: 'APPPASS' },
  { label: 'Gmail API', value: 'API_HTTP' },
];

function App() {
  const [open, setOpen] = useState(false);
  const { license, loading } = useContext(AuthContext);
  const router = useRouter();
  const { senderName, setSenderName } = useContext(Context);
  const [sendMethod, setSendMethod] = useLocalStorage('sendMethod', 'BROWSER');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!loading && !license) router.replace('/login');
  }, [loading, license, router]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Avoid a hydration mismatch: server-rendered markup has no access to localStorage.
  const persistedMethod = mounted ? sendMethod : 'BROWSER';
  const activeMethod = SEND_METHODS.some((method) => method.value === persistedMethod)
    ? persistedMethod
    : 'BROWSER';
  const sendMethodOptions = SEND_METHODS;

  return (
    <div className="App">
      <Head><title>MyMail</title></Head>
      <Layout>
        <div className="settingIcon"><SettingOutlined onClick={() => setOpen(true)} /></div>
        <Drawer title="Settings" placement="right" closable onClose={() => setOpen(false)} open={open}>
          <Setting />
        </Drawer>
        <main className="main">
          <Segmented options={sendMethodOptions} value={activeMethod} onChange={setSendMethod} />
          {activeMethod === 'BROWSER' ? (
            <Input
              size="small"
              placeholder="Sender Name (blank = account default, applies to every Browser window)"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              style={{ maxWidth: 420 }}
            />
          ) : null}
          {activeMethod === 'BROWSER' ? <BrowserSmtp /> : <DirectSend method={activeMethod} />}
          <Card size="small" className="card"><Content sendMethod={activeMethod} /></Card>
        </main>
      </Layout>
    </div>
  );
}

export default App;
