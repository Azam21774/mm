import React, { useContext } from 'react';
import styles from './recipient.module.css';
import { Button,Card,Table } from 'antd';
import { Context } from '../../../context/mymailContext';
import ReciCsv from './recicsv';


const Recipient = () => {

    const {reci} = useContext(Context)




    return (
    
      <Card size='small'style={{width:"400px"}} >
        <ReciCsv/>

    <div className={styles.table} >


        </div>
        </Card>
    );
    }

export default Recipient;

