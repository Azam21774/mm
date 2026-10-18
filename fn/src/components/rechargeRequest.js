// components/RechargeRequest.jsx
import React, { useState } from 'react';
import { Button, Modal, Form, InputNumber, Upload, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';

const RechargeRequest = () => {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fileList, setFileList] = useState([]);

  const [form] = Form.useForm();

  const handleSubmit = async (values) => {
    if (fileList.length === 0) {
      message.error('Please attach a screenshot');
      return;
    }
    const file = fileList[0].originFileObj;

    const fd = new FormData();
    fd.append('amount', String(values.amount));
    fd.append('screenshot', file);

    try {
      setSubmitting(true);
      const resp = await fetch('/api/recharge-requests', {
        method: 'POST',
        // If you use JWT:
        // headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Failed');

      message.success('Recharge request submitted');
      form.resetFields();
      setFileList([]);
      setOpen(false);
    } catch (e) {
      message.error(e.message || 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Button type="primary" onClick={() => setOpen(true)}>Add</Button>

      <Modal
        title="Recharge Request"
        open={open}
        onCancel={() => setOpen(false)}
        okText="Submit"
        confirmLoading={submitting}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ amount: undefined }}
        >
          <Form.Item
            label="Amount"
            name="amount"
            rules={[
              { required: true, message: 'Amount is required' },
              {
                validator: (_, v) =>
                  v && Number(v) > 0 ? Promise.resolve() : Promise.reject('Enter a valid amount'),
              },
            ]}
          >
            <InputNumber
              min={1}
              precision={0}
              style={{ width: '100%' }}
              placeholder="Enter amount"
            />
          </Form.Item>

          <Form.Item
            label="Payment Screenshot"
            required
            extra="JPG/PNG/WEBP, max 3MB"
          >
            <Upload.Dragger
              name="screenshot"
              multiple={false}
              fileList={fileList}
              maxCount={1}
              accept=".jpg,.jpeg,.png,.webp"
              beforeUpload={() => false} // prevent auto upload; we send via fetch
              onChange={({ fileList: fl }) => setFileList(fl)}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Click or drag file to upload</p>
            </Upload.Dragger>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default RechargeRequest;