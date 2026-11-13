/**
 * E-mails de la séquence de bienvenue des inscrits du site, en version HTML illustrée
 * (bandeau, captures de l'application, boutons). La version texte reste celle de la file (body_text).
 * Module sans dépendance : testé sous Node, utilisé par la fonction « daily ».
 */

export interface WelcomeData {
  step: 1 | 2 | 3;
  /** Lien de désinscription de l'inscrit (obligatoire). */
  unsub: string;
  /** Étape 1 : demande d'origine (guide, checklist, lettre, essai, calcul-…). */
  source?: string;
  /** Étape 1 : lien du document ou du calcul demandé. */
  doc_url?: string;
  /** Étape 1 : alertes enregistrées (phrases courtes). */
  alerts?: string[];
}

const SITE = 'https://immo-zen.fr';
export const LINKEDIN = 'https://www.linkedin.com/company/immo-zen-investissement/';
const C = { sapin: '#1f4a45', sapinDark: '#16352f', ink: '#18322f', muted: '#4a5a57', lichen: '#e3ebe5', line: '#d8e0dc', paper: '#f3f6f4', gold: '#a8771f', goldBg: '#fbf3e2', red: '#a33a2b' };
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = 'Arial,Helvetica,sans-serif';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u: string | undefined, fallback: string) => (u && /^https:\/\/[^\s"<>]+$/.test(u) ? u : fallback);

const img = (name: string, alt: string) =>
  `<img src="${SITE}/img/email/${name}.jpg" width="504" alt="${esc(alt)}" style="display:block;width:100%;max-width:504px;height:auto;border:0;border-radius:8px;">`;

function button(label: string, href: string, tone: 'sapin' | 'gold' = 'sapin'): string {
  const bg = tone === 'gold' ? C.gold : C.sapin;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;"><tr><td style="border-radius:8px;background:${bg};">
<a href="${esc(href)}" style="display:inline-block;padding:14px 26px;font-family:${SANS};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}&nbsp;&rarr;</a>
</td></tr></table>`;
}

const p = (html: string, extra = '') => `<p style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.ink};${extra}">${html}</p>`;
const h2 = (t: string) => `<h2 style="margin:6px 0 12px;font-family:${SERIF};font-size:21px;line-height:1.3;color:${C.sapin};">${t}</h2>`;
const section = (inner: string, pad = '22px 28px') => `<tr><td style="padding:${pad};">${inner}</td></tr>`;
const link = (label: string, href: string) => `<a href="${esc(href)}" style="color:${C.sapin};font-weight:bold;">${label}</a>`;

/** Ligne d'avantage : pastille + titre + texte. */
function benefit(icon: string, title: string, text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr>
<td width="44" valign="top"><div style="width:34px;height:34px;line-height:34px;text-align:center;border-radius:17px;background:${C.lichen};font-size:17px;">${icon}</div></td>
<td valign="top" style="font-family:${SANS};font-size:15px;line-height:1.5;color:${C.ink};"><strong>${title}</strong><br><span style="color:${C.muted};">${text}</span></td>
</tr></table>`;
}

/** Coche verte + texte. */
const check = (text: string) =>
  `<tr><td width="28" valign="top" style="font-family:${SANS};font-size:16px;font-weight:bold;color:${C.sapin};padding:3px 0;">&#10003;</td><td style="font-family:${SANS};font-size:15px;line-height:1.5;color:${C.ink};padding:3px 0;">${text}</td></tr>`;

function hero(kicker: string, title: string, subtitle: string): string {
  return `<tr><td style="background:${C.sapin};padding:30px 28px 28px;">
<div style="font-family:${SANS};font-size:12px;letter-spacing:2px;font-weight:bold;color:#cfe0d8;text-transform:uppercase;margin-bottom:10px;">${kicker}</div>
<div style="font-family:${SERIF};font-size:30px;line-height:1.2;font-weight:bold;color:#ffffff;margin-bottom:10px;">${title}</div>
<div style="font-family:${SANS};font-size:16px;line-height:1.5;color:#e3ebe5;">${subtitle}</div>
</td></tr>`;
}

function signature(ps?: string): string {
  return section(
    p('À très vite,<br><strong>David</strong><br><span style="color:' + C.muted + ';">Fondateur d’Immo-Zen</span>', 'margin:0;') +
      (ps ? p(`<em>P.-S. ${ps}</em>`, `margin:14px 0 0;color:${C.muted};font-size:14px;`) : ''),
    '6px 28px 24px',
  );
}

function shell(subject: string, logo: string, rows: string, unsub: string, preheader: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px 10px;background:${C.paper};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.paper};">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid ${C.line};border-radius:10px;overflow:hidden;">
<tr><td style="padding:16px 28px;background:${C.sapinDark};"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:10px;vertical-align:middle;"><img src="${esc(logo)}" width="30" height="30" alt="" style="display:block;border:0;border-radius:6px;"></td>
<td style="vertical-align:middle;font-family:${SERIF};font-size:20px;font-weight:bold;color:#ffffff;">Immo-Zen</td>
</tr></table></td></tr>
${rows}
<tr><td style="padding:18px 28px;border-top:1px solid ${C.line};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="52" valign="middle"><a href="${LINKEDIN}"><img src="${esc(logo)}" width="40" height="40" alt="Immo-Zen" style="display:block;border:0;border-radius:8px;"></a></td>
<td valign="middle" style="font-family:${SANS};font-size:14px;line-height:1.45;color:${C.ink};"><strong>Suivez Immo-Zen sur LinkedIn</strong><br><span style="color:${C.muted};">Conseils, nouveautés et coulisses du projet.</span></td>
<td valign="middle" align="right"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#0a66c2;"><a href="${LINKEDIN}" style="display:inline-block;padding:9px 14px;white-space:nowrap;font-family:${SANS};font-size:13px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">Suivre la page</a></td></tr></table></td>
</tr></table></td></tr>
<tr><td style="padding:16px 28px 20px;background:${C.paper};border-top:1px solid ${C.line};font-family:${SANS};font-size:12px;line-height:1.55;color:${C.muted};">
Vous recevez cet e-mail parce que vous avez accepté de recevoir les conseils et offres d’Immo-Zen sur immo-zen.fr.
Ce n’est pas vous, ou vous changez d’avis ? <a href="${esc(unsub)}" style="color:${C.muted};">Se désinscrire en un clic</a>.<br>
Une question ? Répondez à cet e-mail ou écrivez à <a href="mailto:contact@immo-zen.fr" style="color:${C.muted};">contact@immo-zen.fr</a>.
</td></tr>
</table></td></tr></table></body></html>`;
}

const DOCS: Record<string, { kicker: string; title: string; card: string; button: string; icon: string }> = {
  guide: { kicker: 'Votre guide est prêt', title: 'Achetez en sachant exactement où vous mettez les pieds.', card: 'Les 10 vérifications avant d’acheter un bien locatif', button: 'Télécharger le guide (PDF)', icon: '&#128218;' },
  checklist: { kicker: 'Votre checklist est prête', title: 'Une mise en location sans oubli, du bail à la première quittance.', card: 'La checklist de mise en location, à imprimer', button: 'Télécharger la checklist (PDF)', icon: '&#9989;' },
  calcul: { kicker: 'Votre calcul est sauvegardé', title: 'Vos chiffres vous attendent, à rouvrir quand vous voulez.', card: 'Votre calcul, avec les valeurs que vous avez saisies', button: 'Rouvrir mon calcul', icon: '&#129518;' },
};

function step1(d: WelcomeData): { rows: string; preheader: string } {
  const src = d.source ?? 'lettre';
  const docKey = src.startsWith('calcul-') ? 'calcul' : src;
  const doc = DOCS[docKey];
  const docUrl = safeUrl(d.doc_url, SITE);
  let rows = doc
    ? hero(doc.kicker, doc.title, 'Et bienvenue chez Immo-Zen : vous êtes inscrit à notre lettre, pour investir et gérer vos locations l’esprit tranquille.')
    : hero('Bienvenue chez Immo-Zen', 'Investir et louer, l’esprit tranquille.', 'Votre inscription est faite : rien d’autre à faire. Voici ce qui vous attend.');
  if (doc) {
    rows += section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.lichen};border-radius:10px;"><tr><td style="padding:20px 22px;">
<div style="font-size:26px;line-height:1;margin-bottom:8px;">${doc.icon}</div>
<div style="font-family:${SERIF};font-size:18px;font-weight:bold;color:${C.sapin};margin-bottom:12px;">${doc.card}</div>
${button(doc.button, docUrl)}
${docKey === 'calcul' ? `<div style="font-family:${SANS};font-size:12px;color:${C.muted};margin-top:8px;">Estimation indicative, pas un conseil financier ou fiscal.</div>` : ''}
</td></tr></table>`, '24px 28px 8px');
  }
  if (d.alerts?.length) {
    rows += section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:10px;"><tr><td style="padding:14px 18px;font-family:${SANS};font-size:14px;line-height:1.5;color:${C.ink};">
<strong>&#128276; Alerte enregistrée</strong><br>${d.alerts.map(esc).join('<br>')}</td></tr></table>`, '12px 28px 4px');
  }
  rows += section(
    h2('Ce que vous allez recevoir') +
      p('Une lettre par mois, pas plus. Courte, concrète, pensée pour les propriétaires bailleurs :', 'color:' + C.muted + ';') +
      benefit('&#128240;', 'L’actualité qui compte', 'Loyers, encadrement, fiscalité : ce qui change pour vous, expliqué simplement.') +
      benefit('&#129518;', 'Un calcul concret', 'Un cas chiffré à refaire avec vos propres chiffres, en une minute.') +
      benefit('&#128161;', 'Un conseil applicable tout de suite', 'Pour gagner du temps et éviter les erreurs qui coûtent cher.'),
  );
  rows += section(
    h2('Passez à l’action dès maintenant') +
      p('Un bien en vue ? Le simulateur vous dit en une minute s’il vous coûtera ou vous rapportera de l’argent chaque mois, avant de signer.') +
      img('simulation', 'Le simulateur de rentabilité Immo-Zen') +
      `<div style="height:14px;"></div>` +
      button('Tester un bien dans le simulateur', `${SITE}/outils/simulateur-cash-flow.html`) +
      p(`Déjà propriétaire ? ${link('Calculez la révision de votre loyer', `${SITE}/outils/revision-loyer-irl.html`)} avec le dernier indice publié.`, 'margin:14px 0 0;font-size:14px;'),
    '8px 28px 18px',
  );
  rows += section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.goldBg};border-radius:10px;"><tr><td style="padding:16px 20px;font-family:${SANS};font-size:14px;line-height:1.55;color:${C.ink};">
