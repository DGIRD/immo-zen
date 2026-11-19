import { useEffect, useState, type FormEvent } from 'react';
import { describeError } from '../data/repo.ts';
import { useStore } from '../data/store.tsx';
import { Button, Checkbox, Help, TextInput } from '../ui/components.tsx';
import { navigate } from '../ui/router.ts';
import { readInviteCode, rememberInviteCode } from '../domain/tenantPortal.ts';
import { takeOAuthError } from '../domain/oauthReturn.ts';
import { markNewsletterAsked } from '../ui/NewsletterPrompt.tsx';
import { editeurLine, MENTIONS_URL, CGU_URL, MARKETING_CONSENT } from '../domain/legal.ts';

type Mode = 'login' | 'signup' | 'reset';

export { MARKETING_CONSENT };

/** Logo « G » de Google pour le bouton de connexion (fichier g-logo.svg du paquet google-signin-button, partie vectorielle). */
function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <defs>
        <path id="iz-g-shape" d="M44.5,20H42h-8.2H24v8.5h11.8C34.7,33.9,30.1,37,24,37c-7.2,0-13-5.8-13-13s5.8-13,13-13c3.1,0,5.9,1.1,8.1,2.9l6.4-6.4C34.6,4.1,29.6,2,24,2C11.8,2,2,11.8,2,24s9.8,22,22,22c11,0,21-8,21-22C45,22.7,44.8,21.3,44.5,20z" />
        <clipPath id="iz-g-clip"><use href="#iz-g-shape" /></clipPath>
      </defs>
      <g clipPath="url(#iz-g-clip)">
        <polygon fill="#FBBC05" points="0,37 0,11 17,24" />
        <polygon fill="#EA4335" points="0,11 17,24 24,17.9 48,14 48,0 0,0" />
        <polygon fill="#34A853" points="0,37 30,14 37.9,15 48,0 48,48 0,48" />
        <polygon fill="#4285F4" points="48,48 17,24 13,21 48,11" />
      </g>
    </svg>
  );
}

export function AuthPage() {
  const { repo } = useStore();
  const invited = !!readInviteCode();
  const [mode, setMode] = useState<Mode>(invited ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [marketing, setMarketing] = useState(false);

  // refus ou erreur au retour de Google (l'adresse est nettoyée juste après l'échange du code)
  useEffect(() => {
    const show = () => { const m = takeOAuthError(); if (m) setMessage({ text: m, tone: 'error' }); };
    show();
    const id = setTimeout(show, 800);
    return () => clearTimeout(id);
  }, []);

  async function google() {
    setBusy(true);
    setMessage(null);
    try {
      rememberInviteCode(readInviteCode()); // l'invitation locataire survit à l'aller-retour chez Google
      if (mode === 'signup') markNewsletterAsked(); // la case a été proposée : pas de seconde proposition après le retour
      await repo.signInWithGoogle(mode === 'signup' && marketing && !invited ? { consentText: MARKETING_CONSENT } : null);
    } catch (err) {
      setMessage({ text: describeError(err), tone: 'error' });
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'login') await repo.signIn(email.trim(), password);
      else if (mode === 'signup') {
        const r = await repo.signUp(email.trim(), password, marketing && !invited ? { consentText: MARKETING_CONSENT } : null);
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
        <Help>Vos biens, simulations et contacts, enregistrés en ligne et accessibles depuis tous vos appareils.</Help>
      </div>
      <form className="auth-form" onSubmit={submit} noValidate={false}>
        <h2>{mode === 'login' ? 'Connexion' : mode === 'signup' ? 'Créer un compte' : 'Mot de passe oublié'}</h2>
        {invited && <p className="note" role="status">Invitation à votre espace locataire : créez votre compte (ou connectez-vous) avec l’adresse e-mail qui a reçu l’invitation. Votre espace s’ouvrira ensuite.</p>}
        {mode === 'signup' && !invited && (
          <>
            <Checkbox label={MARKETING_CONSENT} checked={marketing} onChange={setMarketing} />
            <p className="muted small">Facultatif, avec Google comme avec votre e-mail : sans cette case, vous ne recevez que les e-mails liés à votre compte. Désinscription en un clic dans chaque e-mail.</p>
          </>
        )}
        {mode !== 'reset' && repo.mode === 'supabase' && (
          <>
            <Button type="button" className="btn-google" disabled={busy} onClick={() => void google()}>
              {!busy && <GoogleMark />}{busy ? 'Patientez…' : 'Continuer avec Google'}
            </Button>
            <p className="muted small">En continuant, vous acceptez les <a href={CGU_URL} target="_blank" rel="noopener">conditions générales</a>.</p>
            <p className="auth-sep" aria-hidden="true"><span>ou avec votre e-mail</span></p>
          </>
        )}
        <TextInput label="Adresse e-mail" type="email" required autoComplete="email" value={email} onChange={setEmail} />
        {mode !== 'reset' && (
          <TextInput label="Mot de passe" type="password" required value={password} onChange={setPassword}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            hint={mode === 'signup' ? '10 caractères minimum.' : undefined} />
        )}
        {mode === 'signup' && repo.mode !== 'supabase' && (
          <p className="muted small">En créant votre compte, vous acceptez les <a href={CGU_URL} target="_blank" rel="noopener">conditions générales</a>.</p>
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
        <p className="muted small auth-legal">{editeurLine()} · <a href={MENTIONS_URL}>Mentions légales</a> · <a href={CGU_URL}>Conditions générales</a> · <a href={`${MENTIONS_URL}#confidentialite`}>Confidentialité</a></p>
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
