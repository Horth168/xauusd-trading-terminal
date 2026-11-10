import { useState } from 'react';
import { GoogleAuthProvider, createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { auth } from '../lib/firebase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg('');
    try { await fn(); } catch (e: any) { setMsg(String(e.code ?? e.message).replace('auth/', '').replace(/-/g, ' ')); } finally { setBusy(false); }
  };
  const google = () => run(async () => {
    const provider = new GoogleAuthProvider();
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    // Popups are blocked in iOS standalone PWAs; use redirect there.
    if (standalone) await signInWithRedirect(auth!, provider); else await signInWithPopup(auth!, provider);
  });

  return (
    <div className="flex h-full items-center justify-center p-4 pt-safe">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-10 w-10" />
          <div><h1 className="font-semibold text-ink-100">XAUUSD Trading Terminal</h1><p className="text-xs text-ink-400">Private — sign in to access your journal</p></div>
        </div>
        <button className="btn w-full py-2" onClick={google} disabled={busy}>Continue with Google</button>
        <div className="my-4 flex items-center gap-2 text-[11px] text-ink-500"><div className="h-px flex-1 bg-ink-700" />or<div className="h-px flex-1 bg-ink-700" /></div>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => (mode === 'in' ? signInWithEmailAndPassword(auth!, email, password) : createUserWithEmailAndPassword(auth!, email, password))); }}>
          <input className="input" type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="input" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          <button className="btn-gold w-full py-2" disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />}{mode === 'in' ? 'Sign in' : 'Create account'}</button>
        </form>
        <div className="mt-3 flex justify-between text-xs text-ink-400">
          <button className="hover:text-gold-300" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? 'Create an account' : 'I have an account'}</button>
          <button className="hover:text-gold-300" onClick={() => email ? run(() => sendPasswordResetEmail(auth!, email).then(() => setMsg('Reset email sent'))) : setMsg('Enter your email first')}>Forgot password?</button>
        </div>
        {msg && <p className="mt-3 text-center text-xs text-down">{msg}</p>}
      </div>
    </div>
  );
}
