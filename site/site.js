// Immo-Zen — site vitrine : menu mobile, calculateur, formulaire de contact.
(() => {
  // Ancienne version de l'application installée à la racine : on retire son service worker
  // pour que la racine affiche bien le site (l'application a le sien sous /app/).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => {
      if (!/\/app\/$/.test(new URL(r.scope).pathname)) r.unregister();
    })).catch(() => undefined);
  }

  document.documentElement.classList.add('js');

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  const btn = document.querySelector('.menu-btn');
  const nav = document.getElementById('nav');
  const closeMenu = () => { if (nav) nav.classList.remove('open'); if (btn) btn.setAttribute('aria-expanded', 'false'); };
  if (btn && nav) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });
    document.addEventListener('click', (e) => { if (nav.classList.contains('open') && !nav.contains(e.target)) closeMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { closeMenu(); btn.focus(); } });
  }

  // ---------- rubrique en cours dans le menu (accueil : ancres de la page)
  const anchorLinks = nav ? [...nav.querySelectorAll('a[href^="#"]')] : [];
  const sections = anchorLinks.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  if (sections.length) {
    const mark = () => {
      const y = window.scrollY + window.innerHeight * 0.35;
      let cur = null;
      for (const s of sections) if (s.offsetTop <= y) cur = s.id;
      // la section du formulaire de contact et les guides suivent « Tarifs » sans rubrique propre
      const last = sections[sections.length - 1];
      if (cur === last.id && y > last.offsetTop + last.offsetHeight) cur = null;
      anchorLinks.forEach((a) => {
        if (a.getAttribute('href') === `#${cur}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    };
    let raf = 0;
    window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; mark(); }); }, { passive: true });
    window.addEventListener('resize', mark);
    mark();
  }

  // ---------- captures de l'application : boutons précédent / suivant
  const shots = document.querySelector('.shots');
  if (shots) {
    const prev = document.querySelector('.shots-prev');
    const next = document.querySelector('.shots-next');
    const step = () => (shots.querySelector('li')?.getBoundingClientRect().width ?? 400) + 16;
    const sync = () => {
      if (prev) prev.disabled = shots.scrollLeft < 8;
      if (next) next.disabled = shots.scrollLeft + shots.clientWidth > shots.scrollWidth - 8;
    };
    prev?.addEventListener('click', () => shots.scrollBy({ left: -step(), behavior: 'smooth' }));
    next?.addEventListener('click', () => shots.scrollBy({ left: step(), behavior: 'smooth' }));
    shots.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  }

  // ---------- profils d'investisseur (onglets accessibles ; sans script, tous les profils s'affichent)
  const tabs = [...document.querySelectorAll('.profile-tabs [role="tab"]')];
  const select = (tab, focus) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (focus) tab.focus();
  };
  if (tabs.length) {
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t, false));
      t.addEventListener('keydown', (e) => {
        const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (k) { e.preventDefault(); select(tabs[(i + k + tabs.length) % tabs.length], true); }
        else if (e.key === 'Home') { e.preventDefault(); select(tabs[0], true); }
        else if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1], true); }
      });
    });
    select(tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0], false);
  }

  // ---------- économies de gestion (frais d'agence évités − abonnement Immo-Zen)
  const sv = document.getElementById('savings-calc');
  if (sv) {
    const eurS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
    const n = (v) => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
    const out = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    const run = () => {
      const f = new FormData(sv);
      const biens = Math.max(0, Math.round(n(f.get('biens')))), loyer = Math.max(0, n(f.get('loyer'))), taux = n(f.get('taux')) / 100;
      const relocation = f.get('relocation') ? biens * loyer / 3 : 0;
      const agence = biens * loyer * 12 * taux + relocation;
      const abo = biens === 0 ? 0 : biens <= 3 ? 99 : biens <= 10 ? 199 : 399;
      const eco = agence - abo;
      out('sv-agence', `${eurS.format(Math.round(agence))} / an`);
      out('sv-abo', `${eurS.format(abo)} / an`);
      out('sv-result', `${eco >= 0 ? '' : '−'}${eurS.format(Math.abs(Math.round(eco)))}`);
      out('sv-5ans', eurS.format(Math.round(eco * 5)));
    };
    sv.addEventListener('input', run);
    sv.addEventListener('change', run);
    sv.addEventListener('submit', (e) => e.preventDefault());
    sv.querySelectorAll('input[inputmode]').forEach((el) => el.addEventListener('focus', () => requestAnimationFrame(() => el.select())));
    run();
  }

  // ---------- calculateur
  const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const num = (v) => { const n = Number(String(v).replace(/[\s €%]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const calc = document.getElementById('calc');
  const out = document.getElementById('cf');
  const detail = document.getElementById('cf-detail');
  const verdict = document.getElementById('cf-verdict');
  function update() {
    const f = new FormData(calc);
    const prix = num(f.get('prix')), loyer = num(f.get('loyer')), apport = num(f.get('apport')), taux = num(f.get('taux')) / 100, charges = num(f.get('charges'));
    const annees = Math.min(30, Math.max(1, num(f.get('duree')) || 20));
    const cout = prix * 1.075;
    const emprunt = Math.max(0, cout - apport);
    const n = annees * 12, t = taux / 12;
    const mensualite = emprunt === 0 ? 0 : t === 0 ? emprunt / n : (emprunt * t) / (1 - Math.pow(1 + t, -n));
    const assurance = (emprunt * 0.003) / 12;
    const credit = mensualite + assurance;
    const cf = loyer - charges / 12 - credit;
    const rendement = cout > 0 ? (loyer * 12) / cout * 100 : 0;
    out.textContent = `${cf >= 0 ? '+' : '−'}${eur.format(Math.abs(Math.round(cf)))}`;
    out.classList.toggle('neg', cf < 0);
    if (verdict) verdict.textContent = cf >= 0
      ? 'Le loyer couvre le crédit et les charges : le bien s’autofinance, avant impôts.'
      : `Effort d’épargne d’environ ${eur.format(Math.abs(Math.round(cf)))} par mois : à négocier, à financer autrement, ou à assumer en connaissance de cause.`;
    detail.textContent = `Crédit ${eur.format(Math.round(credit))} / mois sur ${annees} ans pour ${eur.format(Math.round(emprunt))} empruntés · rendement brut ${rendement.toFixed(1).replace('.', ',')} %`;
    if (cta) {
      cta.hidden = false;
      ctaText.textContent = cf < 0
        ? 'Découvrez comment améliorer ce résultat : Immo-Zen compare le prix aux ventes réelles du quartier pour négocier, et teste l’effet de l’apport, de la durée, des travaux ou du meublé sur votre cash-flow.'
        : 'Bonne nouvelle ! Après l’achat, Immo-Zen vous fait gagner du temps sur la gestion : échéances créées automatiquement, quittances prêtes dès que le loyer est réglé, montants de la déclaration préparés.';
      ctaBtn.textContent = cf < 0 ? 'Améliorer ce résultat : essai gratuit 30 jours' : 'Essayer gratuitement 30 jours';
    }
  }
  const cta = document.getElementById('cf-cta');
  const ctaText = document.getElementById('cf-cta-text');
  const ctaBtn = document.getElementById('cf-cta-btn');
  if (calc) {
    calc.addEventListener('input', update);
    calc.addEventListener('change', update);
    // un clic dans un champ sélectionne la valeur d'exemple : la saisie la remplace directement
    calc.querySelectorAll('input').forEach((el) => {
      let justFocused = false;
      el.addEventListener('focus', () => { justFocused = true; requestAnimationFrame(() => el.select()); });
      el.addEventListener('mouseup', (e) => { if (justFocused) e.preventDefault(); justFocused = false; });
      el.addEventListener('blur', () => { justFocused = false; });
    });
    update();
  }

  // ---------- formulaire de contact → prospects commerciaux (Administration)
  const form = document.getElementById('contact');
  const msg = document.getElementById('contact-msg');
  const url = document.body.dataset.supabaseUrl;
  const key = document.body.dataset.supabaseKey;
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const say = (text, ok) => { msg.textContent = text; msg.className = `form-msg ${ok ? 'ok' : 'err'}`; };
    if (String(f.get('name') || '').trim().length < 2) return say('Indiquez votre nom.', false);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(f.get('email') || '').trim())) return say('Indiquez une adresse e-mail valide.', false);
    if (!url || url.startsWith('%') || !key || key.startsWith('%')) return say('Formulaire indisponible pour le moment : écrivez-nous à contact@immo-zen.fr.', false);
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const res = await fetch(`${url}/rest/v1/rpc/iz_submit_lead`, {
        method: 'POST',
        // clé publique « sb_publishable_… » : en-tête apikey seul (ce n'est pas un jeton JWT) ; ancienne clé anon (JWT) : aussi en Authorization
        headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_name: f.get('name'), p_email: f.get('email'), p_phone: f.get('phone') || null, p_message: f.get('message') || null, p_topic: [f.get('topic'), f.get('profile')].filter(Boolean).join(' · '), p_website: f.get('website') || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        console.error('Formulaire de contact :', res.status, j);
        return say(j.message && !/function|schema|jwt|permission|key/i.test(j.message) ? j.message
          : `Envoi impossible pour le moment (erreur ${res.status}). Écrivez-nous directement à contact@immo-zen.fr.`, false);
      }
      form.reset();
      say('Merci, votre demande est bien envoyée. Nous vous recontactons rapidement.', true);
    } catch {
      say('Connexion impossible. Vérifiez votre réseau et réessayez, ou écrivez-nous à contact@immo-zen.fr.', false);
    } finally {
      button.disabled = false;
    }
  });

  // ---------- inscriptions (calcul par e-mail, guide, checklist, lettre, alertes) → iz_subscribe
  const supa = { url: document.body.dataset.supabaseUrl, key: document.body.dataset.supabaseKey };
  const supaReady = () => supa.url && !supa.url.startsWith('%') && supa.key && !supa.key.startsWith('%');
  const rpc = (fn, body) => fetch(`${supa.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: supa.key, ...(supa.key.startsWith('eyJ') ? { Authorization: `Bearer ${supa.key}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // paramètres du calcul d'économies (accueil) : lus depuis l'adresse au chargement
  const savingsForm = document.getElementById('savings-calc');
  if (savingsForm && location.search) {
    const q = new URLSearchParams(location.search);
    for (const name of ['biens', 'loyer', 'taux']) if (q.has(name) && savingsForm.elements[name]) savingsForm.elements[name].value = q.get(name);
    if (q.has('relocation') && savingsForm.elements.relocation) savingsForm.elements.relocation.checked = q.get('relocation') === '1';
    savingsForm.dispatchEvent(new Event('input'));
  }
  const calcParams = (source) => {
    if (source === 'calcul-economies' && savingsForm) {
      const f = new FormData(savingsForm);
      return new URLSearchParams({ biens: f.get('biens') || '', loyer: f.get('loyer') || '', taux: f.get('taux') || '', relocation: f.get('relocation') ? '1' : '0' }).toString();
    }
    return source.startsWith('calcul-') ? location.search.replace(/^\?/, '') : null;
  };
  // rappel IRL : mois prérempli d'après la date de révision saisie dans l'outil
  const irlDate = document.querySelector('#calc-irl [name="date"]');
  const irlMonth = document.querySelector('.optin [name="irl_month"]');
  const syncMonth = () => { const m = /^\d{4}-(\d{2})/.exec(irlDate?.value || ''); if (m && irlMonth) irlMonth.value = String(Number(m[1])); };
  irlDate?.addEventListener('change', syncMonth);
  syncMonth();

  document.querySelectorAll('form.optin').forEach((form) => {
    const msg = form.querySelector('.form-msg');
    const say = (html, ok) => { msg.innerHTML = html; msg.className = `form-msg ${ok ? 'ok' : 'err'}`; };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const source = form.dataset.source;
      const email = String(f.get('email') || '').trim();
      const marketing = !!f.get('marketing');
      const irl = !!f.get('irl');
      const paris = !!f.get('paris');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say('Indiquez une adresse e-mail valide.', false);
      if (form.querySelector('[name="marketing"][data-required]') && !marketing) return say('Cochez la case pour recevoir la lettre.', false);
      const download = form.dataset.download ? ` <a href="${form.dataset.download}" target="_blank" rel="noopener">Ouvrir le document maintenant</a>.` : '';
      if (!supaReady()) return say(`Envoi indisponible pour le moment.${download}`, false);
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        const res = await rpc('iz_subscribe', {
          p_email: email, p_source: source, p_marketing: marketing,
          p_consent_text: marketing ? form.querySelector('.optin-consent span')?.textContent?.trim() : null,
          p_page: location.pathname, p_params: calcParams(source),
          p_irl_month: irl ? Number(f.get('irl_month')) : null, p_paris_alert: paris, p_website: f.get('website') || null,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          console.error('Inscription :', res.status, j);
          return say(j.message && !/function|schema|jwt|permission|key/i.test(j.message) ? j.message : `Envoi impossible pour le moment (erreur ${res.status}).${download}`, false);
        }
        const confirm = marketing || irl || paris;
        form.reset();
        syncMonth();
        say(`C’est envoyé à ${email.replace(/[<>&"]/g, '')} : regardez votre boîte de réception (et les indésirables).${confirm ? ' Cliquez sur le lien de confirmation du message pour activer votre inscription.' : ''}${download}`, true);
      } catch {
        say(`Connexion impossible. Vérifiez votre réseau et réessayez.${download}`, false);
      } finally {
        button.disabled = false;
      }
    });
  });

  // ---------- page de confirmation / désinscription
  const box = document.getElementById('inscription');
  if (box) {
    const q = new URLSearchParams(location.search);
    const token = q.get('confirmer') || q.get('desinscrire');
    const confirming = q.has('confirmer');
    const title = document.getElementById('inscription-titre');
    const text = document.getElementById('inscription-texte');
    const show = (t, p, state) => { title.textContent = t; text.textContent = p; box.dataset.state = state; };
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) show('Lien incomplet', 'Ce lien ne semble pas complet. Copiez-le en entier depuis l’e-mail reçu, ou écrivez-nous.', 'erreur');
    else if (!supaReady()) show('Service indisponible', 'La confirmation est indisponible pour le moment : réessayez plus tard.', 'erreur');
    else rpc(confirming ? 'iz_confirm_subscription' : 'iz_unsubscribe', { p_token: token })
      .then(async (res) => {
        const r = res.ok ? await res.json() : 'erreur';
        if (confirming) {
          if (r === 'confirme') show('Inscription confirmée', 'Merci ! Votre inscription est active. Vous pouvez vous désinscrire à tout moment par le lien présent dans chaque e-mail.', 'ok');
          else if (r === 'deja') show('Déjà confirmée', 'Votre inscription était déjà confirmée. Rien d’autre à faire.', 'ok');
          else show('Lien expiré ou inconnu', 'Ce lien n’est plus valable (inscription annulée entre-temps ?). Vous pouvez vous réinscrire depuis le site.', 'erreur');
        } else if (r === 'desinscrit') show('Désinscription faite', 'Vous ne recevrez plus de conseils, d’offres ni d’alertes d’Immo-Zen à cette adresse.', 'ok');
        else show('Lien inconnu', 'Ce lien de désinscription n’est pas reconnu. Écrivez-nous à contact@immo-zen.fr : nous supprimerons votre adresse.', 'erreur');
      })
      .catch(() => show('Connexion impossible', 'Vérifiez votre réseau et rechargez la page.', 'erreur'));
  }
})();
