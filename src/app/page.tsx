import { getAuthenticatedProfile } from '@/lib/auth';
import { HouseholdApp } from '@/components/HouseholdApp';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const me = await getAuthenticatedProfile();
  return <HouseholdApp initialAuthed={Boolean(me)} />;
}
