import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], weight: ['300', '400', '500', '600', '700', '800'] });

export const metadata = {
  title: 'VoiceTranslate AI — Dịch Giọng Nói Real-Time',
  description: 'Ứng dụng dịch giọng nói tiếng Trung ↔ tiếng Việt theo thời gian thực',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
