import type { Metadata } from 'next';
import './styles.css';
export const metadata: Metadata = {
  title: 'MyBusiness — Your business, connected',
  description: 'Sales, stock and finances in one connected workspace.',
  icons: {
    icon: '/mybusiness-icon.png',
    apple: '/mybusiness-icon.png',
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
