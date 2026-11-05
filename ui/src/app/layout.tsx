import type { Metadata, Viewport } from 'next';
import Providers from './providers';
import SiteShell from '@/components/SiteShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'BASINSHIFT — Global Flood Intelligence',
  description: 'Forecast extreme river discharge beyond observed environments: gauge observations, 1–7 day outlooks, high-flow odds and a risk map for ten monitored catchments.',
};
export const viewport: Viewport = { themeColor: '#000000', colorScheme: 'dark' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Providers><SiteShell>{children}</SiteShell></Providers></body></html>;
}
