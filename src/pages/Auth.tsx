import { useState, type FormEvent } from 'react';
import { describeError } from '../data/repo.ts';
import { useStore } from '../data/store.tsx';
import { Button, TextInput } from '../ui/components.tsx';
import { navigate } from '../ui/router.ts';

type Mode = 'login' | 'signup' | 'reset';

export function AuthPage() {
  const { repo } = useStore();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'login') await repo.signIn(email.trim(), password);
      else if (mode === 'signup') {
        const r = await repo.signUp(email.trim(), password);
        if (r === 'confirm_email') setMessage({ text: 'Compte créé. Ouvrez le lien de confirmation reçu par e-mail, puis connectez-vous.', tone: 'ok' });
      } else {
        await repo.requestPasswordReset(email.trim());
        setMessage({ text: 'Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d’être envoyé.', tone: 'ok' });
      }
    } catch (err) {
      setMessage({ text: describeError(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-panel">
        <div className="auth-brand">
          <svg viewBox="0 0 32 32" aria-hidden="true" className="brand-mark"><path d="M4 17 16 6l12 11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 26h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"/><circle cx="16" cy="19" r="2.4" fill="currentColor"/></svg>
          <span>Immo-Zen</span>
        </div>
        <h1 className="auth-title">Prospectez, investissez et gérez vos locations sereinement.</h1>
        <p className="muted">Vos biens, simulations et contacts, enregistrés en ligne et accessibles depuis tous vos appareils.</p>
      </div>
      <form className="auth-form" onSubmit={submit} noValidate={false}>
        <h2>{mode === 'login' ? 'Connexion' : mode === 'signup' ? 'Créer un compte' : 'Mot de passe oublié'}</h2>
        <TextInput label="Adresse e-mail" type="email" required autoComplete="email" value={email} onChange={setEmail} />
        {mode !== 'reset' && (
          <TextInput label="Mot de passe" type="password" required value={password} onChange={setPassword}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            hint={mode === 'signup' ? '10 caractères minimum.' : undefined} />
        )}
        {message && <p className={message.tone === 'error' ? 'form-error' : 'form-ok'} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
        <Button type="submit" variant="primary" disabled={busy || !email || (mode !== 'reset' && password.length < (mode === 'signup' ? 10 : 1))}>
          {busy ? 'Patientez…' : mode === 'login' ? 'Se connecter' : mode === 'signup' ? 'Créer mon compte' : 'Recevoir le lien'}
        </Button>
        <div className="auth-links">
          {mode !== 'login' && <button type="button" className="link" onClick={() => setMode('login')}>J’ai déjà un compte</button>}
          {mode === 'login' && <button type="button" className="link" onClick={() => setMode('reset')}>Mot de passe oublié</button>}
          {mode === 'login' && <button type="button" className="link" onClick={() => setMode('signup')}>Créer un compte</button>}
        </div>
        <p className="muted small">Les offres d’abonnement se consultent dans « Mon abonnement », une fois connecté.</p>
      </form>
    </div>
  );
}

export function NewPasswordPage() {
  const { repo, notify } = useStore();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await repo.updatePassword(password);
      notify('Mot de passe modifié.');
      navigate('/');
    } catch (err) {
      setError(describeError(err));
    }
  }
  return (
    <form className="auth-form standalone" onSubmit={submit}>
      <h2>Nouveau mot de passe</h2>
      <TextInput label="Nouveau mot de passe" type="password" required autoComplete="new-password" value={password} onChange={setPassword} hint="10 caractères minimum." />
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit" variant="primary" disabled={password.length < 10}>Enregistrer le mot de passe</Button>
    </form>
  );
}
