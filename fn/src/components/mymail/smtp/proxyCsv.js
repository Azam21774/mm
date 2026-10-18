import React, { useContext } from 'react';
import styles from './smtp.module.css';
import { Button,Typography} from 'antd';
import { DeleteOutlined,PartitionOutlined } from '@ant-design/icons';
import CSVReader from 'react-csv-reader'
import { Context } from '../../../context/mymailContext';


const ProxyCsv = () => {

    const {proxyList,
        setProxyList,} = useContext(Context)

    const { Text } = Typography;

    const handleFileLoad = (data) => {


        data.map((item,index) => {
            if(item[0]){
                setProxyList((prev) => [...prev,item[0]])
            }
        })

        document.querySelector('#pxyfile').value = ''
    }   

    const handleRemove = ()=>{
        setProxyList([])
        document.querySelector('#pxyfile').value = ''

      

    }






    return (
      
     
      <div style={{width:"380px"}} className={styles.proxyReader}>
    <div>    
    <label htmlFor='pxyfile' className='fileBtn'>
    <PartitionOutlined />   &nbsp; Proxy {proxyList.length}
    </label>
    <CSVReader cssInputClass='fileBtnDefault' inputId='pxyfile'  onFileLoaded={handleFileLoad} />
    </div>
     
     {proxyList.length>0&&    <Text  type='secondary'  onClick={handleRemove}  icon={<DeleteOutlined />} 
    style={{cursor:'pointer',marginLeft:'10px'}}
    >remove</Text>   
}
         
    {/* <Button  onClick={handleRemove}  icon={<ExperimentFilled />} type="primary"  className={styles.testbtn}>Test Smtp</Button>         */}

    </div>

    );
    }

export default ProxyCsv;

