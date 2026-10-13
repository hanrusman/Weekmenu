import { useState, FormEvent } from 'react';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-sunken">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-surface rounded-3xl p-8 shadow-[0_20px_50px_rgba(0,0,0,0.08)]">
        <div className="flex justify-center mb-6 text-4xl">🍽️</div>
        <h1 className="text-2xl font-bold text-center mb-1 text-ink">Weekmenu</h1>
        <p className="text-sm text-center text-muted mb-8">Log in om door te gaan</p>

        <label className="block text-xs font-bold tracking-wide text-accent mb-2 uppercase">E-mail</label>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="w-full p-3 mb-4 border border-line rounded-2xl text-sm bg-sunken focus:outline-none focus:ring-2 focus:ring-warmth-400"
        />

        <label className="block text-xs font-bold tracking-wide text-accent mb-2 uppercase">Wachtwoord</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          className="w-full p-3 mb-6 border border-line rounded-2xl text-sm bg-sunken focus:outline-none focus:ring-2 focus:ring-warmth-400"
        />

        {error && <div className="mb-4 p-3 rounded-xl bg-danger-soft text-sm text-danger">{error}</div>}

        <button
          type="submit"
          disabled={submitting || !email || !password}
          className="w-full py-3 rounded-2xl bg-brand text-on-brand font-medium disabled:opacity-50 hover:bg-brand-hover transition"
        >
          {submitting ? 'Bezig...' : 'Inloggen'}
        </button>
      </form>
    </div>
  );
}
