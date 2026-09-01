import { PublicChat } from './PublicChat';

interface PageProps {
  params: Promise<{ botId: string }>;
}

export default async function PublicChatPage({ params }: PageProps) {
  const { botId } = await params;
  return <PublicChat botId={botId} />;
}
