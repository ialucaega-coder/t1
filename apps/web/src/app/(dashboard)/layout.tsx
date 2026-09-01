import { Sidebar } from '@/components/dashboard/Sidebar';
import { Header } from '@/components/dashboard/Header';
import { WebChat } from '@/components/chat/WebChat';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface">
      <Sidebar />
      <main className="ml-60">
        <Header />
        <div className="p-8">
          {children}
        </div>
      </main>
      <WebChat />
    </div>
  );
}
