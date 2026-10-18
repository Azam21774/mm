'use client';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { Button, Input, message, Popconfirm, Progress, Select, Space, Table, Upload } from 'antd';
import { CSVLink } from 'react-csv';
import { uid } from 'uid';
import * as XLSX from 'xlsx';
import { backend } from '../desktopBackend';
import { CopyOutlined, DeleteOutlined, FileAddFilled, PlayCircleOutlined, StopOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Context } from '../context/mymailContext';

const emptyRow = () => ({
    senderName: '',
    subject: '',
    htmlBody: '',
    filename: '',
    recipients: [],
    recipientFileName: '',
    isSending: false,
    sentCount: 0,
    processedCount: 0,
    failedCount: 0,
    assignedCount: 0,
    errorLog: [],
    jobId: null,
    // Attachment generation and account verification both happen before the first
    // recipient is actually sent, so without this the row just spins with 0/0 and
    // looks stuck for however long that takes.
    stage: null, // 'attachments' | 'connecting' | null
    attachmentProgress: null, // { count, total }
});

// Same table layout as the Browser SMTP window list (status / message / sent-total /
// control per row), but one row per App Password or Gmail API account so each account
// can send its own recipient list independently instead of only as a pooled rotation.
const shiftIndexedState = (current, removedIndex) => {
    const next = {};
    Object.keys(current).forEach((key) => {
        const i = Number(key);
        if (i === removedIndex) return;
        next[i > removedIndex ? i - 1 : i] = current[key];
    });
    return next;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Same rotation strategies the backend supports for a multi-SMTP job (utils/listRotator.js),
// reused here client-side to decide the order accounts are started in for "Send from All".
const ROTATION_OPTIONS = [
    { value: 'parallel', label: 'Parallel (start all at once)' },
    { value: 'sequential', label: 'Sequential (in order)' },
    { value: 'random', label: 'Random' },
    { value: 'shuffle', label: 'Shuffle' },
];

// Orders eligible account indexes to start according to the chosen rotation strategy.
// Every account is started exactly once either way - "random" and "shuffle" both give a
// randomized order, just via different picks, matching the backend's own strategy names.
const orderForRotation = (indexes, strategy) => {
    if (strategy === 'sequential' || strategy === 'parallel') return indexes;
    const pool = [...indexes];
    const ordered = [];
    while (pool.length) ordered.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return ordered;
};

// Splits the shared recipient pool into `parts` near-equal, non-overlapping chunks (round
// robin) so accounts borrowing from it each send to their own slice instead of everyone
// sending to the whole pool.
const splitEvenly = (list, parts) => {
    const chunks = Array.from({ length: Math.max(parts, 1) }, () => []);
    list.forEach((item, i) => chunks[i % chunks.length].push(item));
    return chunks;
};

const DirectSendTable = ({ method }) => {
    const { backendReady, handleDirectSend, smtp, setSmtp, apiAccounts, setApiAccounts, attachmentType, delay, smtpRotation, setSmtpRotation } = useContext(Context);
    const [messageApi, contextHolder] = message.useMessage();
    const [rows, setRows] = useState({});
    // Real connectivity per account, checked against /verify-account: 'checking' | 'ok' | 'fail' | 'none'.
    const [verifyStatus, setVerifyStatus] = useState({});
    const [sendingAll, setSendingAll] = useState(false);
    // The account indexes started by the most recent "Send from All" run, so the footer
    // can show one combined attachment/sending progress bar across all of them.
    const [sendAllIndexes, setSendAllIndexes] = useState([]);
    // Shared fallback list for "Send from All": any account that has no recipient file
    // of its own loaded uses this one instead, so you don't have to load a file per account.
    const [allRecipients, setAllRecipients] = useState([]);
    const [allRecipientsFileName, setAllRecipientsFileName] = useState('');
    // Indexes currently starting a send, checked synchronously (a ref, not state) so a
    // double-click can't slip a second send through in the instant before React re-renders
    // the button as loading/disabled.
    const startingRef = useRef(new Set());
    // Guards "Send from All" itself: sendingAll (state) only disables the button after
    // React re-renders, so a click fired in the same tick as the first would still slip
    // through the button's own onClick; this ref closes that gap synchronously.
    const sendingAllRef = useRef(false);

    const accounts = method === 'APPPASS' ? smtp : apiAccounts;
    const setAccounts = method === 'APPPASS' ? setSmtp : setApiAccounts;
    const methodLabel = method === 'APPPASS' ? 'App Password' : 'Gmail API';

    const getEmail = (account) => (method === 'APPPASS' ? account?.auth?.user : account?.user);
    const isReady = (account) => !!getEmail(account);
    const getRow = (index) => rows[index] || emptyRow();

    const updateRow = (index, patch) => {
        setRows((current) => ({ ...current, [index]: { ...(current[index] || emptyRow()), ...patch } }));
    };

    // Copies this row's Sender Name/Subject/Body/Filename onto every other row, so
    // you don't have to retype the same message per account.
    const copyToAll = (index) => {
        const source = getRow(index);
        setRows((current) => {
            const next = { ...current };
            accounts.forEach((_, i) => {
                if (i === index) return;
                next[i] = {
                    ...(current[i] || emptyRow()),
                    senderName: source.senderName,
                    subject: source.subject,
                    htmlBody: source.htmlBody,
                    filename: source.filename,
                };
            });
            return next;
        });
        messageApi.success('Copied to all accounts.');
    };

    const removeAccount = (index) => {
        setAccounts((prev) => prev.filter((_, i) => i !== index));
        setRows((current) => shiftIndexedState(current, index));
        setVerifyStatus((current) => shiftIndexedState(current, index));
    };

    const clearAll = () => {
        setAccounts([]);
        setRows({});
        setVerifyStatus({});
    };

    // Actually test each account (SMTP verify / OAuth token refresh) rather than just
    // checking that credentials are present, so the dot reflects whether it truly works.
    useEffect(() => {
        if (!backendReady || accounts.length === 0) return undefined;
        let cancelled = false;

        setVerifyStatus((current) => {
            const next = { ...current };
            accounts.forEach((account, index) => {
                next[index] = isReady(account) ? 'checking' : 'none';
            });
            return next;
        });

        Promise.all(accounts.map(async (account, index) => {
            if (!isReady(account)) return [index, 'none'];
            try {
                const payload = method === 'APPPASS'
                    ? { smtpType: 'APPPASS', smtp: account }
                    : { smtpType: 'API_HTTP', apiAccount: account };
                const res = await backend.verifyAccount(payload);
                return [index, res?.data?.status ? 'ok' : 'fail'];
            } catch {
                return [index, 'fail'];
            }
        })).then((results) => {
            if (cancelled) return;
            setVerifyStatus((current) => {
                const next = { ...current };
                results.forEach(([index, state]) => { next[index] = state; });
                return next;
            });
        });

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendReady, method, JSON.stringify(accounts)]);

    useEffect(() => {
        if (!backendReady) return undefined;
        const subscriptions = backend.subscriptions();

        const findRowIndexByJobId = (current, jobId) => Object.keys(current).find((key) => current[key]?.jobId === jobId);

        subscriptions.on('attachment', ({ jobId, count, total, loading }) => {
            if (!jobId) return;
            setRows((current) => {
                const index = findRowIndexByJobId(current, jobId);
                if (index === undefined) return current;
                return {
                    ...current,
                    [index]: {
                        ...current[index],
                        stage: loading ? 'attachments' : 'connecting',
                        attachmentProgress: { count, total },
                    },
                };
            });
        });

        subscriptions.on('smtp', ({ jobId }) => {
            if (!jobId) return;
            setRows((current) => {
                const index = findRowIndexByJobId(current, jobId);
                if (index === undefined) return current;
                return { ...current, [index]: { ...current[index], stage: 'sending' } };
            });
        });

        subscriptions.on('count', ({ jobId, processCount, errorCount, listLength }) => {
            if (!jobId) return;
            setRows((current) => {
                const index = findRowIndexByJobId(current, jobId);
                if (index === undefined) return current;
                return {
                    ...current,
                    [index]: {
                        ...current[index],
                        stage: 'sending',
                        processedCount: processCount,
                        failedCount: errorCount,
                        sentCount: processCount - errorCount,
                        isSending: processCount < listLength,
                    },
                };
            });
        });

        subscriptions.on('errorlog', ({ jobId, error, reci, smtp: smtpUser }) => {
            if (!jobId) return;
            setRows((current) => {
                const index = findRowIndexByJobId(current, jobId);
                if (index === undefined) return current;
                const row = current[index];
                return { ...current, [index]: { ...row, errorLog: [...row.errorLog, { reci, smtp: smtpUser, error }] } };
            });
        });

        return () => subscriptions.dispose();
    }, [backendReady]);

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

    const loadRecipients = (index, file) => parseRecipientFile(file, (recipients) => {
        updateRow(index, {
            recipients: [...getRow(index).recipients, ...recipients],
            recipientFileName: file.name,
        });
    });

    // Fallback list for "Send from All": accounts with no recipient file of their own
    // borrow from this one, so you don't have to load a file per account.
    const loadAllRecipients = (file) => parseRecipientFile(file, (recipients) => {
        setAllRecipients((current) => [...current, ...recipients]);
        setAllRecipientsFileName(file.name);
    });

    // recipientsOverride lets "Send from All" send this account's own list when it has
    // one, or fall back to the shared allRecipients list when it doesn't.
    const sendFromAccount = async (index, recipientsOverride) => {
        // Checked synchronously against a ref (not the row's isSending state) so a second
        // click fired before React re-renders the button as loading can't start a duplicate job.
        if (startingRef.current.has(index) || getRow(index).isSending) return;

        const account = accounts[index];
        const row = getRow(index);
        const recipients = recipientsOverride || row.recipients;

        if (!recipients.length) { messageApi.error('Load recipients before sending.'); return; }
        if (!isReady(account)) { messageApi.error('This account is not connected yet.'); return; }

        startingRef.current.add(index);
        const jobId = `${method}-${index}-${Date.now()}`;
        updateRow(index, {
            isSending: true,
            sentCount: 0,
            processedCount: 0,
            failedCount: 0,
            assignedCount: recipients.length,
            errorLog: [],
            jobId,
            stage: 'connecting',
            attachmentProgress: null,
        });

        try {
            const overrides = {
                recipients,
                senderName: row.senderName,
                subject: row.subject,
                htmlBody: row.htmlBody,
                filename: row.filename,
                jobId,
            };
            if (method === 'APPPASS') overrides.smtps = [account];
            if (method === 'API_HTTP') overrides.apiAccounts = [account];

            const res = await handleDirectSend(method, overrides);
            if (!res?.data?.status) {
                messageApi.error(res?.data?.msg || 'Send failed');
                updateRow(index, { isSending: false });
            }
        } catch (err) {
            messageApi.error(err.message || 'Send failed');
            updateRow(index, { isSending: false });
        } finally {
            startingRef.current.delete(index);
        }
    };

    const stopFromAccount = async (index) => {
        const row = getRow(index);
        if (!row.jobId) return;
        try {
            await backend.stopJob(row.jobId);
        } catch (err) {
            messageApi.error(err.response?.data?.msg || 'Unable to stop sending.');
        }
    };

    // Stops every account currently sending in this table (whether started by an
    // individual Send click or by "Send from All"), so the footer button doubles as a
    // one-click "Stop All" the moment anything here is in flight.
    const stopAll = async () => {
        const sendingIndexes = accounts.map((_, index) => index).filter((index) => getRow(index).isSending);
        await Promise.all(sendingIndexes.map((index) => stopFromAccount(index)));
    };

    // Loops through every connected account and starts each one's own send job in turn
    // (order set by the rotation type), waiting the configured send delay before starting
    // the next account - "parallel" starts them all together with no wait between starts.
    // An account with its own recipient file keeps using it; accounts with no file of their
    // own split the shared allRecipients pool between them (each gets its own slice, not
    // the whole pool), so the same recipients aren't sent to - and attachments generated for -
    // every account.
    const sendFromAll = async () => {
        // Checked synchronously so a double-click on "Send from All" can't start two runs
        // in the instant before React re-renders the button as loading.
        if (sendingAllRef.current) return;

        const eligibleIndexes = accounts
            .map((_, index) => index)
            .filter((index) => verifyStatus[index] === 'ok' && !getRow(index).isSending && (getRow(index).recipients.length > 0 || allRecipients.length > 0));

        if (eligibleIndexes.length < 2) {
            messageApi.error('Load recipients (per account, or a shared file below) on at least two connected accounts before sending from all.');
            return;
        }

        const poolIndexes = eligibleIndexes.filter((index) => !getRow(index).recipients.length);
        const poolChunks = splitEvenly(allRecipients, poolIndexes.length);
        const poolAssignment = {};
        poolIndexes.forEach((index, i) => { poolAssignment[index] = poolChunks[i]; });

        // Drop pool-sharing accounts that ended up with an empty slice (more accounts than recipients).
        const sendableIndexes = eligibleIndexes.filter((index) => getRow(index).recipients.length > 0 || poolAssignment[index]?.length > 0);
        if (sendableIndexes.length < 2) {
            messageApi.error('Not enough recipients to split across the connected accounts.');
            return;
        }

        const strategy = smtpRotation || 'parallel';
        const order = orderForRotation(sendableIndexes, strategy);
        const pauseMs = strategy === 'parallel' ? 0 : Number(delay) || 0;

        sendingAllRef.current = true;
        setSendingAll(true);
        setSendAllIndexes(sendableIndexes);
        try {
            for (let i = 0; i < order.length; i += 1) {
                const index = order[i];
                sendFromAccount(index, getRow(index).recipients.length ? undefined : poolAssignment[index]);
                if (pauseMs && i < order.length - 1) await sleep(pauseMs);
            }
        } finally {
            sendingAllRef.current = false;
            setSendingAll(false);
        }
    };

    // Combined attachment-generation/sending progress across every account started by the
    // last "Send from All" run, so the footer can show one status instead of making you
    // check each row - mirrors the per-row "Sent / Total" cell logic, just summed up.
    const sendAllStats = () => {
        if (!sendAllIndexes.length) return null;
        let attachCount = 0;
        let attachTotal = 0;
        let generatingAttachments = false;
        let assigned = 0;
        let sent = 0;
        let failed = 0;
        let running = false;
        sendAllIndexes.forEach((index) => {
            const row = getRow(index);
            assigned += row.assignedCount || 0;
            sent += row.sentCount || 0;
            failed += row.failedCount || 0;
            if (row.isSending) running = true;
            if (row.isSending && row.stage === 'attachments') {
                generatingAttachments = true;
                attachCount += row.attachmentProgress?.count || 0;
                attachTotal += row.attachmentProgress?.total || row.assignedCount || 0;
            }
        });
        return { generatingAttachments, attachCount, attachTotal, assigned, sent, failed, running };
    };

    const columns = [
        {
            title: '#',
            key: 'serialNo',
            width: 50,
            render: (_, __, index) => index + 1,
        },
        {
            title: 'Status',
            key: 'status',
            width: 70,
            render: (_, record, index) => {
                const state = verifyStatus[index] || (isReady(record) ? 'checking' : 'none');
                const color = { ok: '#44AE4E', fail: '#ff4d4f', checking: '#faad14', none: '#666' }[state];
                const title = { ok: 'Working', fail: 'Not working', checking: 'Checking…', none: 'Not connected' }[state];
                return <span title={title} style={{ width: 7, height: 7, display: 'inline-block', borderRadius: '50%', background: color }} />;
            },
        },
        {
            title: 'Message',
            key: 'message',
            width: 420,
            render: (_, record, index) => {
                const row = getRow(index);
                return (
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <span style={{ color: '#aaa', fontSize: 12 }}>{getEmail(record) || 'Not connected'}</span>
                        <Input size="small" placeholder="Sender Name (blank = account default)" value={row.senderName} disabled={row.isSending} onChange={(e) => updateRow(index, { senderName: e.target.value })} />
                        <Input size="small" placeholder="Subject Line" value={row.subject} disabled={row.isSending} onChange={(e) => updateRow(index, { subject: e.target.value })} />
                        <Input size="small" placeholder="Body HTML" value={row.htmlBody} disabled={row.isSending} onChange={(e) => updateRow(index, { htmlBody: e.target.value })} />
                        {attachmentType ? <Input size="small" placeholder="Filename (default: {{cid}})" value={row.filename} disabled={row.isSending} onChange={(e) => updateRow(index, { filename: e.target.value })} /> : null}
                        <Button size="small" type="link" icon={<CopyOutlined />} disabled={row.isSending || accounts.length < 2} onClick={() => copyToAll(index)} style={{ padding: 0, height: 'auto', alignSelf: 'flex-start' }}>Copy to all</Button>
                    </Space>
                );
            },
        },
        {
            title: 'Sent / Total',
            key: 'sentProgress',
            width: 120,
            render: (_, record, index) => {
                const row = getRow(index);
                const percent = row.assignedCount ? Math.min(100, Math.round((row.processedCount / row.assignedCount) * 100)) : 0;

                if (row.isSending && row.stage === 'attachments') {
                    const ap = row.attachmentProgress || { count: 0, total: row.assignedCount };
                    return (
                        <Space direction="vertical" size={2} style={{ minWidth: 82 }}>
                            <span style={{ color: '#aaa', fontSize: 11 }}>Generating attachments</span>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{ap.count} / {ap.total}</span>
                            <Progress percent={ap.total ? Math.round((ap.count / ap.total) * 100) : 0} size="small" showInfo={false} status="active" style={{ width: 82, margin: '2px 0' }} />
                        </Space>
                    );
                }

                if (row.isSending && row.stage === 'connecting') {
                    return <span style={{ color: '#aaa', fontSize: 12 }}>Connecting to account…</span>;
                }

                return (
                    <Space direction="vertical" size={2} style={{ minWidth: 82 }}>
                        <span style={{ color: '#888', fontSize: 10, lineHeight: 1 }}>Sent</span>
                        <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3 }}><span style={{ color: '#52c41a' }}>{row.sentCount}</span><span style={{ color: '#888' }}> / {row.assignedCount}</span></span>
                        <Progress percent={percent} size="small" showInfo={false} strokeColor="#52c41a" trailColor="#3a3a3a" style={{ width: 82, margin: '2px 0' }} />
                        <span style={{ color: '#ff4d4f', fontSize: 12 }}>Failed: {row.failedCount}</span>
                        {row.errorLog.length > 0 ? <CSVLink data={row.errorLog} headers={[{ label: 'Recipient Email', key: 'reci' }, { label: 'SMTP', key: 'smtp' }, { label: 'Error Message', key: 'error' }]} filename={`${getEmail(record) || index}_failed.csv`} style={{ fontSize: 11 }}>Download failed log</CSVLink> : null}
                    </Space>
                );
            },
        },
        {
            title: 'Control',
            key: 'control',
            width: 190,
            render: (_, record, index) => {
                const row = getRow(index);
                return (
                    <Space direction="vertical" size={5} style={{ width: '100%' }}>
                        <Upload multiple accept=".csv,.xlsx,.xls" beforeUpload={(file) => loadRecipients(index, file)} showUploadList={false} disabled={row.isSending}>
                            <Button size="small" icon={<FileAddFilled />} disabled={row.isSending} title={row.recipientFileName} style={{ width: 180, display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', overflow: 'hidden' }}>
                                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.recipientFileName || 'Load recipients'}</span>
                            </Button>
                        </Upload>
                        {row.recipients.length ? <div style={{ width: '100%', color: '#aaa', fontSize: 11 }}>{row.recipients.length} recipients</div> : null}
                        {row.recipients.length && !row.isSending ? <Button size="small" type="text" danger onClick={() => updateRow(index, { recipients: [], recipientFileName: '' })} style={{ width: '100%' }}>Clear recipients</Button> : null}
                        {row.isSending
                            ? <Button danger size="small" icon={<StopOutlined />} onClick={() => stopFromAccount(index)} style={{ width: '100%' }}>Stop</Button>
                            : <Button type="primary" size="small" icon={<PlayCircleOutlined />} disabled={verifyStatus[index] !== 'ok' || row.recipients.length === 0} onClick={() => sendFromAccount(index)} style={{ width: '100%' }}>Send</Button>}
                    </Space>
                );
            },
        },
        {
            title: '',
            key: 'remove',
            width: 40,
            render: (_, record, index) => {
                const row = getRow(index);
                return (
                    <Popconfirm title="Remove this account?" okText="Remove" okButtonProps={{ danger: true }} disabled={row.isSending} onConfirm={() => removeAccount(index)}>
                        <Button size="small" danger disabled={row.isSending} icon={<DeleteOutlined />} />
                    </Popconfirm>
                );
            },
        },
    ];

    const sendAllFooter = () => {
        const stats = sendAllStats();
        const anySending = accounts.some((_, index) => getRow(index).isSending);
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
                        ? <Button size="small" danger icon={<StopOutlined />} onClick={stopAll}>Stop All</Button>
                        : <Button size="small" type="primary" icon={<ThunderboltOutlined />} loading={sendingAll} onClick={sendFromAll}>
                            {sendingAll ? 'Starting accounts…' : 'Send from All'}
                        </Button>}
                </Space>
                {stats ? <div style={{ maxWidth: 420, margin: '0 auto', width: '100%' }}>
                    {stats.generatingAttachments
                        ? <>
                            <div style={{ color: '#aaa', fontSize: 12, marginBottom: 3, textAlign: 'center' }}>Generating attachments across {sendAllIndexes.length} accounts — {stats.attachCount} / {stats.attachTotal}</div>
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
            <Space style={{ marginBottom: 8 }} wrap>
                <Popconfirm title={`Remove all ${methodLabel} accounts?`} okText="Clear all" okButtonProps={{ danger: true }} disabled={accounts.length === 0} onConfirm={clearAll}>
                    <Button size="small" danger disabled={accounts.length === 0}>Clear All</Button>
                </Popconfirm>
            </Space>
            <Table
                pagination={false}
                style={{ background: '#141414', borderRadius: 8, width: '100%' }}
                dataSource={accounts.map((account, index) => ({ ...account, key: index }))}
                columns={columns}
                locale={{ emptyText: `No ${methodLabel} accounts added yet.` }}
                size="small"
                scroll={{ x: 900 }}
                footer={accounts.length > 1 ? sendAllFooter : undefined}
            />
        </>
    );
};

export default DirectSendTable;
