import Client from './client';
// Hosted CSP uses a fresh nonce for every response.
export const dynamic = 'force-dynamic';
export default function Page() {
  return <Client />;
}
