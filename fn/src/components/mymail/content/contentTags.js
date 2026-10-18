'use client';

import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CloseCircleOutlined, EditOutlined, EyeOutlined, FileAddFilled } from '@ant-design/icons';
import { Button, Card, Checkbox, Input, message, Modal, Popconfirm, Radio, Select, Space, Table, Tabs, Tag, Tooltip, Typography, Upload } from 'antd';
import * as clipboard from 'clipboard-polyfill';
import * as XLSX from 'xlsx';
import useLocalStorage from 'use-local-storage';
import { Context } from '../../../context/mymailContext';

const { Text, Paragraph } = Typography;
const DEFAULT_RANDOM = { name: '', size: 10, number: true, alphabets: true, capital: true };
const tabForType = { id: 'idtag', list: 'listtag', value: 'valuetag' };
const token = (name) => `{{${name}}}`;
const normalizeTagName = (name) => String(name || '').replace(/[{}]/g, '').trim();
const tagStyle = { display: 'inline-flex', alignItems: 'center', minHeight: 28, marginInlineEnd: 0, padding: '0 9px', gap: 7, borderRadius: 6, borderColor: '#595959', background: '#1d1d1d' };
const tagTextStyle = { cursor: 'pointer', color: '#f0f0f0', fontSize: 13, fontWeight: 500, lineHeight: '26px', whiteSpace: 'nowrap' };

function randomPreview(tag) {
  const chars = `${tag.alphabets ? 'abcdefghijklmnopqrstuvwxyz' : ''}${tag.capital ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : ''}${tag.number ? '0123456789' : ''}`;
  if (!chars) return '';
  const bytes = new Uint32Array(tag.size || 10);
  globalThis.crypto?.getRandomValues(bytes);
  return Array.from(bytes, (value) => chars[value % chars.length]).join('');
}

