
'use client';

import { ConfigProvider,theme } from 'antd';







export default function ThemeLayout({ children }) {




  return (
   
      <ConfigProvider
        theme={{
          algorithm: theme.darkAlgorithm,
    
          token: {
            // Seed Token
            //colorPrimary: '#44AE4E',
           
            
          },
        }}
   
    >
     {children}
     </ConfigProvider>
  );
}



