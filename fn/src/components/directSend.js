'use client';
import React from 'react';
import Smtp from './mymail/smtp/smtp';
import ApiAccount from './apiAccount';
import DirectSendTable from './directSendTable';

// App Password / Gmail API tab: the account manager (add/remove accounts, OAuth login
// for Gmail API) on top, and the Browser-style sending table below it so each
// configured account can load its own recipients and send independently.
const DirectSend = ({ method }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
        {method === 'APPPASS' ? <Smtp /> : <ApiAccount />}
        <DirectSendTable method={method} />
    </div>
);

export default DirectSend;
