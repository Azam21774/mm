import React, { useContext,useState, useEffect } from 'react';
import Smtpcsv from './smtpcsv';
import styles from './smtp.module.css';
import { Button, Card, message, Input, Popover, Select, Space,Switch,Typography,Table, Upload } from 'antd';
import { Context } from '../../../context/mymailContext';
import { ExclamationCircleOutlined,FileAddFilled,UploadOutlined } from '@ant-design/icons';
import { CSVLink } from 'react-csv';
import ProxyCsv from './proxyCsv';
import useLocalStorage from "use-local-storage";
import * as XLSX from 'xlsx';

const SMTP_SOURCE = [
    { value: '', label: 'Custom' },
    { value: '1und1', label: '1und1' },
    { value: '126', label: '126' },
    { value: '163', label: '163' },
    { value: 'Aliyun', label: 'Aliyun' },
    { value: 'AliyunQiye', label: 'AliyunQiye' },
    { value: 'AOL', label: 'AOL' },
    { value: 'Aruba', label: 'Aruba' },
    { value: 'Bluewin', label: 'Bluewin' },
    { value: 'BOL', label: 'BOL' },
    { value: 'DebugMail', label: 'DebugMail' },
    { value: 'Disroot', label: 'Disroot' },
    { value: 'DynectEmail', label: 'DynectEmail' },
    { value: 'ElasticEmail', label: 'ElasticEmail' },
    { value: 'Ethereal', label: 'Ethereal' },
    { value: 'FastMail', label: 'FastMail' },
    { value: 'Feishu Mail', label: 'Feishu Mail' },
    { value: 'Forward Email', label: 'Forward Email' },
    { value: 'GandiMail', label: 'GandiMail' },
    { value: 'Gmail', label: 'Gmail' },
    { value: 'GmailWorkspace', label: 'GmailWorkspace' },
    { value: 'GMX', label: 'GMX' },
    { value: 'Godaddy', label: 'Godaddy' },
    { value: 'GodaddyAsia', label: 'GodaddyAsia' },
    { value: 'GodaddyEurope', label: 'GodaddyEurope' },
    { value: 'hot.ee', label: 'hot.ee' },
    { value: 'Hotmail', label: 'Hotmail' },
    { value: 'iCloud', label: 'iCloud' },
    { value: 'Infomaniak', label: 'Infomaniak' },
    { value: 'KolabNow', label: 'KolabNow' },
    { value: 'Loopia', label: 'Loopia' },
    { value: 'Loops', label: 'Loops' },
    { value: 'mail.ee', label: 'mail.ee' },
    { value: 'Mail.ru', label: 'Mail.ru' },
    { value: 'Mailcatch.app', label: 'Mailcatch.app' },
    { value: 'Maildev', label: 'Maildev' },
    { value: 'MailerSend', label: 'MailerSend' },
    { value: 'Mailgun', label: 'Mailgun' },
    { value: 'Mailjet', label: 'Mailjet' },
    { value: 'Mailosaur', label: 'Mailosaur' },
    { value: 'Mailtrap', label: 'Mailtrap' },
    { value: 'Mandrill', label: 'Mandrill' },
    { value: 'Naver', label: 'Naver' },
    { value: 'OhMySMTP', label: 'OhMySMTP' },
    { value: 'One', label: 'One' },
    { value: 'OpenMailBox', label: 'OpenMailBox' },
    { value: 'Outlook365', label: 'Outlook365' },
    { value: 'Postmark', label: 'Postmark' },
    { value: 'Proton', label: 'Proton' },
    { value: 'qiye.aliyun', label: 'qiye.aliyun' },
    { value: 'QQ', label: 'QQ' },
    { value: 'QQex', label: 'QQex' },
    { value: 'Resend', label: 'Resend' },
    { value: 'Runbox', label: 'Runbox' },
    { value: 'SendCloud', label: 'SendCloud' },
    { value: 'SendGrid', label: 'SendGrid' },
    { value: 'SendinBlue', label: 'SendinBlue' },
    { value: 'SendPulse', label: 'SendPulse' },
    { value: 'SES', label: 'SES' },
    { value: 'SES-US-EAST-1', label: 'SES-US-EAST-1' },
    { value: 'Seznam', label: 'Seznam' },
    { value: 'SMTP2GO', label: 'SMTP2GO' },
    { value: 'Sparkpost', label: 'Sparkpost' },
    { value: 'Tipimail', label: 'Tipimail' },
    { value: 'Tutanota', label: 'Tutanota' },
    { value: 'Yahoo', label: 'Yahoo' },
    { value: 'Yandex', label: 'Yandex' },
    { value: 'Zimbra', label: 'Zimbra' },
    { value: 'Zoho', label: 'Zoho' },
    { value: '', label: 'Custom' },
];



