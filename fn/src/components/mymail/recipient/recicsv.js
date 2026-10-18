import React, { useContext } from 'react';
import styles from './recipient.module.css';
import { Button,Table, Typography,Popover, Space, Upload } from 'antd';
import { FileAddFilled } from '@ant-design/icons';
import { Context } from '../../../context/mymailContext';
import { uid } from 'uid';
import * as XLSX from 'xlsx';





const { Text } = Typography;


const ReciCsv = () => {

    const {reci,setReci} = useContext(Context)



    const columns = [
      {
        title: 'S No.',
        dataIndex: 'sn',
        key: 'sn',
        width: 60,
        render: (value, item, index) =>  index+1
        ,
      },
      {
        title: 'Email',
        dataIndex: 'email',
        key: 'email',
        render: (text) => <a>{text}</a>,
      },
      {
        title: 'Name',
        dataIndex: 'name',
        key: 'name',
      },
      {
        title: 'c3',
        dataIndex: 'c3',
        key: 'c3',
      },
      {
        title:'c4',
        dataIndex:'c4',
        key:'c4'
      },
      {
        title:'c5',
        dataIndex:'c5',
        key:'c5'
      }
      ,{
        title:'c6',
        dataIndex:'c6',
        key:'c6'
      }
    ];




    const handleCustomFileLoad = (file) => {
      const reader = new FileReader();

      reader.onload = (event) => {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        rows.forEach((item) => {
          if (item[0]) {
            setReci(prev => [...prev, {
              cid: uid(),
              email: String(item[0]).trim(),
              name: item[1] || '',
              c3: item[2] || '',
              c4: item[3] || '',
              c5: item[4] || '',
              c6: item[5] || '',
            }]);
          }
        });
      };

      reader.readAsArrayBuffer(file);
      return false;
    };

    const handleRemove = ()=>{
      
      setReci([])
    }


    return (
      <div className={styles.csvReader}>
        <Space size={8}>
          <Popover content={
          <Table size='small' pagination={10} columns={columns} dataSource={reci} rowKey="cid" />
          } trigger="hover">
          <Upload
            multiple
            accept=".csv,.xlsx,.xls"
            beforeUpload={handleCustomFileLoad}
            showUploadList={false}
          >
            <Button size='small' type='primary' icon={<FileAddFilled />} style={{width:"100%"}}>
              {reci.length > 0 ? `${reci.length} recipients loaded` : 'Add recipient files (CSV or Excel)'}
            </Button>
          </Upload>
          </Popover>
          <Button size='small' danger onClick={handleRemove} disabled={reci.length === 0}>Clear List</Button>
        </Space>
      </div>

    );
    }

export default ReciCsv;

