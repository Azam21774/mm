'use client';

import { useContext, useState } from 'react';
import { Alert, Button, Card, Input, Typography } from 'antd';
import { AuthContext } from '@/context/authContext';

export default function LoginPage() {
  const { redeemLicense } = useContext(AuthContext);
  const [username, setUsername] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await redeemLicense(licenseKey, username);
      if (result?.active) {
        window.location.replace('/');
      } else {
        setError(result?.error || 'Activation failed. Check your username and license key.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <Card style={{ width: '100%', maxWidth: 440 }}>
        <Typography.Title level={3}>Activate MyMail</Typography.Title>
        <Typography.Paragraph>Enter the username and license key supplied by your administrator.</Typography.Paragraph>
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
        <form onSubmit={submit}>
          <label htmlFor="license-username">Username</label>
          <Input id="license-username" autoComplete="username" value={username}
            onChange={(e) => setUsername(e.target.value)} required style={{ margin: '8px 0 16px' }} />
          <label htmlFor="license-key">License key</label>
          <Input id="license-key" autoComplete="off" value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)} required style={{ margin: '8px 0 20px' }} />
          <Button type="primary" htmlType="submit" loading={busy} block>Activate license</Button>
        </form>
      </Card>
    </main>
  );
}
