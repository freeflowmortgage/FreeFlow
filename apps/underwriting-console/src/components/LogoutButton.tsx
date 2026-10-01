import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { portalClient } from '../api/portalClient';

export default function LogoutButton({ className = '' }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logout = async () => {
    setBusy(true);
    setError(null);
    try {
      const { logoutUrl } = await portalClient.logout();
      const destination = new URL(logoutUrl);
      if (destination.protocol !== 'https:' || !destination.hostname.endsWith('.amazoncognito.com')) {
        throw new Error('LOGOUT_DESTINATION_INVALID');
      }
      window.location.assign(destination.toString());
    } catch {
      setError('Sign out failed. Try again.');
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={() => void logout()}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50 ${className}`}
      >
        <LogOut className="h-3.5 w-3.5" />
        {busy ? 'Signing out...' : 'Sign out'}
      </button>
      {error ? <span role="alert" className="mt-1 text-[10px] font-semibold text-red-700">{error}</span> : null}
    </span>
  );
}
