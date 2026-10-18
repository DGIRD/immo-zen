// Immo-Zen — site vitrine : menu mobile, calculateur, formulaire de contact.
(() => {
  // Ancienne version de l'application installée à la racine : on retire son service worker
  // pour que la racine affiche bien le site (l'application a le sien sous /app/).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => {
      if (!/\/app\/$/.test(new URL(r.scope).pathname)) r.unregister();
    })).catch(() => undefined);
  }

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  const btn = document.querySelector('.menu-btn');
  const nav = document.getElementById('nav');
  if (btn && nav) {
    btn.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  }

  // ---------- calculateur
  const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const num = (v) => { const n = Number(String(v).replace(/[\s €%]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const calc = document.getElementById('calc');
  const out = document.getElementById('cf');
  const detail = document.getElementById('cf-detail');
  function update() {
    const f = new FormData(calc);
    const prix = num(f.get('prix')), loyer = num(f.get('loyer')), apport = num(f.get('apport')), taux = num(f.get('taux')) / 100, charges = num(f.get('charges'));
    const cout = prix * 1.075;
    const emprunt = Math.max(0, cout - apport);
    const n = 240, t = taux / 12;
    const mensualite = emprunt === 0 ? 0 : t === 0 ? emprunt / n : (emprunt * t) / (1 - Math.pow(1 + t, -n));
    const assurance = (emprunt * 0.003) / 12;
    const credit = mensualite + assurance;
    const cf = loyer - charges / 12 - credit;
    const rendement = cout > 0 ? (loyer * 12) / cout * 100 : 0;
    out.textContent = `${cf >= 0 ? '+' : '−'}${eur.format(Math.abs(Math.round(cf)))}`;
    out.classList.toggle('neg', cf < 0);
    detail.textContent = `Crédit ${eur.format(Math.round(credit))} / mois sur ${eur.format(Math.round(emprunt))} empruntés · rendement brut ${rendement.toFixed(1).replace('.', ',')} %`;
  }
  if (calc) { calc.addEventListener('input', update); update(); }

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
    if (!url || url.startsWith('%') || !key || key.startsWith('%')) return say('Formulaire indisponible pour le moment : écrivez-nous depuis votre espace client.', false);
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const res = await fetch(`${url}/rest/v1/rpc/iz_submit_lead`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_name: f.get('name'), p_email: f.get('email'), p_phone: f.get('phone') || null, p_message: f.get('message') || null, p_topic: f.get('topic'), p_website: f.get('website') || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return say(j.message && !/function|schema/i.test(j.message) ? j.message : 'Envoi impossible pour le moment. Réessayez plus tard.', false);
      }
      form.reset();
      say('Merci, votre demande est bien envoyée. Nous vous recontactons rapidement.', true);
    } catch {
      say('Connexion impossible. Vérifiez votre réseau et réessayez.', false);
    } finally {
      button.disabled = false;
    }
  });
})();
