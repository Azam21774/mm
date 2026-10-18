import React, { useContext } from 'react';
import { Button, Divider, Typography, message } from 'antd';
import { PoweroffOutlined } from '@ant-design/icons';
import { AuthContext } from '@/context/authContext';

const Setting = () => {
  const { Text } = Typography;
  const { license, logout } = useContext(AuthContext);

  const deactivate = async () => {
    const result = await logout();
    if (result?.error) message.error(result.error);
  };

  return <div style={{ height: '97%', padding: '10px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}><div><Text strong>License status</Text><Divider /><Text type="secondary">Username</Text><br /><Text>{license?.username || '-'}</Text><br /><br /><Text type="secondary">Key</Text><br /><Text code>{license?.key || '-'}</Text><br /><br /><Text type="secondary">Expires</Text><br /><Text>{license?.expiresAt ? new Date(license.expiresAt).toLocaleString() : '-'}</Text><br /><br /><Text type="secondary">Devices</Text><br /><Text>{license?.devicesOnline ?? license?.devicesUsed ?? 0} / {license?.deviceLimit ?? 1} online</Text><br /><Text type="success">{license?.devicesRemaining ?? 0} device {license?.devicesRemaining === 1 ? 'slot' : 'slots'} left</Text></div><Button danger onClick={deactivate}><PoweroffOutlined /> Deactivate this device</Button></div>;
};

export default Setting;