const Smtp = () => {

   
    const { Text } = Typography;

    const [messageApi, contextHolder] = message.useMessage()


    const { smtpType, setSmtpType, smtp, setSmtp } = useContext(Context)

    const [host, setHost] = useLocalStorage('smtpHost', '');
    const [port, setPort] = useLocalStorage('smtpPort', '');
    const [secure, setSecure] = useLocalStorage('smtpSecure', false);
    const [wellKnownProvider, setWellKnownProvider] = useLocalStorage('wellKnownProvider', "Gmail");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const providerValue = mounted ? wellKnownProvider : "Gmail";

    const [smtpList, setSmtpList] = useState([])


    const handleSelectChange = (e) => {
        setSmtpType(e)

    }

    const handleWellKnownProviderChange = (providerValue) => {
        setWellKnownProvider(providerValue);
    }


//     const transporter = nodemailer.createTransport({
//   service: "Gmail", // Use any Service ID from the table below (case-insensitive)
//   auth: {
//     user: process.env.SMTP_USER,
//     pass: process.env.SMTP_PASS,
//   },
// });

    const handlefile = (e) => {
      
        const file = e;
        const reader = new FileReader();

    // use the library xlsx to read the file
        reader.onload = (event) => {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            // if service and host port not there then show error
            if(wellKnownProvider === "" && (host === "" || port === "")){
                messageApi.error("Please enter host and port or select a service")
                return
            }
           if(wellKnownProvider){
            jsonData.map((item,index) => {
                if(item[0] && item[1] ){
                    setSmtp((prev) => [...prev,{
                        service: wellKnownProvider,
                        auth:{
                            user: item[0],
                            pass: item[1]
                        }
                    }])
                }
            })
           }else{
            jsonData.map((item,index) => {
                if(item[0] && item[1]){
                    setSmtp((prev) => [...prev,{
                        host: host,
                        port: port,
                        secure: secure,
                        auth:{
                            user: item[0],
                            pass: item[1]
                        }
                    }])
                }
            }
            )
           }
                     
        };

        reader.readAsArrayBuffer(file);



    };


    const columns = [
        {
          title: 'email',
                    dataIndex: ['auth', 'user'],
          key: 'email',
        },
       {
        title: 'pass',
                dataIndex: ['auth', 'pass'],
        key: 'pass',
      },
    {
            title: 'service',
            dataIndex: 'service',
            key: 'service',
        },
        {
            title: 'host',
            dataIndex: 'host',
            key: 'host',
                render: (hostValue, record) => record?.service ? '-' : hostValue,
        },
        {
            title: 'port',
            dataIndex: 'port',
            key: 'port',
                render: (portValue, record) => record?.service ? '-' : portValue,
        },
        {
            title: 'secure',
            dataIndex: 'secure',
            key: 'secure',
                render:(isSecure, record)=>record?.service ? '-' : <Switch disabled checked={!!isSecure} size='small' />
        }
      ];

       

       


    return (
            <Card size='small' style={{width:"400px"}}>
        {contextHolder}
                <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                                 <div style={{width:"200px",display:"flex",alignItems:"stretch",flexDirection:"column",gap:"10px"}}>
             <Select
            showSearch
            allowClear
            placeholder=''
            size='small'
            value={providerValue}
                        style={{ width: "100%" }}
            options={SMTP_SOURCE}
            optionFilterProp='label'
            onChange={handleWellKnownProviderChange}
            onClear={() => setWellKnownProvider("")}
        />
        <Popover
            content={ <>
                <Button size='small' type='primary' onClick={() => {
                    setSmtp([])
                }} >Clear List</Button>
                <Table  size='small'    pagination={10} columns={columns} dataSource={smtp} />
                </>
    } trigger="hover">

                <Space direction='vertical' style={{width:"100%"}}>
             <Upload
        multiple={false}
        accept=".csv,.txt"
        beforeUpload={handlefile}
        showUploadList={false}
      >
            <Button size='small' icon={<FileAddFilled />} style={{width:"100%"}}>{smtp.length>0 ? `${smtp.length} user | pass` : 'user | pass file'}</Button>
      </Upload>

        </Space></Popover>
        </div>

        {providerValue === "" &&
        <div style={{width:"200px"}}>
       
        <Input disabled={providerValue !== ""} style={{marginBottom:"10px"}} placeholder='Host' value={host} onChange={(e) => setHost(e.target.value)} size='small'  />
        <Space align='center'>
        <Input disabled={providerValue !== ""} style={{width:"100px"}} type='number' placeholder='Port' value={port} onChange={(e) => setPort(e.target.value)} size='small'  />
         <Switch disabled={providerValue !== ""} size='small' checked={secure} onChange={(e) => setSecure(e)} /> Secure
        </Space>
        </div>}
   


       
         </div>
         



               
                    {/* <ProxyCsv /> */}
        </Card>
    );
}

export default Smtp;

