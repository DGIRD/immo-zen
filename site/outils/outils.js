/* Immo-Zen — calculettes gratuites du site vitrine (simulateur de cash-flow, plafond de loyer à Paris, révision IRL).
   Aucun appel réseau : tout est calculé dans le navigateur. Les champs gardent leurs valeurs dans l'adresse de la page
   pour pouvoir partager une simulation. */
(() => {
  const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const eur2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (x, d = 1) => `${(x * 100).toFixed(d).replace('.', ',')} %`;
  const num = (v) => {
    const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const $ = (id) => document.getElementById(id);
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };

  // Un clic dans un champ sélectionne la valeur d'exemple : la saisie la remplace directement.
  const selectOnFocus = (form) => form.querySelectorAll('input:not([type=checkbox]):not([type=date])').forEach((el) => {
    let justFocused = false;
    el.addEventListener('focus', () => { justFocused = true; requestAnimationFrame(() => el.select()); });
    el.addEventListener('mouseup', (e) => { if (justFocused) e.preventDefault(); justFocused = false; });
    el.addEventListener('blur', () => { justFocused = false; });
  });

  // Les valeurs du formulaire vont dans l'adresse (partage) et en reviennent au chargement.
  const syncUrl = (form) => {
    const params = new URLSearchParams(location.search);
    for (const el of form.elements) {
      if (!el.name || !params.has(el.name)) continue;
      if (el.type === 'checkbox') el.checked = params.get(el.name) === '1';
      else el.value = params.get(el.name);
    }
    return () => {
      const p = new URLSearchParams();
      for (const el of form.elements) if (el.name) p.set(el.name, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value);
      try { history.replaceState(null, '', `${location.pathname}?${p}`); } catch { /* aperçu sans historique */ }
    };
  };

  const wire = (form, update) => {
    if (!form) return;
    selectOnFocus(form);
    const save = syncUrl(form);
    const run = () => { update(new FormData(form)); save(); };
    form.addEventListener('input', run);
    form.addEventListener('change', run);
    form.addEventListener('submit', (e) => e.preventDefault());
    run();
    const share = form.parentElement.querySelector('[data-share]');
    share?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); share.textContent = 'Lien copié'; }
      catch { share.textContent = 'Copiez l’adresse de la page'; }
      setTimeout(() => { share.textContent = 'Copier le lien de cette simulation'; }, 2500);
    });
  };

  // ---------- 1. Simulateur de cash-flow
  const mensualite = (capital, tauxAnnuel, mois) => {
    if (capital <= 0) return 0;
    const t = tauxAnnuel / 12;
    return t > 0 ? capital * t / (1 - Math.pow(1 + t, -mois)) : capital / mois;
  };
  wire($('calc-cashflow'), (f) => {
    const prix = num(f.get('prix')), notaire = num(f.get('notaire')) / 100, travaux = num(f.get('travaux')), apport = num(f.get('apport'));
    const taux = num(f.get('taux')) / 100, annees = Math.min(30, Math.max(1, num(f.get('duree')) || 20)), assurance = num(f.get('assurance')) / 100;
    const loyer = num(f.get('loyer')), vacance = Math.min(12, num(f.get('vacance'))), tf = num(f.get('tf')), copro = num(f.get('copro'));
    const pno = num(f.get('pno')), gestion = num(f.get('gestion')) / 100, entretien = num(f.get('entretien'));
    const cout = prix * (1 + notaire) + travaux;
    const emprunt = Math.max(0, cout - apport);
    const n = annees * 12;
    const credit = mensualite(emprunt, taux, n);
    const assuranceMois = emprunt * assurance / 12;
    const loyersAn = loyer * (12 - vacance);
    const chargesAn = tf + copro + pno + entretien + loyersAn * gestion;
    const cf = (loyersAn - chargesAn) / 12 - credit - assuranceMois;
    // capital remboursé la première année
    let restant = emprunt, capital1 = 0;
    for (let m = 0; m < Math.min(12, n); m++) {
      const interets = restant * taux / 12, amort = credit - interets;
      capital1 += amort; restant -= amort;
    }
    const brut = cout > 0 ? loyer * 12 / cout : 0;
    const net = cout > 0 ? (loyersAn - chargesAn) / cout : 0;
    set('cf-result', `${cf >= 0 ? '+' : '−'} ${eur.format(Math.abs(Math.round(cf)))}`);
    $('cf-result')?.classList.toggle('neg', cf < 0);
    set('cf-verdict', cf >= 0
      ? `Le bien s'autofinance : il dégage environ ${eur.format(Math.round(cf))} par mois avant impôts.`
      : `Effort d'épargne d'environ ${eur.format(Math.abs(Math.round(cf)))} par mois avant impôts.`);
    set('cf-credit', `${eur.format(Math.round(credit + assuranceMois))} / mois`);
    set('cf-emprunt', eur.format(Math.round(emprunt)));
    set('cf-cout', eur.format(Math.round(cout)));
    set('cf-brut', pct(brut));
    set('cf-net', pct(net));
    set('cf-capital', `${eur.format(Math.round(capital1))} la 1re année`);
    set('cf-enrichi', `${cf + capital1 / 12 >= 0 ? '+' : '−'} ${eur.format(Math.abs(Math.round(cf + capital1 / 12)))} / mois`);
    set('cf-charges', `${eur.format(Math.round(chargesAn / 12))} / mois`);
    set('cf-cta-text', cf < 0
      ? 'Découvrez comment améliorer ce résultat : Immo-Zen compare le prix aux ventes réelles du quartier pour négocier, vérifie le loyer de marché et teste l’effet de l’apport, de la durée ou du meublé.'
      : 'Le bien tient la route. Avant l’offre, Immo-Zen vérifie le prix avec les ventes réelles du quartier et le loyer de marché ; après l’achat, il gère échéances, quittances et déclaration.');
  });

  // ---------- 2. Plafond de loyer à Paris
  const P = window.PLAFONDS_PARIS;
  const arr = $('pl-arr'), qsel = $('pl-quartier');
  if (P && arr && qsel) {
    const fill = () => {
      const a = Number(arr.value), keep = qsel.value;
      qsel.innerHTML = P.quartiers.filter(([n]) => Math.ceil(n / 4) === a)
        .map(([n, nom]) => `<option value="${n}">${nom}</option>`).join('');
      if ([...qsel.options].some((o) => o.value === keep)) qsel.value = keep;
    };
    const params = new URLSearchParams(location.search);
    if (params.has('arr')) arr.value = params.get('arr');
    fill();
    arr.addEventListener('change', fill);
  }
  wire($('calc-plafond'), (f) => {
    if (!P) return;
    const q = P.quartiers.find(([n]) => n === Number(f.get('quartier')));
    if (!q) return;
    const pieces = String(Math.min(4, Math.max(1, num(f.get('pieces')) || 1)));
    const epoque = Number(f.get('epoque')), meuble = f.get('type') === 'meuble';
    const surface = num(f.get('surface')), loyer = num(f.get('loyer'));
    const v = P.caps[String(q[2])][pieces][epoque];
    const [ref, maj, min] = meuble ? v.slice(3) : v.slice(0, 3);
    const plafond = maj * surface;
    set('pl-result', eur.format(Math.round(plafond)));
    set('pl-ref-m2', `${eur2.format(ref)} / m²`);
    set('pl-maj-m2', `${eur2.format(maj)} / m²`);
    set('pl-min-m2', `${eur2.format(min)} / m²`);
    set('pl-ref', eur.format(Math.round(ref * surface)));
    set('pl-min', eur.format(Math.round(min * surface)));
    set('pl-quartier-nom', `${q[1]} (quartier n° ${q[0]}, secteur ${q[2]})`);
    const verdict = $('pl-verdict');
    if (verdict) {
      verdict.classList.remove('ok', 'ko');
      if (!loyer) verdict.textContent = 'Indiquez un loyer pour le comparer au plafond.';
      else if (loyer <= plafond) {
        verdict.textContent = `Le loyer de ${eur.format(loyer)} respecte le plafond (marge de ${eur.format(Math.round(plafond - loyer))}).`;
        verdict.classList.add('ok');
      } else {
        verdict.textContent = `Le loyer de ${eur.format(loyer)} dépasse le plafond de ${eur.format(Math.round(loyer - plafond))}. Au-delà, seul un complément de loyer justifié par des caractéristiques exceptionnelles est possible.`;
        verdict.classList.add('ko');
      }
    }
  });

  // ---------- 3. Révision du loyer (IRL)
  const dateIrl = document.querySelector('#calc-irl input[name=date]');
  if (dateIrl && !dateIrl.value && !new URLSearchParams(location.search).has('date')) dateIrl.value = new Date().toISOString().slice(0, 10);
  const IRL = window.IRL_VALUES || {};
  // Publication INSEE : T1 mi-avril, T2 mi-juillet, T3 mi-octobre, T4 mi-janvier de l'année suivante.
  const publication = (annee, t) => t === 4 ? `${annee + 1}-01-15` : `${annee}-${String(1 + 3 * t).padStart(2, '0')}-15`;
  const dernierPublie = (t, iso) => {
    const a = Number(iso.slice(0, 4));
    for (let y = a; y >= a - 2; y--) if (publication(y, t) <= iso) return y;
    return a - 2;
  };
  wire($('calc-irl'), (f) => {
    const loyer = num(f.get('loyer')), t = Number(f.get('trimestre')), date = f.get('date') || new Date().toISOString().slice(0, 10);
    const dpe = f.get('dpe') === 'on';
    const y = dernierPublie(t, date);
    const nouveau = IRL[`${y}-T${t}`], ancien = IRL[`${y - 1}-T${t}`];
    const out = $('irl-out');
    if (dpe) {
      set('irl-result', eur2.format(loyer));
      set('irl-verdict', 'Logement classé F ou G : la révision est interdite (gel des loyers depuis le 24 août 2022 en métropole). Le loyer reste inchangé.');
      out?.classList.add('blocked');
      set('irl-detail', ''); set('irl-hausse', '—'); set('irl-indices', '—');
      const lettre = $('irl-lettre'); if (lettre) lettre.value = '';
      return;
    }
    out?.classList.remove('blocked');
    if (!nouveau || !ancien) {
      set('irl-result', '—');
      set('irl-verdict', `L'indice du ${t}e trimestre ${y} n'est pas encore dans notre tableau. Saisissez une date plus ancienne ou consultez insee.fr.`);
      return;
    }
    const neuf = Math.round(loyer * nouveau / ancien * 100) / 100;
    const label = (yy) => `${t === 1 ? '1er' : `${t}e`} trimestre ${yy}`;
    set('irl-result', eur2.format(neuf));
    set('irl-verdict', `Nouveau loyer hors charges maximum à partir du ${new Date(date).toLocaleDateString('fr-FR')}.`);
    set('irl-hausse', `+ ${eur2.format(neuf - loyer)} / mois (${pct(nouveau / ancien - 1, 2)})`);
    set('irl-indices', `${String(nouveau).replace('.', ',')} (${label(y)}) / ${String(ancien).replace('.', ',')} (${label(y - 1)})`);
    set('irl-detail', `${eur2.format(loyer)} × ${String(nouveau).replace('.', ',')} ÷ ${String(ancien).replace('.', ',')} = ${eur2.format(neuf)}`);
    const lettre = $('irl-lettre');
    if (lettre) lettre.value = `Objet : révision annuelle du loyer

Madame, Monsieur,

Conformément à la clause de révision prévue au bail, je vous informe que le loyer hors charges est révisé à compter du ${new Date(date).toLocaleDateString('fr-FR')}, selon l'indice de référence des loyers publié par l'INSEE.

Loyer actuel hors charges : ${eur2.format(loyer)}
Indice de référence du ${label(y)} : ${String(nouveau).replace('.', ',')}
Indice du ${label(y - 1)} : ${String(ancien).replace('.', ',')}
Nouveau loyer hors charges : ${eur2.format(loyer)} × ${String(nouveau).replace('.', ',')} / ${String(ancien).replace('.', ',')} = ${eur2.format(neuf)}

Les charges restent inchangées. Le prochain avis d'échéance tiendra compte de ce nouveau montant.

Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.`;
  });
  $('irl-copier')?.addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText($('irl-lettre').value); e.target.textContent = 'Lettre copiée'; }
    catch { $('irl-lettre').select(); }
    setTimeout(() => { e.target.textContent = 'Copier la lettre'; }, 2500);
  });
})();
