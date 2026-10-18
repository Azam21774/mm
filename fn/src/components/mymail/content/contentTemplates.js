'use client';

import React, { useContext, useEffect, useRef, useState } from 'react';
import { Card, message, Modal, Popconfirm, Space, Tag, Tooltip, Typography } from 'antd';
import { CloseCircleOutlined, CopyOutlined, EyeOutlined } from '@ant-design/icons';
import * as clipboard from 'clipboard-polyfill';
import useLocalStorage from 'use-local-storage';

const { Text } = Typography;
const tagStyle = { display: 'inline-flex', alignItems: 'center', minHeight: 28, marginInlineEnd: 0, padding: '0 9px', gap: 7, borderRadius: 6, borderColor: '#595959', background: '#1d1d1d' };
const tagTextStyle = { cursor: 'pointer', color: '#f0f0f0', fontSize: 13, fontWeight: 500, lineHeight: '26px', whiteSpace: 'nowrap' };

export default function ContentTemplates() {
  const [serverTemplates, setServerTemplates] = useLocalStorage('serverTemplates', []);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);

  const remove = async (template) => {
    setServerTemplates((current) =>
      current.filter((item) => item.id !== template.id)
    );
    setPreview((current) => current?.id === template.id ? null : current);
    message.success('Template deleted locally');
  };

  const copyHtml = async (template) => {
    try { await clipboard.writeText(template.html || ''); message.success(`Copied "${template.name}" HTML`); }
    catch { message.error('Copy failed'); }
  };

  const actions = (template) => <Space size={7} onClick={(event) => event.stopPropagation()} style={{ fontSize: 13, lineHeight: 1 }}>
    <Tooltip title="Preview"><EyeOutlined style={{ cursor: 'pointer' }} onClick={() => setPreview(template)} /></Tooltip>
    <Tooltip title="Copy HTML"><CopyOutlined style={{ cursor: 'pointer' }} onClick={() => copyHtml(template)} /></Tooltip>
    <Popconfirm title={`Delete "${template.name}"?`} okText="Delete" onConfirm={() => remove(template)}><CloseCircleOutlined style={{ cursor: 'pointer' }} /></Popconfirm>
  </Space>;

  return <div>
    <Modal open={!!preview} title={preview?.name} footer={null} onCancel={() => setPreview(null)} width={720} destroyOnClose>
      <iframe title="Template preview" srcDoc={preview?.html || ''} sandbox="" style={{ width: '100%', height: 420, border: '1px solid #303030', borderRadius: 6, background: '#fff' }} />
    </Modal>
    <Card styles={{ header: { minHeight: 44, paddingInline: 16 }, body: { padding: '12px 14px' } }} size="small" title="Templates" loading={loading} style={{ width: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {serverTemplates.length
          ? serverTemplates.map((template) => <Tag key={template.id} style={tagStyle}><Text style={tagTextStyle} onClick={() => copyHtml(template)}>{template.name}</Text>{actions(template)}</Tag>)
          : <Text type="secondary">No saved templates yet</Text>}
      </div>
    </Card>
  </div>;
}
