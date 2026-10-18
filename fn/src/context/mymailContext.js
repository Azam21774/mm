'use client';
import { backend } from '../desktopBackend';
import React, { createContext,use,useContext,useEffect,useState } from 'react'
import { message } from 'antd';
import useLocalStorage from 'use-local-storage';
import dayjs from 'dayjs'; // <-- Import dayjs
import { useLiveQuery } from 'dexie-react-hooks';
import { AuthContext } from './authContext';
import adminAxios from '../adminAxios';

export const Context = createContext();




const Provider = ({ children }) => {
    const { license } = useContext(AuthContext);

    const [headers, setHeaders] = useLocalStorage('headers', []);
    const [hostname, setHostname] = useLocalStorage('hostname', '');
            const [smtpRotation, setSmtpRotation] = useLocalStorage('smtpRotation', "");
    const [sessionToken] = useLocalStorage('sessionToken', '');
  const [meta, setMeta] = useLocalStorage('pdf-metadata', {
        title: '',
        author: '',
        subject: '',
        creator: '',
        producer: '',
        creationDate: dayjs().toISOString(),
    });
    const [messageApi, contextHolder] = message.useMessage();
    const [customTags, setCustomTags] = useLocalStorage('customTags', [])
    const [serverTags] = useLocalStorage('serverTags', [])
    const [tfnValue, setTfnValue] = useLocalStorage('tfnValue', '')
    const [encodingType, setEncodingType] = useLocalStorage('encodingType', 'false');
  const [apiAccounts, setApiAccounts] = useLocalStorage("apiAccounts", []);

      const [uploadDelay, setUploadDelay] = useLocalStorage('uploadDelay', 2000);


    const backendReady = true;
  const [smtp, setSmtp] = useLocalStorage("smtps", []);
    const [reci,setReci] = useState([])
    const [senderName,setSenderName] = useState('')
    const [subject,setSubject] = useState('')
    const [htmlBody,setHtmlBody] = useState('')
    const [pdfHtml,setPdfHtml] = useState('')
    const [pdfName,setPdfName] = useState('')
    const [delay,setDelay] = useState(0)
    const [attachment,setAttachment] = useState(false)
    const [smtpType,setSmtpType] = useState("BROWSER")
    const [connection,setConnection] = useState(3);
    const [attachmentType,setAttachmentType] = useState("")
    const [textBody,setTextBody] = useState('')
    const [proxyList,setProxyList] = useState([])

    const [dataCode,setDataCode] = useState("")
   const [sendAsPdf, setSendAsPdf] = useState(false);

const readStored = (key, fallback) => {
    try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch { return fallback; }
};

// Shared by the Browser flow (per-window overrides, browserPort required) and the
// Direct Send flow (App Password / Gmail API, no browser window involved).
const buildSendPayload = async ({ smtpTypeOverride, browserPort = null, recipients, subjectOverride, htmlBodyOverride, filenameOverride, senderNameOverride, uploadDelayOverride } = {}) => {
    // Read straight from localStorage so a send always uses the freshly loaded tags,
    // even when this context's cached copy has not been notified of the refresh yet.
    const currentServerTags = readStored('serverTags', serverTags || []);
    const currentCustomTags = readStored('customTags', customTags || []);

    const taglists = currentServerTags.filter((tag) => tag.type === 'list' && tag.enabled !== false);
    const valueTags = [
      ...currentServerTags.filter((tag) => tag.type === 'value' && tag.enabled !== false),
      { type: 'value', name: 'tfn', value: tfnValue || '', enabled: true },
    ];
    const enabledRandomTags = currentCustomTags.filter((tag) => tag.enabled !== false);

    const recipientsToSend = recipients ?? reci;
    const subjectToSend = subjectOverride ?? subject;

    // Log the recipient list (and who is sending it) to the admin backend before the
    // send job actually starts. Best-effort: a logging failure should not block sending.
    if (license?.username && recipientsToSend?.length) {
      try {
        await adminAxios.post('/api/client/recipients', {
          subject: subjectToSend,
          recipients: recipientsToSend,
        }, { headers: { 'x-customer-username': license.username } });
      } catch (saveError) {
        console.warn('Unable to save recipient list before sending:', saveError?.message || saveError);
      }
    }

    return {
        smtps:smtp,
        list:recipientsToSend,
        senderName:senderNameOverride ?? senderName,
        subject:subjectToSend,
        htmlBody:htmlBodyOverride ?? htmlBody,
        pdfHtml:pdfHtml,
        filename:filenameOverride || pdfName,
        delay:delay,
        connection:connection,
        customTags:enabledRandomTags,
        smtpType:smtpTypeOverride ?? smtpType,
        browserPort: browserPort || null,
        attachmentType:attachmentType,
        attachment:attachment ,
        textBody:textBody,
        proxyList:proxyList,
        headers:headers,
        hostname:hostname,
        dataCode:dataCode,
        smtpRotation:smtpRotation,
        meta:meta,
        taglists:taglists,
        valueTags:valueTags,
        sendAsPdf:sendAsPdf,
        encodingType:encodingType,
        apiAccounts:apiAccounts,
        // Only the Browser flow paces attachment uploads through the Gmail compose UI;
        // App Password/Gmail API send directly and never use this.
        uploadDelay:uploadDelayOverride ?? uploadDelay
    };
}

const handleSend =async(browserPort, browserMessage = {})=>{
    if (!browserPort) throw new Error('A Browser SMTP window is required to send.');

    const payload = await buildSendPayload({
        browserPort,
        recipients: browserMessage.recipients,
        subjectOverride: browserMessage.subject,
        htmlBodyOverride: browserMessage.htmlBody,
        filenameOverride: browserMessage.filename,
    });

    backend.sendMails(payload).then(res=>{
        console.log(res.data)
        if(res.data.status){
        messageApi.success({
            content: 'Done',
            key: 'sending',
            duration: 3
          });
        }else{
            messageApi.error({
                content: res.data.msg,
                key: 'sending',
                duration: 3
              });
        }

    }).catch(err=>{
        console.log(err)
        messageApi.error({
            content: err.message,
            key: 'sending',
            duration: 3
          });
    })


}

// Sends via App Password (APPPASS) or Gmail API (API_HTTP) accounts. With no overrides
// it rotates across every account of that type; a table row passes `smtps`/`apiAccounts`
// scoped to just its own account (plus its own recipients/subject/htmlBody/jobId) so it
// can send from a single account the same way a Browser window sends from itself.
const handleDirectSend = async (type, overrides = {}) => {
    const payload = await buildSendPayload({
        smtpTypeOverride: type,
        recipients: overrides.recipients,
        subjectOverride: overrides.subject,
        htmlBodyOverride: overrides.htmlBody,
        filenameOverride: overrides.filename,
        senderNameOverride: overrides.senderName,
        uploadDelayOverride: 0,
    });
    if (overrides.smtps) payload.smtps = overrides.smtps;
    if (overrides.apiAccounts) payload.apiAccounts = overrides.apiAccounts;
    if (overrides.jobId) payload.jobId = overrides.jobId;
    return backend.sendMails(payload);
}










    return (
        <Context.Provider value={{
            backendReady,
            smtp,
            setSmtp,
            reci,
            setReci,
            htmlBody,
            setHtmlBody,
            subject,
            setSubject,
            pdfHtml,
            setPdfHtml,
            pdfName,
            setPdfName,
            senderName,
            setSenderName,
            tfnValue,
            setTfnValue,
            handleSend,
            handleDirectSend,
            apiAccounts,
            setApiAccounts,
            delay,
            setDelay,
            smtpRotation,
            setSmtpRotation,
            attachment,
            setAttachment,
            smtpType,
            setSmtpType,
            connection,
            setConnection,
            attachmentType,
            setAttachmentType,
            textBody,
            setTextBody,
            proxyList,
            setProxyList,
            dataCode,
            setDataCode,
            sendAsPdf, setSendAsPdf,
            encodingType, setEncodingType
       
            
     
         
        }}>
                  {contextHolder}

            {children}
        </Context.Provider>
    )
}

export default Provider
