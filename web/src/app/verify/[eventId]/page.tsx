export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return (<main><h1>Recompute {eventId}</h1><p>Loads the pinned NASA CSV, checks its sha256, reruns the index. (issue: recompute page)</p></main>);
}
