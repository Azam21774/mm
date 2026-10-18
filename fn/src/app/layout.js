// app/src/app/layout.js
import "./globals.css";
import AuthContextProvider from "@/context/authContext";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import ThemeLayout from "./themeLayout";
import Provider from "../context/mymailContext";

export const metadata = {
  title: "Mail System 1.0",
  description: "Mail System",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthContextProvider>
          <ThemeLayout>
            <Provider>
              <AntdRegistry>{children}</AntdRegistry>
            </Provider>
          </ThemeLayout>
        </AuthContextProvider>
      </body>
    </html>
  );
}