<strong>Et quand vous voulez aller plus loin :</strong> Immo-Zen gère vos loyers, vos quittances et prépare votre déclaration. ${link('Essayez 30 jours gratuitement, sans carte bancaire', `${SITE}/app/`)}.
</td></tr></table>`, '0 28px 18px');
  rows += signature('Une question sur votre projet ? Répondez simplement à cet e-mail, je lis tout.');
  return { rows, preheader: doc ? `${doc.card} : votre lien est à l’intérieur.` : 'Votre inscription est faite : voici ce qui vous attend.' };
}

function step2(): { rows: string; preheader: string } {
  let rows = hero('Vos économies', 'Une agence vous coûterait environ 1&nbsp;070&nbsp;€ par an.', 'Pour un seul logement loué 800&nbsp;€ par mois. Et si vous gardiez cet argent ?');
  const col = (bg: string, border: string, label: string, amount: string, amountColor: string, sub: string) =>
    `<td width="50%" valign="top" style="padding:0 5px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border:1px solid ${border};border-radius:10px;"><tr><td style="padding:16px 14px;text-align:center;font-family:${SANS};">
<div style="font-size:13px;font-weight:bold;color:${C.muted};text-transform:uppercase;letter-spacing:1px;">${label}</div>
<div style="font-family:${SERIF};font-size:30px;font-weight:bold;color:${amountColor};margin:8px 0 6px;">${amount}</div>
<div style="font-size:13px;line-height:1.4;color:${C.muted};">${sub}</div></td></tr></table></td>`;
  rows += section(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
${col('#ffffff', C.line, 'Agence', '≈&nbsp;1&nbsp;070&nbsp;€', C.red, 'par an pour 1 logement<br>(gestion + relocation)')}
${col(C.lichen, C.lichen, 'Immo-Zen', '69&nbsp;€', C.sapin, 'par an jusqu’à 3 biens<br>(offre fondateurs)')}
</tr></table>` +
      p('Agence : 8,4&nbsp;% TTC des loyers et un changement de locataire tous les 3 ans. Immo-Zen : formule Essentiel en annuel, −30&nbsp;% à vie pour les 300 premiers abonnés. Estimation indicative, avant impôts.', `margin:12px 0 0;font-size:12px;color:${C.muted};text-align:center;`),
    '24px 23px 10px',
  );
  rows += section(
    h2('Ce que vous payez vraiment, c’est le suivi') +
      p('Une agence facture surtout du temps passé à suivre vos locations. Immo-Zen le prépare pour vous :') +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
${check('Les <strong>échéances</strong> de chaque bail, suivies automatiquement')}
${check('Les <strong>loyers encaissés</strong>, rapprochés chaque mois')}
${check('Les <strong>quittances</strong>, générées et envoyées en PDF')}
${check('Les <strong>relances d’impayés</strong>, prêtes à partir')}
${check('La <strong>révision annuelle du loyer</strong>, calculée avec le bon indice')}
</table>` +
      img('loyers', 'Le suivi des loyers dans Immo-Zen') +
      p('Et vous gardez la main : <strong>aucune relance ne part à vos locataires sans votre accord.</strong>', 'margin:14px 0 0;'),
  );
  rows += section(
    p('Faites le calcul avec <strong>vos</strong> loyers, en 30 secondes :', 'margin:0 0 6px;') +
      button('Calculer mes économies', `${SITE}/#economies`) +
      p(`ou ${link('essayez Immo-Zen 30 jours gratuitement', `${SITE}/app/`)}, sans carte bancaire.`, 'margin:10px 0 0;font-size:14px;'),
    '4px 28px 18px',
  );
  rows += signature('Vous gérez déjà vous-même ? Alors vous connaissez le temps que ça prend. C’est exactement ce temps qu’Immo-Zen vous rend.');
  return { rows, preheader: 'Pour un logement à 800 € par mois : environ 1 070 € par an d’agence. Faites le calcul avec vos chiffres.' };
}

