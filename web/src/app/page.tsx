import { redirect } from 'next/navigation';

// The map is UMI's opening screen (#18); donor, co-op and holder screens are linked from there.
export default function Page() {
  redirect('/map');
}
