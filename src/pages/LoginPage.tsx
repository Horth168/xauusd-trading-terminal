import { useEffect, useState, type FormEvent } from 'react';
import {
  GoogleAuthProvider, browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, getRedirectResult,
  sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, updateProfile,
} from 'firebase/auth';
import { ArrowLeft, Check, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import { auth } from '../lib/firebase';

type Mode = 'signin' | 'register' | 'reset';

const ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-not-found': 'No account found with this email.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/network-request-failed': 'No internet connection. Check your network and try again.',
  'auth/popup-closed-by-user': 'Google sign-in was closed before finishing.',
  'auth/cancelled-popup-request': 'Google sign-in was cancelled.',
  'auth/popup-blocked': 'Your browser blocked the Google pop-up. Allow pop-ups or try again.',
  'auth/unauthorized-domain': 'Google sign-in is not enabled for this website yet (add the domain in Firebase → Authentication → Settings → Authorized domains).',
  'auth/operation-not-allowed': 'This sign-in method is turned off in Firebase → Authentication → Sign-in method.',
  'auth/admin-restricted-operation': 'New registrations are disabled for this app.',
};
const friendly = (e: any) => ERRORS[e?.code] ?? (e?.message ? String(e.message).replace('Firebase: ', '') : 'Something went wrong. Please try again.');

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s; // 0..4
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function Field({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-300">{label}</span>
      <div className="group relative flex items-center">
        <Icon size={17} className="pointer-events-none absolute left-3.5 text-ink-400 transition-colors group-focus-within:text-gold-400" />
        {children}
      </div>
    </label>
  );
}

