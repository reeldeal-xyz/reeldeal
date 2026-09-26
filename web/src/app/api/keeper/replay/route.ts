// Stub for the "Replay" button on /map (#18). The keeper (#17) will collect the pipeline's signature,
// add its own, and call ReliefPool.attest() + settle() for the selected zone/season/rule. Until then this
// just says so.
export async function POST() {
  return Response.json({ error: 'not implemented', issue: 17, note: 'keeper will attest + settle here' }, { status: 501 });
}
