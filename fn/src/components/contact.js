import React, { useState, useContext } from 'react';
import { Modal, Typography,Card, Divider, Space } from 'antd';
import Link from 'next/link';


const ContactDetails = () => {

    const { Text,Title } = Typography;
  const telegramUsername = 'Inboxious'; // without @

    
    return (
        <div style={{padding:20}}>
            
            
            <Card 

            style={{display:'flex',alignItems:'center',flexDirection:'column'}}
          
            
       
  > 
  <Space>
  
      <img
        draggable={false}
        alt="example"
        style={{height:25,width:25}}
        src="/tgi.png"
      /> 
   <Text level={5}>Telegram: <Link href={`https://t.me/${telegramUsername}`} target="_blank"> @{telegramUsername}</Link></Text>
     
    </Space>
     <Divider
      /> 
       <img
        draggable={false}
        alt="example"
        style={{height:100,width:100}}

       
        src="/session.jpeg"
      />
      <br/>
      <Text>056a736b03d79c6d99d2c2bb9f7c045845bd5283f00c1901a0515ab333b0d55856</Text>
      </Card>
            </div>
    )
}

export default ContactDetails;
    