export default function ContentTags({ customTags, setCustomTags }) {
  const { tfnValue, setTfnValue } = useContext(Context);
  const baseTags = useMemo(() => ['email', 'name', 'c3', 'c4', 'c5', 'c6', 'date', 'tfn'], []);
  const [serverTags, setServerTags] = useLocalStorage('serverTags', []);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewValue, setPreviewValue] = useState('');
  const [activeTab, setActiveTab] = useState('idtag');
  const [config, setConfig] = useState(DEFAULT_RANDOM);
  const [value, setValue] = useState('');
  const [items, setItems] = useState([]);
  const [listMode, setListMode] = useState('sequential');
  const nameRef = useRef(null);

  const sync = (tags) => {
    setServerTags(tags);
    setCustomTags(tags.filter((tag) => tag.type === 'id'));
  };

  useEffect(() => { if (open) nameRef.current?.focus(); }, [open]);

  const reset = () => {
    setEditing(null); setConfig(DEFAULT_RANDOM); setValue(''); setItems([]); setListMode('sequential');
  };
  const close = () => { setOpen(false); reset(); };
  const create = () => { reset(); setActiveTab('idtag'); setOpen(true); };
  const edit = (tag) => {
    setEditing(tag); setActiveTab(tabForType[tag.type]);
    setConfig(tag.type === 'id' ? { ...DEFAULT_RANDOM, ...tag, size: Math.min(20, Math.max(1, tag.size || 10)) } : { ...DEFAULT_RANDOM, name: tag.name });
    setValue(tag.type === 'value' ? tag.value : '');
    setItems(tag.type === 'list' ? tag.items || [] : []);
    setListMode(tag.type === 'list' ? tag.mode || 'sequential' : 'sequential'); setOpen(true);
  };

  const copy = async (text) => {
    try { await clipboard.writeText(text); message.success(`Copied: ${text}`); }
    catch { message.error('Copy failed'); }
  };
  const formPayload = () => {
    const name = normalizeTagName(config.name); const enabled = editing?.enabled !== false;
    if (activeTab === 'idtag') return { type: 'id', name, size: config.size, number: config.number, alphabets: config.alphabets, capital: config.capital, enabled };
    if (activeTab === 'listtag') return { type: 'list', name, mode: listMode, items, enabled };
    return { type: 'value', name, value: value.trim(), enabled };
  };

  const save = () => {
    const payload = formPayload();

    if (!payload.name) return message.error('Please enter a tag name');

    if (
      serverTags.some(
        (tag) =>
          tag._id !== editing?._id &&
          tag.name.toLowerCase() === payload.name.toLowerCase()
      ) ||
      baseTags.includes(payload.name.toLowerCase())
    ) {
      return message.warning('Tag name already exists');
    }

    if (payload.type === 'id' && !payload.number && !payload.alphabets && !payload.capital) {
      return message.error('Select at least one Random Tag character set');
    }

    if (payload.type === 'list' && !payload.items.length) {
      return message.error('Select a CSV, TXT, or Excel list first');
    }

    if (payload.type === 'value' && !payload.value) {
      return message.error('Please enter a tag value');
    }

    const savedTag = {
      ...payload,
      _id: editing?._id || (
        globalThis.crypto?.randomUUID?.() ||
        `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
      ),
    };

    sync(
      editing
        ? serverTags.map((tag) => tag._id === editing._id ? savedTag : tag)
        : [...serverTags, savedTag]
    );

    message.success(editing ? 'Tag updated locally' : 'Tag created locally');
    close();
  };

  const remove = (tag) => {
    sync(serverTags.filter((item) => item._id !== tag._id));
    message.success('Tag deleted locally');
  };

  const showPreview = (tag) => { setPreview(tag); setPreviewValue(tag.type === 'id' ? randomPreview(tag) : tag.type === 'value' ? tag.value : ''); };
  const loadFile = (file) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const book = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
      setItems(rows.filter((row) => row[0] !== undefined && row[0] !== null && String(row[0]).trim()));
    };
    reader.readAsArrayBuffer(file); return false;
  };

  const actions = (tag) => <Space size={7} onClick={(event) => event.stopPropagation()} style={{ fontSize: 13, lineHeight: 1 }}>
    <Tooltip title="Preview"><EyeOutlined style={{ cursor: 'pointer' }} onClick={() => showPreview(tag)} /></Tooltip>
    <Tooltip title="Edit"><EditOutlined style={{ cursor: 'pointer' }} onClick={() => edit(tag)} /></Tooltip>
    <Popconfirm title={`Delete ${token(tag.name)}?`} okText="Delete" onConfirm={() => remove(tag)}><CloseCircleOutlined style={{ cursor: 'pointer' }} /></Popconfirm>
  </Space>;
  const tfnControl = <Space.Compact className="tfn-tag-control">
    <Tag style={tagStyle}><Text style={tagTextStyle} onClick={() => copy(token('tfn'))}>{token('tfn')}</Text></Tag>
    <Input size="small" value={tfnValue || ''} onChange={(event) => setTfnValue(event.target.value)} placeholder="TFN value" style={{ width: 210, height: 28 }} />
  </Space.Compact>;

  return <div>
    <Modal open={open} title={editing ? 'Edit tag' : 'Create tag'} onCancel={close} width={620} destroyOnClose
      footer={<Space.Compact><Input ref={nameRef} value={config.name} onChange={(event) => setConfig((old) => ({ ...old, name: normalizeTagName(event.target.value) }))} placeholder="Tag name" addonBefore="{{" addonAfter="}}" maxLength={80} style={{ width: 300 }} /><Button type="primary" onClick={save}>{editing ? 'Save' : 'Create'}</Button></Space.Compact>}>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        { key: 'valuetag', label: 'Value tags', children: <Input.TextArea rows={4} placeholder="Tag value" value={value} onChange={(event) => setValue(event.target.value)} /> },
        { key: 'idtag', label: 'Random Tag', children: <Space wrap><Space.Compact><Button size="middle" disabled style={{ color: 'rgba(255,255,255,.85)', cursor: 'default' }}>Tag length</Button><Select value={config.size} onChange={(size) => setConfig((old) => ({ ...old, size }))} style={{ width: 76 }} options={Array.from({ length: 20 }, (_, index) => ({ value: index + 1, label: index + 1 }))} /></Space.Compact>
          <Checkbox checked={config.capital} onChange={(event) => setConfig((old) => ({ ...old, capital: event.target.checked }))}>(A–Z)</Checkbox><Checkbox checked={config.alphabets} onChange={(event) => setConfig((old) => ({ ...old, alphabets: event.target.checked }))}>(a–z)</Checkbox><Checkbox checked={config.number} onChange={(event) => setConfig((old) => ({ ...old, number: event.target.checked }))}>(0–9)</Checkbox></Space> },
        { key: 'listtag', label: 'List / Files Tags', children: <Space direction="vertical"><Space><Upload accept=".csv,.txt,.xlsx,.xls" beforeUpload={loadFile} showUploadList={false}><Button icon={<FileAddFilled />}>Select list file</Button></Upload><Radio.Group value={listMode} onChange={(event) => setListMode(event.target.value)} optionType="button" options={[{ label: 'Sequential', value: 'sequential' }, { label: 'Random', value: 'random' }, { label: 'Shuffle', value: 'shuffle' }]} /></Space><Text type="secondary">{items.length ? `${items.length} items loaded` : 'No list loaded'}</Text></Space> },
      ]} />
    </Modal>
    <Modal open={!!preview} title={preview ? `${token(preview.name)} preview` : 'Preview'} footer={null} onCancel={() => setPreview(null)}>
      {preview?.type === 'id' && <Space direction="vertical" style={{ width: '100%' }}><Paragraph copyable code>{previewValue}</Paragraph><Button onClick={() => setPreviewValue(randomPreview(preview))}>Generate another</Button></Space>}
      {preview?.type === 'value' && <Paragraph copyable style={{ whiteSpace: 'pre-wrap' }}>{previewValue}</Paragraph>}
      {preview?.type === 'list' && <Table size="small" rowKey={(_, index) => index} pagination={{ pageSize: 8 }} columns={[{ title: '#', width: 55, render: (_, __, index) => index + 1 }, { title: 'Content', render: (_, row) => row.join(' , ') }]} dataSource={preview.items || []} />}
    </Modal>
    <Card styles={{ header: { minHeight: 44, paddingInline: 16 }, body: { padding: '12px 14px' } }} size="small" title="Tags" extra={tfnControl} loading={loading} style={{ width: '100%' }}>
      <div style={{ display: 'grid', gap: 8, width: '100%' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {baseTags.filter((name) => name !== 'tfn').map((name) => <Tag key={name} style={tagStyle}><Text style={tagTextStyle} onClick={() => copy(token(name))}>{token(name)}</Text></Tag>)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {serverTags.map((tag) => <Tag key={tag._id} style={tagStyle}><Text style={tagTextStyle} onClick={() => copy(token(tag.name))}>{token(tag.name)}</Text>{actions(tag)}</Tag>)}
          <Button size="small" type="primary" onClick={create} style={{ height: 28, paddingInline: 12, borderRadius: 6 }}>Create +</Button>
        </div>
      </div>
    </Card>
  </div>;
}
