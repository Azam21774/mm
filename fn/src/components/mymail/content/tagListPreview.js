'use client';

import React from 'react';
import { Modal, Table } from 'antd';

const TagListPreview = ({ setSelectedListId, selectedList }) => {

  return (
    <Modal
      open={selectedList !== undefined}
      onCancel={() => setSelectedListId(null)}
      footer={null}
    >
      <Table
        size='small'
        pagination={false}
        scroll={{ y: 360 }}
        columns={[
          {
            title: 'S.No',
            key: 'sno',
            width: 80,
            render: (_, __, index) => index + 1,
          },
          {
            title: 'Content',
            dataIndex: 'content',
            key: 'content',
          },
        ]}
        dataSource={(selectedList?.items || []).map((item, index) => ({
          key: index,
          content: item,
        }))}
      />
    </Modal>
  );
};

export default TagListPreview;