function step3(): { rows: string; preheader: string } {
  let rows = hero('Essai gratuit', '30 jours pour voir la différence.', 'Sans carte bancaire, sans engagement. Avec vos vrais biens.');
  const tile = (name: string, title: string, sub: string) =>
    `<td width="50%" valign="top" style="padding:0 6px 14px;">
<img src="${SITE}/img/email/${name}.jpg" width="240" alt="${esc(title)}" style="display:block;width:100%;max-width:240px;height:auto;border:0;border-radius:8px;">
<div style="font-family:${SERIF};font-size:16px;font-weight:bold;color:${C.sapin};margin:8px 0 2px;">${title}</div>
<div style="font-family:${SANS};font-size:13px;line-height:1.45;color:${C.muted};">${sub}</div></td>`;
  rows += section(
    h2('En quelques minutes, vous avez :') +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;"><tr>
${tile('baux-locataires', 'Vos biens et vos baux', 'Tout au même endroit, enfin.')}
${tile('loyers', 'Vos loyers rapprochés', 'Payé, en retard, partiel : vous savez.')}
</tr><tr>
${tile('quittance', 'Vos quittances', 'Générées et envoyées en un clic.')}
${tile('declaration', 'Votre déclaration', 'Les montants à reporter, prêts.')}
</tr></table>`,
    '24px 28px 4px',
  );
  rows += section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.goldBg};border:1px solid #ecd9b0;border-radius:10px;"><tr><td style="padding:18px 20px;text-align:center;font-family:${SANS};">
<div style="font-size:12px;letter-spacing:2px;font-weight:bold;color:${C.gold};text-transform:uppercase;">Offre fondateurs</div>
<div style="font-family:${SERIF};font-size:24px;font-weight:bold;color:${C.ink};margin:6px 0 4px;">−30&nbsp;% à vie</div>
<div style="font-size:14px;line-height:1.5;color:${C.muted};">sur l’abonnement annuel, réservé aux 300 premiers abonnés.<br>Dès 69&nbsp;€ par an.</div>
</td></tr></table>`, '4px 28px 14px');
  rows += section(
    `<div style="text-align:center;">${button('Démarrer mon essai gratuit', `${SITE}/app/`)}</div>`.replace('<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;">', '<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:6px auto 4px;">') +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;">
${check('Aucune carte bancaire demandée')}
${check('Vos données exportables à tout moment')}
${check('À la fin de l’essai, rien n’est supprimé')}
</table>`,
    '4px 28px 16px',
  );
  rows += signature('Besoin d’un coup de main pour démarrer ? Répondez à cet e-mail : je vous aide à saisir votre premier bien.');
  return { rows, preheader: '30 jours gratuits, sans carte bancaire. Et −30 % à vie pour les 300 premiers abonnés.' };
}

/** HTML illustré d'un e-mail de la séquence de bienvenue. */
export function renderWelcomeHtml(subject: string, data: WelcomeData, logo: string): string {
  if (!data || ![1, 2, 3].includes(data.step) || typeof data.unsub !== 'string' || !/^https:\/\//.test(data.unsub)) throw new Error('Données de bienvenue incomplètes.');
  const { rows, preheader } = data.step === 1 ? step1(data) : data.step === 2 ? step2() : step3();
  return shell(subject, logo, rows, data.unsub, preheader);
}
