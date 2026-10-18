import React, { useContext, useState } from "react";
import { Button, Divider, Form, Input, message, Modal, Select, Space,List } from "antd";
import { Context } from '../../../context/mymailContext';
import useLocalStorage from "use-local-storage";
import {DeleteOutlined } from  "@ant-design/icons";



const { Option } = Select;

const EmailHeaderModal = () => {

  const [headers, setHeaders] = useLocalStorage('headers', []);




  const [visible, setVisible] = useState(false);
  const { emailHeader, setEmailHeader } = useContext(Context);
  const [form] = Form.useForm();

  const handleOpen = () => {
    form.setFieldsValue(emailHeader); // Load current values
    setVisible(true);
  };

  const handleFinish = (values) => {
    
   
    const newHeader = {
      headerName : values.headerName,
      headerValue : values.headerValue
  };

  if (!values.headerName || !values.headerValue) {
    message.error("Please fill in all fields");
    return;
  }
  const existingHeader = headers.find(header => header.headerName === values.headerName);
  if (existingHeader) {
    message.error("Header already exists");
    return;
  }

   setHeaders((prevHeaders) => {
    const updatedHeaders = [...prevHeaders, newHeader];
    return updatedHeaders;
  });
}



const handleDelete = ( headerName) => {
  const updatedHeaders = headers.filter(header => header.headerName !== headerName);
  setHeaders(updatedHeaders);

};



  return (
    <div>
      <Modal
        open={visible}
        title="Email Headers"
        onCancel={() => setVisible(false)}
        footer={null}
      >
        <Form
         
          form={form}
          onFinish={handleFinish}
          initialValues={emailHeader}
        >
       <Space>

        <Form.Item  name="headerName">
            <Input style={{width:150}} placeholder="Name" />
          </Form.Item>

          <Form.Item  name="headerValue">
          <Input style={{width:250}} placeholder="Value" /> 
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
            +
            </Button>
            
          </Form.Item>
          </Space>  

         

         
        </Form>

<List
         
          header={<div>Configured Headers</div>}
          bordered
          dataSource={headers}
          renderItem={(header) => {
        
            return (
              <List.Item
                actions={[
                  <Button
                   
                    size="small"
                    onClick={() => handleDelete(header.headerName)}
                  >
                    <DeleteOutlined />
                  </Button>
                ]}
              >
                <span><b>{header.headerName}:</b> {header.headerValue}</span>
              </List.Item>
            );
          }}
        />


      </Modal>

      <Button style={{marginLeft:"20px"}} size="small" onClick={handleOpen}>
      Configure Email Headers 
      </Button>


    </div>
  );
};

export default EmailHeaderModal;