const inputCls = 'h-12 w-full rounded-xl border border-ink-600/70 bg-ink-900/80 pl-11 pr-11 text-[15px] text-ink-100 outline-none transition-all duration-200 placeholder:text-ink-500 hover:border-ink-500 focus:border-gold-500 focus:bg-ink-900 focus:ring-4 focus:ring-gold-500/10';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [shake, setShake] = useState(0);

  // Finish a Google redirect sign-in (used inside the installed iPhone app).
  useEffect(() => {
    getRedirectResult(auth!).catch((e) => { setError(friendly(e)); setShake((n) => n + 1); });
  }, []);

  useEffect(() => { setError(''); setInfo(''); }, [mode]);

  const fail = (e: any) => { setError(friendly(e)); setShake((n) => n + 1); };
  const persist = () => setPersistence(auth!, remember ? browserLocalPersistence : browserSessionPersistence);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (mode === 'register') {
      if (password.length < 6) return fail({ code: 'auth/weak-password' });
      if (password !== confirm) return fail({ message: 'Passwords do not match.' });
    }
    setBusy('email');
    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth!, email);
        setInfo('Check your inbox — we sent a link to reset your password.');
        return;
      }
      await persist();
      if (mode === 'signin') await signInWithEmailAndPassword(auth!, email, password);
      else {
        const cred = await createUserWithEmailAndPassword(auth!, email, password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
      }
    } catch (err) { fail(err); } finally { setBusy(null); }
  };

  const google = async () => {
    setError(''); setBusy('google');
    try {
      await persist();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
      // Pop-ups don't work inside an installed iOS home-screen app, so use a full-page redirect there.
      if (standalone) await signInWithRedirect(auth!, provider);
      else await signInWithPopup(auth!, provider);
    } catch (err) { fail(err); } finally { setBusy(null); }
  };

  const s = strength(password);
  const sColors = ['bg-down', 'bg-down', 'bg-gold-500', 'bg-gold-400', 'bg-up'];
  const sLabel = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][s];

  return (
    <div className="relative flex h-full overflow-y-auto bg-ink-950">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-gold-500/[0.07] blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      </div>

      {/* Brand panel (desktop) */}
      <aside className="relative hidden w-[46%] max-w-[640px] flex-col justify-between border-r border-white/5 p-12 lg:flex">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-9 w-9" />
          <span className="text-[15px] font-semibold tracking-tight text-ink-100">XAU Terminal</span>
        </div>
        <div className="animate-in">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight text-ink-100">Your gold trading,<br /><span className="bg-gradient-to-r from-gold-300 to-gold-500 bg-clip-text text-transparent">all in one place.</span></h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-400">Live XAUUSD charts, your own indicators, honest backtests and a private journal that follows you from desk to phone.</p>
          <ul className="mt-8 space-y-3 text-sm text-ink-300">
            {['Exness MT5 prices via your private bridge', 'Backtests on real candles — no look-ahead', 'Journal, deposits and P&L kept separate'].map((t) => (
              <li key={t} className="flex items-center gap-3"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold-500/10 text-gold-400"><Check size={14} /></span>{t}</li>
            ))}
          </ul>
        </div>
        <p className="flex items-center gap-2 text-xs text-ink-500"><ShieldCheck size={14} /> Your records are private to your account.</p>
      </aside>

      {/* Auth card */}
      <main className="relative flex min-h-full flex-1 items-start justify-center sm:items-center px-5 pb-[calc(28px+var(--safe-bottom))] pt-[calc(44px+var(--safe-top))]">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <img src="/icon.svg" alt="" className="h-14 w-14 rounded-2xl shadow-[0_8px_30px_-8px_rgba(212,167,44,0.45)]" />
            <span className="mt-3 text-sm font-semibold text-ink-200">XAU Terminal</span>
          </div>

          <div key={mode} className="animate-in">
            {mode === 'reset' && (
              <button className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-400 transition-colors hover:text-ink-100" onClick={() => setMode('signin')}><ArrowLeft size={16} /> Back to sign in</button>
            )}
            <h1 className="text-[26px] font-semibold tracking-tight text-ink-100">{mode === 'signin' ? 'Welcome back' : mode === 'register' ? 'Create your account' : 'Reset password'}</h1>
            <p className="mt-1.5 text-[15px] text-ink-400">{mode === 'signin' ? 'Sign in to continue to your terminal.' : mode === 'register' ? 'One account for your PC and phone.' : 'We’ll email you a link to choose a new password.'}</p>
          </div>

          {mode !== 'reset' && (
            <>
              <div className="relative mt-7 grid grid-cols-2 rounded-xl border border-white/5 bg-ink-900 p-1">
                <span className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-ink-700 shadow transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${mode === 'register' ? 'translate-x-full' : ''}`} />
                {(['signin', 'register'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)} className={`relative z-10 h-10 rounded-lg text-sm font-medium transition-colors ${mode === m ? 'text-ink-100' : 'text-ink-400 hover:text-ink-200'}`}>
                    {m === 'signin' ? 'Sign in' : 'Register'}
                  </button>
                ))}
              </div>

              <button type="button" onClick={google} disabled={!!busy}
                className="mt-5 flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white text-[15px] font-medium text-[#1f1f1f] transition-all duration-150 hover:bg-[#f2f2f2] active:scale-[0.98] disabled:opacity-60">
                {busy === 'google' ? <Loader2 size={18} className="animate-spin" /> : <GoogleLogo />}
                Continue with Google
              </button>

              <div className="my-5 flex items-center gap-3 text-xs text-ink-500"><div className="h-px flex-1 bg-white/10" />or with email<div className="h-px flex-1 bg-white/10" /></div>
            </>
          )}

          <form onSubmit={submit} className={`space-y-4 ${mode === 'reset' ? 'mt-7' : ''}`} key={`f-${shake}`}>
            {mode === 'register' && (
              <div className="animate-in"><Field icon={User} label="Name"><input className={inputCls} autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
            )}
            <Field icon={Mail} label="Email">
              <input className={inputCls} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            {mode !== 'reset' && (
              <Field icon={Lock} label="Password">
                <input className={inputCls} type={showPw ? 'text' : 'password'} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder={mode === 'register' ? 'At least 6 characters' : '••••••••'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-2 flex h-9 w-9 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-ink-700 hover:text-ink-100" aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </Field>
            )}
            {mode === 'register' && password && (
              <div className="animate-fade -mt-1 flex items-center gap-2">
                <div className="flex flex-1 gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i < Math.max(1, s) ? sColors[s] : 'bg-ink-700'}`} />)}</div>
                <span className="w-16 text-right text-xs text-ink-400">{sLabel}</span>
              </div>
            )}
            {mode === 'register' && (
              <div className="animate-in">
                <Field icon={Lock} label="Confirm password">
                  <input className={inputCls} type={showPw ? 'text' : 'password'} autoComplete="new-password" placeholder="Repeat password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
                  {confirm && <span className={`absolute right-4 transition-colors ${confirm === password ? 'text-up' : 'text-ink-500'}`}><Check size={18} /></span>}
                </Field>
              </div>
            )}

            {mode !== 'reset' && (
              <div className="flex items-center justify-between pt-1">
                <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm text-ink-300">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-md border transition-all duration-150 ${remember ? 'border-gold-500 bg-gold-500 text-ink-950' : 'border-ink-500 bg-transparent'}`}>
                    {remember && <Check size={14} strokeWidth={3} />}
                  </span>
                  <input type="checkbox" className="sr-only" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  Remember this device
                </label>
                {mode === 'signin' && <button type="button" className="text-sm text-gold-400 transition-colors hover:text-gold-300" onClick={() => setMode('reset')}>Forgot password?</button>}
              </div>
            )}

            {error && <div className="animate-shake rounded-xl border border-down/30 bg-down/10 px-4 py-3 text-sm text-down">{error}</div>}
            {info && <div className="animate-in rounded-xl border border-up/30 bg-up/10 px-4 py-3 text-sm text-up">{info}</div>}

            <button type="submit" disabled={!!busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-gold-400 to-gold-500 text-[15px] font-semibold text-ink-950 shadow-[0_1px_0_rgba(255,255,255,0.3)_inset,0_10px_30px_-10px_rgba(212,167,44,0.6)] transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-60">
              {busy === 'email' && <Loader2 size={18} className="animate-spin" />}
              {mode === 'signin' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}
            </button>
          </form>

          {mode !== 'reset' && (
            <p className="mt-6 text-center text-sm text-ink-400">
              {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
              <button className="font-medium text-gold-400 transition-colors hover:text-gold-300" onClick={() => setMode(mode === 'signin' ? 'register' : 'signin')}>{mode === 'signin' ? 'Create an account' : 'Sign in'}</button>
            </p>
          )}
          <p className="mt-8 text-center text-xs leading-relaxed text-ink-500">With “Remember this device” on, you stay signed in on this device until you sign out.</p>
        </div>
      </main>
    </div>
  );
}
