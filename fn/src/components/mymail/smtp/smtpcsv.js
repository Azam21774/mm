import React, { useContext } from 'react';
import styles from './smtp.module.css';
import { Typography } from 'antd';
import { Context } from '../../../context/mymailContext';

const { Text } = Typography;

const Smtpcsv = () => {
  const { smtp, setSmtp, smtpType } = useContext(Context);

  const handleFileLoad = (e) => {
    const files = Array.from(e.target.files);

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target.result;
        const rows = text.trim().split('\n').map((row) => row.split(','));

        rows.forEach((item) => {
          if (item[0]) {
            if (smtpType === 'GMAIL') {
              setSmtp((prev) => [
                ...prev,
                {
                  service: 'gmail',
                  pool: true,
                  auth: {
                    user: item[0],
                    pass: item[1],
                  },
                },
              ]);
            }

            if (smtpType === 'ICLOUD') {
              setSmtp((prev) => [
                ...prev,
                {
                  service: 'iCloud',
                  pool: true,
                  auth: {
                    user: item[0],
                    pass: item[1],
                  },
                },
              ]);
            }

            if (smtpType === 'GMAIL_API') {
              setSmtp((prev) => [
                ...prev,
                {
                  user: item[0],
                  pass: item[1],
                  clientId: item[2],
                  clientSecret: item[3],
                  redirectUri: item[4],
                },
              ]);
            }

            if (smtpType === 'OTHER') {
              setSmtp((prev) => [
                ...prev,
                {
                  host: item[2],
                  port: item[3],
                  pool: true,
                  secure: item[4] === 'secure' ? true : false,
                  auth: {
                    user: item[0],
                    pass: item[1],
                  },
                  tls: item[4] === 'secure' ?  {} : { rejectUnauthorized: false },
                },
              ]);
            }
          }
        });
      };
      reader.readAsText(file);
    });

    e.target.value = '';
  };

  const handleRemove = () => {
    setSmtp([]);
    document.querySelector('#smtpfile').value = '';
  };

  return (
    <div className={styles.csvReader}>
      <div>
        <label htmlFor="smtpfile" className="fileBtn">
          📩 SMTP .csv
        </label>
        &nbsp;
        <input
          type="file"
          id="smtpfile"
          className="fileBtnDefault"
          accept=".csv"
          multiple
          onChange={handleFileLoad}
          style={{ display: 'none' }}
        />
      </div>

      {smtp.length > 0 && (
        <div className={styles.count}>
          · <Text type="secondary">{smtp.length} SMTPs</Text> ·{' '}
          <Text style={{ color: '#b74849', cursor: 'pointer' }} onClick={handleRemove}>
            🗑 Clear
          </Text>
        </div>
      )}
    </div>
  );
};

export default Smtpcsv;