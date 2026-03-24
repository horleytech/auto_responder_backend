import { useState } from 'react';
import { Lock } from 'lucide-react';
import PasswordField from '../components/PasswordField';
import { fetchJsonSafe, saveDashboardToken } from '../lib/api';

export default function LoginPage({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { response, data } = await fetchJsonSafe('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password })
      });

      if (response.ok && data.success) {
        saveDashboardToken(data.sessionToken || '');
        onLogin({ sessionToken: data.sessionToken || '' });
      } else {
        setError(data.error || `Login failed (${response.status})`);
      }
    } catch (err) {
      setError('Failed to connect to server');
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
            <Lock size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Admin Access</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Enter your master password to unlock the dashboard.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <PasswordField
            label="Master Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password..."
          />

          {error && <p className="text-sm font-medium text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Unlock Dashboard'}
          </button>
        </form>
      </div>
    </div>
  );
}
