'use client';
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import axios from 'axios';
import { Upload, Button, Table, Space, Typography, Divider, Layout, message, Empty } from 'antd';
import useLocalStorage from "use-local-storage";
import { DownloadOutlined, LoginOutlined, DeleteOutlined } from '@ant-design/icons';
import {downloadCsv} from './csvDownload';

const { Header, Content } = Layout;
const { Dragger } = Upload;
const { Title, Paragraph, Text } = Typography;
const AUTH_RESULT_KEY = 'apiAccountAuthResult';

export default function ApiAccount() {
    const [mounted, setMounted] = useState(false);

  const [apiAccounts, setApiAccounts] = useLocalStorage("apiAccounts", []);

  const searchParams = useSearchParams();
  const code = searchParams.get('code');

  const clearAuthSearchParams = () => {
    const url = new URL(window.location.href);
    ['code', 'scope', 'authuser', 'prompt'].forEach((param) => {
      url.searchParams.delete(param);
    });
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  };

  const saveToken = () => {
    if (!code) return;
    const tempClientId = localStorage.getItem("authClientId");
    const tempClientSecret = localStorage.getItem("authClientSecret");

    axios.post(`https://oauth2.googleapis.com/token`, {
      code,
      client_id: tempClientId,
      client_secret: tempClientSecret,
      redirect_uri: window.location.origin,
      grant_type: "authorization_code"
    }).then(res => {
      const refreshToken = res.data.refresh_token;
      axios.get(`https://www.googleapis.com/oauth2/v1/userinfo?alt=json&access_token=${res.data.access_token}`)
        .then(res => {
          const email = res.data.email;
          const updated = apiAccounts.map(entry => {
            if (entry.clientId === tempClientId && entry.clientSecret === tempClientSecret && !entry.user) {
              return { ...entry, user: email, pass: refreshToken };
            }
            return entry;
          });
          setApiAccounts(updated);
          localStorage.removeItem("authClientId");
          localStorage.removeItem("authClientSecret");

          clearAuthSearchParams();

          if (window.opener && !window.opener.closed) {
            localStorage.setItem(AUTH_RESULT_KEY, JSON.stringify({
              email,
              timestamp: Date.now(),
            }));
            window.close();
            return;
          }

          message.success(`Token saved for ${email}`);
        })
        .catch(err => console.log(err));
    }).catch(err => console.log(err));
  };

  useEffect(() => { saveToken(); }, [code]);

    useEffect(() => {
      const handleStorage = (event) => {
        if (event.key !== AUTH_RESULT_KEY || !event.newValue) return;

        try {
          const { email } = JSON.parse(event.newValue);
          if (email) {
            message.success(`Token saved for ${email}`);
          }
        } catch (err) {
          console.error('Failed to read auth result:', err);
        }

        localStorage.removeItem(AUTH_RESULT_KEY);
      };

      window.addEventListener('storage', handleStorage);
      return () => window.removeEventListener('storage', handleStorage);
    }, []);

const handleSmtpAdd = (clientId, clientSecret) => {
  localStorage.setItem("authClientId", clientId);
  localStorage.setItem("authClientSecret", clientSecret);

    const authUrl =
      `https://accounts.google.com/o/oauth2/auth?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(window.location.origin)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent('https://www.googleapis.com/auth/userinfo.email https://mail.google.com')}` +
      `&access_type=offline` +
      `&prompt=consent`;

    const authWindow = window.open(
      authUrl,
      'gmail-oauth-login',
      'popup=yes,width=560,height=720'
    );

    if (!authWindow) {
      window.location.href = authUrl;
      return;
    }

    authWindow.focus();
};

  const columns = [
    { title: 'Project Info', dataIndex: 'user', key: 'user', ellipsis: true , render: (_,record) => (<div style={{display:'flex', }}>
      <div>
      
          <Text>{record.key + 1}. </Text>
          <Text>Email: {record.user || <Button size='small' type='primary' onClick={() => handleSmtpAdd(record.clientId, record.clientSecret)}>Login</Button>}</Text>

    
      <br />
        <Text type="secondary">Api File: {record.filename}</Text>
        </div>
        <Button
        size='small'
        onClick={() => {
          const remaining = apiAccounts.filter((_, idx) => idx !== record.key);
          setApiAccounts(remaining);
          message.success('Account deleted');
        }}><DeleteOutlined /></Button>
    </div>)
      
 },

  ];
        

  // Keep keys stable and identical to indices
  const dataWithKeys = apiAccounts.map((item, idx) => ({ ...item, key: idx }));

  useEffect(() => {
    setMounted(true);
  }, []);

   if (!mounted) {
    return null;
  }


  return (


      <div style={{ marginTop: "20px", display: 'flex',marginBottom: 8 }}>
 
        <div  style={{width:"150px",marginRight: 16 }}>
          <Dragger
            accept=".json"
            multiple
            beforeUpload={(file) => {
              const reader = new FileReader();
              reader.onload = (event) => {
                try {
                  const obj = JSON.parse(event.target.result);
                  const creds = obj.web || obj.installed;
                  if (creds?.client_id && creds?.client_secret) {
                    const newEntry = {
                      user: "",
                      pass: "",
                      clientId: creds.client_id,
                      clientSecret: creds.client_secret,
                      redirectUri: `http://localhost`,
                      filename: file.name,
                    };
                    setApiAccounts((prev) => [...prev, newEntry]);
                  }
                } catch (err) {
                  console.error(`Error parsing ${file.name}:`, err);
                }
              };
              reader.readAsText(file);
              return false;
            }}
            showUploadList={false}
            style={{ background: '#1f1f1f', padding: 16, borderRadius: 10, textAlign: 'center' }}
          >
         
            <Paragraph style={{ color: '#aaa', fontSize: 13, marginTop: 4 }}>Add or drop Project JSON files here</Paragraph>
          </Dragger>
        </div>

        {apiAccounts.length > 0 && (
          <>

            <Table
              // turn off pagination and set fixed height with scroll
              pagination={false}
              scroll={{ y: 240 }}
              style={{ background: '#141414', borderRadius: 8, width: '400px' }}
              dataSource={dataWithKeys}       
              columns={columns}
            />

          </>
        )}

     

      </div>
  );
}