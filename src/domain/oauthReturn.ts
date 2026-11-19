/**
 * Retour de la connexion Google (flux PKCE) : Supabase ajoute `?code=…` (ou `?error=…`) à l'adresse de l'application,
 * avant le `#/…` du routeur. Une fois la session établie, on retire ces paramètres pour qu'un rechargement ne rejoue pas
 * l'échange ; un refus ou une erreur est gardé le temps de l'afficher sur l'écran de connexion.
 */
const AUTH_PARAMS = ['code', 'state', 'error', 'error_code', 'error_description'];
export const OAUTH_ERROR_KEY = 'immozen:oauth-erreur';

export function stripOAuthParams(href: string): { url: string; changed: boolean; error: string | null } {
  const u = new URL(href);
  const changed = AUTH_PARAMS.some((k) => u.searchParams.has(k));
  const code = u.searchParams.get('error');
  const desc = u.searchParams.get('error_description');
  for (const k of AUTH_PARAMS) u.searchParams.delete(k);
  return { url: u.toString(), changed, error: code || desc ? oauthErrorMessage(code ?? '', desc ?? '') : null };
}

/** Message en français pour les cas courants (annulation, compte refusé, fournisseur non activé). */
export function oauthErrorMessage(code: string, description: string): string {
  const all = `${code} ${description}`;
  if (/access_denied|cancel/i.test(all)) return 'Connexion avec Google annulée.';
  if (/provider is not enabled|unsupported provider/i.test(all)) return 'La connexion avec Google n’est pas encore activée.';
  return `La connexion avec Google a échoué : ${(description || code).replace(/\+/g, ' ')}`;
}

/** Message d'erreur laissé par le dernier retour de Google, lu une seule fois. */
export function takeOAuthError(): string | null {
  try {
    const m = sessionStorage.getItem(OAUTH_ERROR_KEY);
    if (m) sessionStorage.removeItem(OAUTH_ERROR_KEY);
    return m;
  } catch { return null; }
}
