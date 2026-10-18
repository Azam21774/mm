import React, { useContext,useEffect,useState } from 'react';
import ReciCsv from '../recipient/recicsv';
import styles from './content.module.css';
import {Input,Button,Upload, message, Typography, Space, Checkbox, Select, Alert, Switch,Card} from 'antd';
import { backend } from '../../../desktopBackend';
import { Context } from '../../../context/mymailContext';
import { SendOutlined,ApiOutlined,
  UploadOutlined,
    FilePdfOutlined,
    DeleteOutlined,
    CopyOutlined} from '@ant-design/icons';
import ContentTags from './contentTags';
import ContentTemplates from './contentTemplates';
import useLocalStorage from "use-local-storage";
import UpdatePdfMetadataInputs from './metaData';


const Content = ({ sendMethod = 'BROWSER' }) => {


    const { TextArea } = Input;
    const { Text } = Typography;

    const [fileList, setFileList] = useState([]);

    const [inline, setInline] = useState(false);

    const {
        senderName,
        setSenderName,
        pdfHtml,
        setPdfHtml,
         attachmentType,
            setAttachmentType,
           encodingType, setEncodingType,
            sendAsPdf,
            delay, setDelay,
    backendReady
    } = useContext(Context)

    const [uploadDelay, setUploadDelay] = useLocalStorage('uploadDelay', 2000);

 


      const handleUpload = async(file) => {

    
     await backend.uploadAttachment(file)
        .then(data => {
          if (data.status === 200) {
            message.success('File uploaded successfully');
          } else {
            message.error('Upload failed');
          }
        })
        .catch(error => {
        console.error(error);
          message.error('Upload error');
        });
        getFiles();
      };


      const getFiles = async () => {
        try {
          const response = await backend.listFiles();

          setFileList([]);
            response.data.files.map((item)=>{
                setFileList(fileList=>[...fileList,{
                  name:item.name,
                  status:"done"
                  }])
            }
            )
        } catch (error) {
          console.error(error);
        }
      }

    





      const uploadProps = {
        beforeUpload: (file) => {
          const isLt5M = file.size / 1024 / 1024 < 5;
          if (!isLt5M) {
            message.error('File must be smaller than 5MB');
            return false;
          }
          handleUpload(file);
          return false; // Prevent automatic upload
        },
        fileList: fileList,
        deleteIcon:null,
     showUploadList: { showRemoveIcon: false },
      };


      const [customTags, setCustomTags] = useLocalStorage('customTags', [])


      const deleteFiles = async (name) => {
        try {
         const res = await backend.deleteAttachments();
          if(res.status===200){
            message.success('Files deleted successfully');
            getFiles();
          }else{
            message.error('Delete failed');
          }
          

        }
        catch (error) {
          console.error(error);
        }
      }

      useEffect(() => {
        if (backendReady) {
          getFiles();
        }
      }, [backendReady]);



      useEffect(() => {

        if(attachmentType === "IMAGEPNG" || attachmentType === "IMAGEJPG" || attachmentType === "IMAGEHEIC"){
          setInline(true);
        }else{
          setInline(false);
        }
      },[attachmentType])


const attachmentTypeSelect = <Select value={attachmentType} onChange={e=>{setAttachmentType(e)}} style={{width:"176px"}} size='small' placeholder="Attachment Type">
<Select.Option value="">Attachment - none</Select.Option>
<Select.Option value="PDF">PDF</Select.Option>
<Select.Option value="WKPDF">WKPDF</Select.Option>
<Select.Option value="PDFIMAGE">PDF IMAGE</Select.Option>
<Select.Option value="PDFIMAGEPNG">PDF IMAGE PNG</Select.Option>
<Select.Option value="IMAGEPNG">IMAGE PNG</Select.Option>
<Select.Option value="IMAGEJPG">IMAGE JPG</Select.Option>
<Select.Option value="IMAGEHEIC">IMAGE HEIC</Select.Option>
<Select.Option value="TXT">TXT</Select.Option>
<Select.Option value="DOCX">DOCX</Select.Option>
<Select.Option value="PDFENCODE">PDF ENCODE</Select.Option>
<Select.Option value="XLSX">XLSX</Select.Option>
<Select.Option value="PPTX">PPTX</Select.Option>
<Select.Option value="UPLOAD">UPLOAD</Select.Option>
</Select>;

const attachmentSelect = <Space wrap size={8}>
  {attachmentTypeSelect}
  <Input type="number" min={0} value={delay} onChange={e=>setDelay(e.target.value)} style={{width:210}} size="small" addonBefore="Send delay" />
  {/* Upload delay only matters for Browser sending (pacing attachment uploads through
      the Gmail compose UI) — App Password/Gmail API send via SMTP/the API directly,
      so it has nothing to do there and would just be confusing. */}
  {sendMethod === 'BROWSER' ? <Input type="number" min={0} value={uploadDelay} onChange={e=>setUploadDelay(e.target.value)} style={{width:230}} size="small" addonBefore="Upload delay" /> : null}
</Space>;


    return (
        <div className={styles.con} >

        <div className={styles.inputcon}>

          <Space size={12} direction="vertical" style={{width:"100%"}} >
{!attachmentType ? <Space>{attachmentSelect}</Space> : null}
        </Space>
        
      
      
{attachmentType != ""?

      <Space size={8} direction="vertical" style={{width:"100%", marginTop: 8}} >


{attachmentType==="UPLOAD"?
<Space direction="vertical" >
<Space>{attachmentSelect}</Space>
<Upload {...uploadProps}>
    <Button size='small' icon={<UploadOutlined />}>Upload attachment</Button>
  </Upload>
  {fileList.length>0&&
  <Button size='small' onClick={deleteFiles} icon={<DeleteOutlined />}>Delete Files</Button>}
 </Space>:
<>
  {attachmentType==="PDF" || attachmentType==="PDFIMAGE" || attachmentType==="WKPDF" || attachmentType==="PDFIMAGEPNG" || sendAsPdf ? <UpdatePdfMetadataInputs attachmentControl={attachmentSelect} fileNameControl={null} /> : <Space>{attachmentSelect}</Space>}
<TextArea value={pdfHtml} onChange={e=>{setPdfHtml(e.target.value)}}   style={{width:"100%"}} size='small'  rows={4}  placeholder="Attachment HTML" />

</>
}


</Space>



:""}

 
        

</div>
<div className={styles.tags}>
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <ContentTags
        customTags={customTags}
        setCustomTags={setCustomTags}
      />
      <ContentTemplates />
    </Space>
</div>

        </div>
    );
    }

export default Content;
