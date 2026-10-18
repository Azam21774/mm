'use client';
import { Input, DatePicker, Row, Col, Button, Space } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import useLocalStorage from 'use-local-storage';
import dayjs from 'dayjs';

const UpdatePdfMetadataInputs = ({ attachmentControl, fileNameControl }) => {
  const [editing, setEditing] = useState(false);
  const [meta, setMeta] = useLocalStorage('pdf-metadata', {
    title: '',
    author: '',
    subject: '',
    creator: '',
    producer: '',
    creationDate: dayjs().toISOString(),
  });

  useEffect(() => {
    if (meta.creationDate && typeof meta.creationDate === 'string') {
      setMeta((prev) => ({
        ...prev,
        creationDate: dayjs(prev.creationDate),
      }));
    }
  }, []);

  const handleChange = (field) => (e) => {
    setMeta((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleDateChange = (value) => {
    setMeta((prev) => ({ ...prev, creationDate: value }));
  };

  return (
    <div style={{ width: '100%' }}>
      <Space size={8} wrap>
        {attachmentControl}
        {fileNameControl}
        <Button size="small" icon={<EditOutlined />} onClick={() => setEditing((current) => !current)}>
          {editing ? 'Hide metadata' : 'Edit metadata'}
        </Button>
      </Space>
      {editing ? <div style={{ marginTop: 8 }}>
      <Row gutter={[8, 6]}>
        <Col span={12}>
          <Input
            size="small"
            value={meta.title}
            onChange={handleChange('title')}
            placeholder="Title: e.g. Invoice for John Doe"
          />
        </Col>
        <Col span={12}>
          <Input
            size="small"
            value={meta.author}
            onChange={handleChange('author')}
            placeholder="Author: e.g. MyMail App"
          />
        </Col>
      </Row>
      <Row gutter={[8, 6]} style={{ marginTop: 6 }}>
        <Col span={12}>
          <Input
            size="small"
            value={meta.subject}
            onChange={handleChange('subject')}
            placeholder="Subject: e.g. Monthly Billing"
          />
        </Col>
        <Col span={12}>
          <Input
            size="small"
            value={meta.creator}
            onChange={handleChange('creator')}
            placeholder="Creator: e.g. MyMail Generator"
          />
        </Col>
      </Row>
      <Row gutter={[8, 6]} style={{ marginTop: 6 }}>
        <Col span={12}>
          <Input
            size="small"
            value={meta.producer}
            onChange={handleChange('producer')}
            placeholder="Producer: e.g. MyMail PDF Engine"
          />
        </Col>
        <Col span={12}>
          <DatePicker
            showTime
            size="small"
            value={dayjs(meta.creationDate)}
            onChange={handleDateChange}
            style={{ width: '100%' }}
            placeholder="Creation Date"
          />
        </Col>
      </Row>
      </div> : null}
    </div>
  );
};

export default UpdatePdfMetadataInputs;
