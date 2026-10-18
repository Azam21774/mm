import { Button, Dropdown, Input, message, Popconfirm, Progress, Select, Table, Space, Upload} from 'antd';
import { useState,useContext, useEffect, useRef } from 'react';
import { Context } from '../context/mymailContext';
import { CloseCircleOutlined, CopyOutlined, EllipsisOutlined, FileAddFilled, PlayCircleOutlined, PlusOutlined, SendOutlined, StopOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { uid } from 'uid';
import * as XLSX from 'xlsx';
import { CSVLink } from 'react-csv';


import { backend } from '../desktopBackend';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Same rotation strategies the backend supports for a multi-SMTP job (utils/listRotator.js),
// reused here client-side to decide the order windows are started in for "Send from All".
const ROTATION_OPTIONS = [
    { value: 'parallel', label: 'Parallel (start all at once)' },
    { value: 'sequential', label: 'Sequential (in order)' },
    { value: 'random', label: 'Random' },
    { value: 'shuffle', label: 'Shuffle' },
];

// Orders eligible windows to start according to the chosen rotation strategy. Every
// window is started exactly once either way - "random" and "shuffle" both give a
// randomized order, just via different picks, matching the backend's own strategy names.
const orderForRotation = (items, strategy) => {
    if (strategy === 'sequential' || strategy === 'parallel') return items;
    const pool = [...items];
    const ordered = [];
    while (pool.length) ordered.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return ordered;
};

// Splits the shared recipient pool into `parts` near-equal, non-overlapping chunks (round
// robin) so windows borrowing from it each send to their own slice instead of everyone
// sending to the whole pool.
const splitEvenly = (list, parts) => {
    const chunks = Array.from({ length: Math.max(parts, 1) }, () => []);
    list.forEach((item, i) => chunks[i % chunks.length].push(item));
    return chunks;
};



const BrowserSmtp = () => {

    const {backendReady, handleSend, attachmentType, senderName, delay, smtpRotation, setSmtpRotation} = useContext(Context);
    const [messageApi, contextHolder] = message.useMessage();
    const [chromeList, setChromeList] = useState([]);
    const [browserMessages, setBrowserMessages] = useState({});
    // Ports we've already tried to apply the Gmail sender name to, so a window
    // that just became ready only gets this once, not on every browser-list tick.
    const senderNameAppliedPorts = useRef(new Set());
    const [sendingAll, setSendingAll] = useState(false);
    // The window ports started by the most recent "Send from All" run, so the footer can
    // show one combined attachment/sending progress bar across all of them.
    const [sendAllPorts, setSendAllPorts] = useState([]);
    // Shared fallback list for "Send from All": any window that has no recipient file
    // of its own loaded uses this one instead, so you don't have to load a file per window.
    const [allRecipients, setAllRecipients] = useState([]);
    const [allRecipientsFileName, setAllRecipientsFileName] = useState('');
    // Clicking Send has a real network round trip (enabling sending on the backend) before
    // the window's isSending flag comes back through IPC, so without this the button sits
    // enabled and un-loading during that gap and a second click can start a duplicate job.
    // startingRef is checked synchronously to block that; startingPorts drives the button's
    // loading/disabled look for the same gap.
    const startingRef = useRef(new Set());
    const [startingPorts, setStartingPorts] = useState({});
    const startingTimeoutsRef = useRef(new Map());
    // Same synchronous double-click guard as startingRef, for the "Send Drafts" action.
    const draftsSendingRef = useRef(new Set());
    const [draftsSendingPorts, setDraftsSendingPorts] = useState({});
    // Guards "Send from All" itself: sendingAll (state) only disables the button after
    // React re-renders, so a click fired in the same tick as the first would still slip
    // through the button's own onClick; this ref closes that gap synchronously.
    const sendingAllRef = useRef(false);

    const updateBrowserMessage = (port, field, value) => {
        setBrowserMessages((current) => ({
            ...current,
            [port]: { ...current[port], [field]: value },
        }));
    };

    // Copies this window's Subject/Body/Filename onto every other window, so you
    // don't have to retype the same message per Chrome window.
    const copyMessageToAll = (port) => {
        const source = browserMessages[port] || {};
        setBrowserMessages((current) => {
            const next = { ...current };
            chromeList.forEach((instance) => {
                if (instance.port === port) return;
                next[instance.port] = {
                    ...current[instance.port],
                    subject: source.subject || '',
                    htmlBody: source.htmlBody || '',
                    filename: source.filename || '',
                };
            });
            return next;
        });
        messageApi.success('Copied to all windows.');
    };

    const parseRecipientFile = (file, onParsed) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const recipients = XLSX.utils.sheet_to_json(worksheet, { header: 1 })
                .filter((row) => row[0])
                .map((row) => ({
                    cid: uid(),
                    email: String(row[0]).trim(),
                    name: row[1] || '',
                    c3: row[2] || '',
                    c4: row[3] || '',
                    c5: row[4] || '',
                    c6: row[5] || '',
                }));
            onParsed(recipients);
        };
        reader.readAsArrayBuffer(file);
        return false;
    };

    const loadRecipients = (port, file) => parseRecipientFile(file, (recipients) => {
        setBrowserMessages((current) => ({
            ...current,
            [port]: {
                ...current[port],
                recipients: [...(current[port]?.recipients || []), ...recipients],
                recipientFileName: file.name,
            },
        }));
    });

    // Fallback list for "Send from All": windows with no recipient file of their own
    // borrow from this one, so you don't have to load a file per window.
    const loadAllRecipients = (file) => parseRecipientFile(file, (recipients) => {
        setAllRecipients((current) => [...current, ...recipients]);
        setAllRecipientsFileName(file.name);
    });

    useEffect(() => {
        if (!backendReady) return undefined;
        const subscriptions = backend.subscriptions();

        subscriptions.on('browser-list', ({ chromeList: liveChromeList }) => {
            setChromeList(Array.isArray(liveChromeList) ? liveChromeList : []);
        });

        backend.listBrowsers()
            .then((r) => r.data)
            .then(({ chromeList: fetchedChromeList }) => {
                setChromeList(Array.isArray(fetchedChromeList) ? fetchedChromeList : []);
            })
            .catch((error) => {
                console.error('Error fetching initial Chrome list:', error);
            });

        return () => {
            subscriptions.dispose();
        };
    }, [backendReady]);

    // The first time a window's Gmail account is detected as ready, set that
    // account's own "Send mail as" display name to match the configured Sender
    // Name — Browser-mode sending drives Gmail's own compose UI, which always
    // uses the account's own name and ignores mailOptions.from.
    useEffect(() => {
        if (!backendReady || !senderName?.trim()) return;

        chromeList.forEach((instance) => {
            if (instance.status !== 'ready' || !instance.email) return;
            if (senderNameAppliedPorts.current.has(instance.port)) return;
            senderNameAppliedPorts.current.add(instance.port);

            backend.setSenderName(instance.port, senderName)
                .then((response) => {
                    if (!response.data?.status) {
                        messageApi.error(response.data?.msg || `Could not set the Gmail sender name for ${instance.email}.`);
                    }
                })
                .catch((error) => {
                    messageApi.error(error.response?.data?.msg || `Could not set the Gmail sender name for ${instance.email}.`);
                });
        });
    }, [backendReady, chromeList, senderName, messageApi]);

    const startChrome = () => {

        backend.startChrome()
            .then(response => {
                console.log('Chrome started successfully:', response.data);
            })
            .catch(error => {
                console.error('Error starting Chrome:', error);
            });
}

    const getchrome = () => {
        

        backend.listBrowsers()
            .then(response => {
                console.log('Chrome status:', response.data);
                setChromeList(response.data.chromeList);
            })
            .catch(error => {
                console.error('Error getting Chrome status:', error);
            });
}

    const setBrowserSending = async (record, enabled) => {
        try {
            const response = await backend.setBrowserSending(record.port, enabled);
            if (!enabled) messageApi.success(response.data.msg);
            return true;
        } catch (error) {
            messageApi.error(error.response?.data?.msg || 'Unable to update browser sending.');
            return false;
        }
    };

    const closeBrowser = async (record) => {
        try {
            const response = await backend.closeBrowser(record.port);
            setChromeList((current) => current.filter((browser) => browser.port !== record.port));
            setBrowserMessages((current) => {
                const next = { ...current };
                delete next[record.port];
                return next;
            });
            messageApi.success(response.data.msg || 'Browser window closed.');
        } catch (error) {
            messageApi.error(error.response?.data?.msg || 'Unable to close browser window.');
        }
    };

    // Releases the "starting" lock for a port - called once the backend confirms real
    // sending has begun (record.isSending, via the effect below), on error, or after the
    // safety-net timeout, so the button can never get stuck disabled forever.
    const releaseStarting = (port) => {
        startingRef.current.delete(port);
        setStartingPorts((current) => {
            if (!(port in current)) return current;
            const next = { ...current };
            delete next[port];
            return next;
        });
        const timeout = startingTimeoutsRef.current.get(port);
        if (timeout) {
            clearTimeout(timeout);
            startingTimeoutsRef.current.delete(port);
        }
    };

    // recipientsOverride lets "Send from All" send this window's own list when it has
    // one, or fall back to the shared allRecipients list when it doesn't.
    const sendFromBrowser = async (record, recipientsOverride) => {
        // Checked synchronously against a ref (not React state) so a second click fired
        // during the enable-sending round trip below can't start a duplicate job.
        if (startingRef.current.has(record.port) || record.isSending) return;

        startingRef.current.add(record.port);
        setStartingPorts((current) => ({ ...current, [record.port]: true }));
        // The button stays locked past this round trip - handleSend below is fire-and-forget,
        // and record.isSending only flips true once the backend confirms through IPC
        // (after connecting/attachment setup), so releasing right after this resolves would
        // reopen a window for a rapid second click to start a duplicate job. The lock is
        // released by the isSending effect below instead, with this as a fallback so a
        // window that never confirms doesn't stay stuck.
        startingTimeoutsRef.current.set(record.port, setTimeout(() => releaseStarting(record.port), 20000));
        try {
            if (await setBrowserSending(record, true)) {
                const message = browserMessages[record.port] || {};
                handleSend(record.port, recipientsOverride ? { ...message, recipients: recipientsOverride } : message);
            } else {
                releaseStarting(record.port);
            }
        } catch (err) {
            releaseStarting(record.port);
        }
    };

    // Once the backend confirms a window is actually sending, its row switches to the
    // Stop button anyway, so release the starting lock - this is what actually closes the
    // gap between the initial round trip resolving and real sending being confirmed.
    useEffect(() => {
        chromeList.forEach((record) => {
            if (record.isSending && startingRef.current.has(record.port)) releaseStarting(record.port);
        });
        // A closed window can never confirm isSending, so don't leave it locked.
        const livePorts = new Set(chromeList.map((record) => record.port));
        startingRef.current.forEach((port) => {
            if (!livePorts.has(port)) releaseStarting(port);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chromeList]);

    // Stops every window currently sending (whether started by an individual Send click
    // or by "Send from All"), so the footer button doubles as a one-click "Stop All" the
    // moment anything here is in flight.
    const stopAllBrowsers = async () => {
        const sendingRecords = chromeList.filter((record) => record.isSending);
        await Promise.all(sendingRecords.map((record) => setBrowserSending(record, false)));
    };

    // Loops through every ready browser window and starts each one's own send job in turn
    // (order set by the rotation type), waiting the configured send delay before starting
    // the next window - "parallel" starts them all together with no wait between starts.
    // A window with its own recipient file keeps using it; windows with no file of their
    // own split the shared allRecipients pool between them (each gets its own slice, not
    // the whole pool), so the same recipients aren't sent to - and attachments generated for -
    // every window.
    const sendFromAll = async () => {
        // Checked synchronously so a double-click on "Send from All" can't start two runs
        // in the instant before React re-renders the button as loading.
        if (sendingAllRef.current) return;

        const eligible = chromeList.filter((record) => record.status === 'ready' && !record.isSending && ((browserMessages[record.port]?.recipients?.length || 0) > 0 || allRecipients.length > 0));

        if (eligible.length < 2) {
            messageApi.error('Load recipients (per window, or a shared file below) on at least two ready windows before sending from all.');
            return;
        }

        const poolRecords = eligible.filter((record) => !(browserMessages[record.port]?.recipients?.length || 0));
        const poolChunks = splitEvenly(allRecipients, poolRecords.length);
        const poolAssignment = new Map();
        poolRecords.forEach((record, i) => poolAssignment.set(record.port, poolChunks[i]));

        // Drop pool-sharing windows that ended up with an empty slice (more windows than recipients).
        const sendable = eligible.filter((record) => (browserMessages[record.port]?.recipients?.length || 0) > 0 || (poolAssignment.get(record.port)?.length || 0) > 0);
        if (sendable.length < 2) {
            messageApi.error('Not enough recipients to split across the ready windows.');
            return;
        }

        const strategy = smtpRotation || 'parallel';
        const order = orderForRotation(sendable, strategy);
        const pauseMs = strategy === 'parallel' ? 0 : Number(delay) || 0;

        sendingAllRef.current = true;
        setSendingAll(true);
        setSendAllPorts(sendable.map((record) => record.port));
        try {
            for (let i = 0; i < order.length; i += 1) {
                const record = order[i];
                sendFromBrowser(record, (browserMessages[record.port]?.recipients?.length || 0) ? undefined : poolAssignment.get(record.port));
                if (pauseMs && i < order.length - 1) await sleep(pauseMs);
            }
        } finally {
            sendingAllRef.current = false;
            setSendingAll(false);
        }
    };

    // Combined attachment-generation/sending progress across every window started by the
    // last "Send from All" run, so the footer can show one status instead of making you
    // check each row - mirrors the per-row "Sent / Total" cell logic, just summed up.
    const sendAllStats = () => {
        if (!sendAllPorts.length) return null;
        let attachCount = 0;
        let attachTotal = 0;
        let generatingAttachments = false;
        let assigned = 0;
        let sent = 0;
        let failed = 0;
        let running = false;
        sendAllPorts.forEach((port) => {
            const record = chromeList.find((item) => item.port === port);
            if (!record) return;
            assigned += record.assignedCount || 0;
            sent += record.sentCount || 0;
            failed += record.failedCount || 0;
            if (record.isSending) running = true;
            const attachmentJob = record.attachmentProcessing || {};
            if (record.isSending && attachmentJob.loading) {
                generatingAttachments = true;
                attachCount += attachmentJob.count || 0;
                attachTotal += attachmentJob.total || record.assignedCount || 0;
            }
        });
        return { generatingAttachments, attachCount, attachTotal, assigned, sent, failed, running };
    };

    const sendDraftsFromBrowser = async (record) => {
        if (draftsSendingRef.current.has(record.port)) return;
        draftsSendingRef.current.add(record.port);
        setDraftsSendingPorts((current) => ({ ...current, [record.port]: true }));
        try {
            const response = await backend.sendDrafts(record.port);
            messageApi.success(response.data.msg || 'Sending drafts started.');
        } catch (error) {
            messageApi.error(error.response?.data?.msg || 'Unable to start sending drafts.');
        } finally {
            draftsSendingRef.current.delete(record.port);
            setDraftsSendingPorts((current) => {
                const next = { ...current };
                delete next[record.port];
                return next;
            });
        }
    };

    const sendMoreMenuItems = (record) => [
        {
            key: 'send-drafts',
            label: draftsSendingPorts[record.port] ? 'Sending drafts…' : 'Send Drafts',
            icon: <SendOutlined />,
            disabled: !!draftsSendingPorts[record.port],
            onClick: () => sendDraftsFromBrowser(record),
        },
    ];

const HeaderWithButton = () => (
  <Space>
    <Button type="primary" size="small" onClick={startChrome}>
      <PlusOutlined />
   
    </Button>
  </Space>
);
  

    const columns = [
        {
           title: <HeaderWithButton />,
            key: 'serialNo',
            width: 70,
            render: (text, record, index) => index + 1,
        },
        {
            title: 'Status',
            dataIndex: 'status',
            width: 70,
            key: 'status',
            render: (status, record) => <Space size={7}>
                <span>{status || '-'}</span>
                <Popconfirm title="Close this Chrome window?" description="Its current sending job will also stop." okText="Close browser" okButtonProps={{ danger: true }} onConfirm={() => closeBrowser(record)}>
                    <CloseCircleOutlined style={{ color: '#ff4d4f', cursor: 'pointer', fontSize: 13 }} />
                </Popconfirm>
            </Space>,
        },
        {
            title: 'Message',
            key: 'message',
            width: 460,
            render: (_, record) => (
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', minHeight: 20, padding: '0 2px' }}>
                        <span style={{ width: 7, height: 7, flex: '0 0 auto', borderRadius: '50%', background: record.email ? (record.isSending ? '#44AE4E' : '#3b82f6') : '#666' }} />
                        <span style={{ minWidth: 0, overflow: 'hidden', color: record.email ? (record.isSending ? '#44AE4E' : '#aaa') : '#777', fontSize: 12, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={record.email || ''}>{record.email || 'Waiting for Gmail account'}</span>
                    </div>
                    <Input size="small" placeholder="Subject Line" value={browserMessages[record.port]?.subject || ''} disabled={record.isSending} onChange={(event) => updateBrowserMessage(record.port, 'subject', event.target.value)} />
                    <Input size="small" placeholder="Body HTML" value={browserMessages[record.port]?.htmlBody || ''} disabled={record.isSending} onChange={(event) => updateBrowserMessage(record.port, 'htmlBody', event.target.value)} />
                    {attachmentType ? <Input size="small" placeholder="Filename (default: {{cid}})" value={browserMessages[record.port]?.filename || ''} disabled={record.isSending} onChange={(event) => updateBrowserMessage(record.port, 'filename', event.target.value)} /> : null}
                    <Button size="small" type="link" icon={<CopyOutlined />} disabled={record.isSending || chromeList.length < 2} onClick={() => copyMessageToAll(record.port)} style={{ padding: 0, height: 'auto', alignSelf: 'flex-start' }}>Copy to all</Button>
                </Space>
            ),
        },
        {
            title: 'Sent / Total',
            key: 'sentProgress',
            width: 120,
            render: (_, record) => {
                const failures = record.errorLog || [];
                const total = record.assignedCount || 0;
                const processed = record.processedCount || 0;
                const progressPercent = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;
                return <Space direction="vertical" size={2} style={{ minWidth: 82 }}>
                    <span style={{ color: '#888', fontSize: 10, lineHeight: 1 }}>Sent</span>
                    <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3 }}><span style={{ color: '#52c41a' }}>{record.sentCount || 0}</span><span style={{ color: '#888' }}> / {total}</span></span>
                    <Progress percent={progressPercent} size="small" showInfo={false} strokeColor="#52c41a" trailColor="#3a3a3a" style={{ width: 82, margin: '2px 0' }} />
                    <span style={{ color: '#ff4d4f', fontSize: 12 }}>Failed: {record.failedCount || 0}</span>
                    {failures.length > 0 ? <CSVLink data={failures} headers={[{ label: 'Recipient Email', key: 'reci' }, { label: 'SMTP', key: 'smtp' }, { label: 'Error Message', key: 'error' }]} filename={`${record.email || record.port}_failed.csv`} style={{ fontSize: 11 }}>Download failed log</CSVLink> : null}
                </Space>;
            },
        },
        {
            title: 'Control',
            key: 'control',
            width: 180,
            render: (_, record) => {
                const recipientCount = browserMessages[record.port]?.recipients?.length || 0;
                const recipientFileName = browserMessages[record.port]?.recipientFileName || '';
                const attachmentJob = record.attachmentProcessing || {};
                const attachmentPercent = attachmentJob.total ? Math.round((attachmentJob.count / attachmentJob.total) * 100) : 0;
                const starting = !!startingPorts[record.port];
                return <Space direction="vertical" size={5} style={{ width: '100%' }}>
                    {attachmentJob.loading ? <div style={{ width: '100%' }}>
                        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 2 }}>Generating attachments {attachmentJob.count || 0} / {attachmentJob.total || recipientCount}</div>
                        <Progress percent={attachmentPercent} size="small" showInfo={false} status="active" />
                    </div> : null}
                    <Upload multiple accept=".csv,.xlsx,.xls" beforeUpload={(file) => loadRecipients(record.port, file)} showUploadList={false} disabled={record.isSending}>
                        <Button size="small" icon={<FileAddFilled />} disabled={record.isSending} title={recipientFileName} style={{ width: 180, display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', overflow: 'hidden' }}>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{recipientFileName || 'Load recipients'}</span>
                        </Button>
                    </Upload>
                    {recipientCount ? <div style={{ width: '100%', color: '#aaa', fontSize: 11 }}>{recipientCount} {recipientCount === 1 ? 'recipient' : 'recipients'}</div> : null}
                    {recipientCount && !record.isSending ? <Button size="small" type="text" danger onClick={() => setBrowserMessages((current) => ({ ...current, [record.port]: { ...current[record.port], recipients: [], recipientFileName: '' } }))} style={{ width: '100%' }}>Clear recipients</Button> : null}
                    {record.isSending
                        ? <Button danger size="small" icon={<StopOutlined />} onClick={() => setBrowserSending(record, false)} style={{ width: '100%' }}>Stop</Button>
                        : <Space.Compact style={{ width: '100%' }}>
                            <Button type="primary" size="small" icon={<PlayCircleOutlined />} loading={starting} disabled={record.status !== 'ready' || recipientCount === 0 || starting} onClick={() => sendFromBrowser(record)} style={{ flex: 1 }}>{starting ? 'Starting' : 'Send'}</Button>
                            <Dropdown menu={{ items: sendMoreMenuItems(record) }} trigger={['click']} disabled={record.status !== 'ready' || starting}>
                                <Button size="small" icon={<EllipsisOutlined />} />
                            </Dropdown>
                        </Space.Compact>}
                </Space>;
            },
        }];

    const renderMobileBrowserCard = (record, index) => {
        const recipientCount = browserMessages[record.port]?.recipients?.length || 0;
        const recipientFileName = browserMessages[record.port]?.recipientFileName || '';
        const attachmentJob = record.attachmentProcessing || {};
        const attachmentPercent = attachmentJob.total ? Math.round((attachmentJob.count / attachmentJob.total) * 100) : 0;
        const total = record.assignedCount || 0;
        const processed = record.processedCount || 0;
        const progressPercent = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;
        const failures = record.errorLog || [];
        const starting = !!startingPorts[record.port];

        return <section className="browser-smtp-mobile-card" key={`${record.port}-${record.pid || 'na'}`}>
            <div className="browser-smtp-mobile-header">
                <div className="browser-smtp-mobile-account">
                    <span className="browser-smtp-window-label">Window {index + 1} · {record.status || 'waiting'}</span>
                    <span className="browser-smtp-mobile-email"><span className="browser-smtp-status-dot" style={{ background: record.email ? (record.isSending ? '#44AE4E' : '#3b82f6') : '#666' }} />{record.email || 'Waiting for Gmail account'}</span>
                </div>
                <Popconfirm title="Close this Chrome window?" description="Its current sending job will also stop." okText="Close browser" okButtonProps={{ danger: true }} onConfirm={() => closeBrowser(record)}>
                    <Button danger size="small" icon={<CloseCircleOutlined />}>Close</Button>
                </Popconfirm>
            </div>

            <div className="browser-smtp-mobile-message">
                <Input size="small" placeholder="Subject Line" value={browserMessages[record.port]?.subject || ''} disabled={record.isSending} onChange={(event) => updateBrowserMessage(record.port, 'subject', event.target.value)} />
                <Input size="small" placeholder="Body HTML" value={browserMessages[record.port]?.htmlBody || ''} disabled={record.isSending} onChange={(event) => updateBrowserMessage(record.port, 'htmlBody', event.target.value)} />
                {attachmentType ? <Input size="small" placeholder="Filename (default: {{cid}})" value={browserMessages[record.port]?.filename || ''} disabled={record.isSending} onChange={(event) => updateBrowserMessage(record.port, 'filename', event.target.value)} /> : null}
                <Button size="small" type="link" icon={<CopyOutlined />} disabled={record.isSending || chromeList.length < 2} onClick={() => copyMessageToAll(record.port)} style={{ padding: 0, height: 'auto', alignSelf: 'flex-start' }}>Copy to all</Button>
            </div>

            <div className="browser-smtp-mobile-progress">
                <div>
                    <span>Sent</span>
                    <strong><b>{record.sentCount || 0}</b> / {total}</strong>
                </div>
                <div>
                    <span>Failed</span>
                    <strong className="browser-smtp-failed">{record.failedCount || 0}</strong>
                </div>
                <Progress percent={progressPercent} size="small" showInfo={false} strokeColor="#52c41a" trailColor="#3a3a3a" />
                {failures.length > 0 ? <CSVLink data={failures} headers={[{ label: 'Recipient Email', key: 'reci' }, { label: 'SMTP', key: 'smtp' }, { label: 'Error Message', key: 'error' }]} filename={`${record.email || record.port}_failed.csv`}>Download failed log</CSVLink> : null}
            </div>

            <div className="browser-smtp-mobile-control">
                {attachmentJob.loading ? <div className="browser-smtp-attachment-progress"><div>Generating attachments {attachmentJob.count || 0} / {attachmentJob.total || recipientCount}</div><Progress percent={attachmentPercent} size="small" showInfo={false} status="active" /></div> : null}
                <Upload multiple accept=".csv,.xlsx,.xls" beforeUpload={(file) => loadRecipients(record.port, file)} showUploadList={false} disabled={record.isSending}>
                    <Button block size="small" icon={<FileAddFilled />} disabled={record.isSending} title={recipientFileName}>{recipientFileName || 'Load recipients'}</Button>
                </Upload>
                {recipientCount ? <div className="browser-smtp-recipient-count">{recipientCount} {recipientCount === 1 ? 'recipient' : 'recipients'}</div> : null}
                {recipientCount && !record.isSending ? <Button block size="small" type="text" danger onClick={() => setBrowserMessages((current) => ({ ...current, [record.port]: { ...current[record.port], recipients: [], recipientFileName: '' } }))}>Clear recipients</Button> : null}
                {record.isSending
                    ? <Button block danger size="small" icon={<StopOutlined />} onClick={() => setBrowserSending(record, false)}>Stop</Button>
                    : <Space.Compact block>
                        <Button type="primary" size="small" icon={<PlayCircleOutlined />} loading={starting} disabled={record.status !== 'ready' || recipientCount === 0 || starting} onClick={() => sendFromBrowser(record)} style={{ flex: 1 }}>{starting ? 'Starting' : 'Send'}</Button>
                        <Dropdown menu={{ items: sendMoreMenuItems(record) }} trigger={['click']} disabled={record.status !== 'ready' || starting}>
                            <Button size="small" icon={<EllipsisOutlined />} />
                        </Dropdown>
                    </Space.Compact>}
            </div>
        </section>;
    };





    const sendAllFooter = () => {
        const stats = sendAllStats();
        const anySending = chromeList.some((record) => record.isSending);
        return (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space wrap style={{ width: '100%', justifyContent: 'center' }}>
                    <Upload accept=".csv,.xlsx,.xls" beforeUpload={loadAllRecipients} showUploadList={false}>
                        <Button size="small" icon={<FileAddFilled />} title={allRecipientsFileName}>{allRecipientsFileName || 'Load recipients'}</Button>
                    </Upload>
                    {allRecipients.length ? <span style={{ color: '#aaa', fontSize: 12 }}>{allRecipients.length} recipients</span> : null}
                    {allRecipients.length ? <Button size="small" type="text" danger onClick={() => { setAllRecipients([]); setAllRecipientsFileName(''); }}>Clear</Button> : null}
                    <Select size="small" value={smtpRotation || 'parallel'} onChange={setSmtpRotation} options={ROTATION_OPTIONS} style={{ width: 210 }} />
                    {anySending
                        ? <Button size="small" danger icon={<StopOutlined />} onClick={stopAllBrowsers}>Stop All</Button>
                        : <Button size="small" type="primary" icon={<ThunderboltOutlined />} loading={sendingAll} onClick={sendFromAll}>
                            {sendingAll ? 'Starting windows…' : 'Send from All'}
                        </Button>}
                </Space>
                {stats ? <div style={{ maxWidth: 420, margin: '0 auto', width: '100%' }}>
                    {stats.generatingAttachments
                        ? <>
                            <div style={{ color: '#aaa', fontSize: 12, marginBottom: 3, textAlign: 'center' }}>Generating attachments across {sendAllPorts.length} windows — {stats.attachCount} / {stats.attachTotal}</div>
                            <Progress percent={stats.attachTotal ? Math.round((stats.attachCount / stats.attachTotal) * 100) : 0} size="small" showInfo={false} status="active" />
                        </>
                        : (stats.running || stats.sent > 0 || stats.failed > 0)
                            ? <>
                                <div style={{ color: '#aaa', fontSize: 12, marginBottom: 3, textAlign: 'center' }}>Sent from all: <span style={{ color: '#52c41a', fontWeight: 600 }}>{stats.sent}</span> / {stats.assigned} · <span style={{ color: '#ff4d4f' }}>Failed: {stats.failed}</span></div>
                                <Progress percent={stats.assigned ? Math.min(100, Math.round((stats.sent + stats.failed) / stats.assigned * 100)) : 0} size="small" showInfo={false} strokeColor="#52c41a" trailColor="#3a3a3a" />
                            </>
                            : null}
                </div> : null}
            </Space>
        );
    };

    return (
        <>
            {contextHolder}

            <div className="browser-smtp-desktop" style={{ width: '100%', overflowX: 'auto' }}>
                <Table
                    pagination={false}
                    style={{ background: '#141414', borderRadius: 8, width: '100%' }}
                    dataSource={chromeList}
                    columns={columns}
                    locale={{ emptyText: <Button type="primary" icon={<PlusOutlined />} onClick={startChrome}>Add browser window</Button> }}
                    rowKey={(record) => `${record.port}-${record.pid || 'na'}`}
                    size="small"
                    scroll={{ x: 980 }}
                    footer={chromeList.length > 1 ? sendAllFooter : undefined}
                />
            </div>
            <div className="browser-smtp-mobile">
                {chromeList.length
                    ? chromeList.map(renderMobileBrowserCard)
                    : <section className="browser-smtp-mobile-empty"><Button type="primary" icon={<PlusOutlined />} onClick={startChrome}>Add browser window</Button></section>}
                {chromeList.length > 1 ? <div style={{ marginTop: 10, borderRadius: 8, background: '#141414', padding: 12 }}>{sendAllFooter()}</div> : null}
            </div>


        </>
    );
};


export default BrowserSmtp; 
            
