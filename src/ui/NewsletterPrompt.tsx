import { useEffect, useState } from 'react';
import { useStore } from '../data/store.tsx';
import { describeError } from '../data/repo.ts';
import { MARKETING_CONSENT } from '../domain/legal.ts';
import { Button } from './components.tsx';

/**
 * Proposition unique de la lettre d'information, pour un compte créé par « Continuer avec Google » depuis l'écran
 * Connexion (la case d'accord n'y figure pas). La réponse est gardée dans les préférences du compte (tous appareils).
 */
const ASKED_KEY = 'immozen:optin-propose';
const RECENT_DAYS = 30;

export function markNewsletterAsked() {
  try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* stockage indisponible */ }
}
function askedHere() {
  try { return localStorage.getItem(ASKED_KEY) === '1'; } catch { return false; }
}

export function shouldProposeNewsletter(args: { mode: string; providers?: string[]; createdAt?: string; answer: unknown; askedOnSignup: boolean; now?: number }): boolean {
  if (args.mode !== 'supabase' || args.answer !== undefined || args.askedOnSignup) return false;
  if (!args.providers?.includes('google') || !args.createdAt) return false;
  return (args.now ?? Date.now()) - new Date(args.createdAt).getTime() < RECENT_DAYS * 86_400_000;
}

export function NewsletterPrompt() {
  const { repo, session, data, saveSettings, notify } = useStore();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const prefs = (data.settings?.ui_prefs ?? {}) as Record<string, unknown>;
  const asked = askedHere();
  const loaded = !!data.settings && !!session;
  // case déjà proposée à l'inscription sur cet appareil : on le note dans le compte, sans rien afficher
  const noteSignup = loaded && asked && prefs.newsletter_prompt === undefined && repo.mode === 'supabase';
  useEffect(() => {
    if (noteSignup) void saveSettings({ ui_prefs: { ...prefs, newsletter_prompt: 'inscription' } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteSignup]);
  if (hidden || !loaded) return null;
  if (!shouldProposeNewsletter({ mode: repo.mode, providers: session!.providers, createdAt: session!.createdAt, answer: prefs.newsletter_prompt, askedOnSignup: asked })) return null;

  async function answer(yes: boolean) {
    setBusy(true);
    try {
      if (yes) await repo.subscribeNewsletter(MARKETING_CONSENT);
      setHidden(true);
      await saveSettings({ ui_prefs: { ...prefs, newsletter_prompt: yes ? 'oui' : 'non' } });
      if (yes) notify('Merci ! Confirmez votre inscription depuis l’e-mail que vous venez de recevoir.');
    } catch (e) {
      notify(describeError(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="note newsletter-prompt" aria-labelledby="newsletter-prompt-title">
      <p id="newsletter-prompt-title"><strong>Bienvenue sur Immo-Zen ! Recevoir nos conseils par e-mail ?</strong></p>
      <p className="small">{MARKETING_CONSENT}</p>
      <div className="row">
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void answer(true)}>Oui, j’accepte</Button>
        <Button size="sm" disabled={busy} onClick={() => void answer(false)}>Non merci</Button>
      </div>
    </section>
  );
}
