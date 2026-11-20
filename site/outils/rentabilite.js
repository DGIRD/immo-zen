/* Immo-Zen — calcul de rentabilité locative (rendement brut, net, net-net et prix maximal).
   Méthode du guide « Calcul de la rentabilité locative » : rendements sur le coût total de l'opération ;
   impôt = revenu imposable × (tranche + prélèvements sociaux). Testé dans tests/site.test.ts. */
(function (root) {
  // Abattement et prélèvements sociaux par régime (2026)
  const REGIMES = {
    'micro-foncier': { abattement: 0.3, ps: 0.172 },
    reel: { abattement: null, ps: 0.172 },
    'micro-bic': { abattement: 0.5, ps: 0.186 },
  };
  function calcul(p) {
    const cout = p.prix * (1 + p.notaire) + p.agence + p.travaux + p.mobilier;
    const loyerAn = p.loyer * 12;
    const encaisse = p.loyer * (12 - p.vacance);
    const charges = p.charges + encaisse * p.gestion;
    const resultat = encaisse - charges;
    const reg = REGIMES[p.regime] ?? REGIMES['micro-foncier'];
    const imposable = Math.max(0, reg.abattement == null ? resultat : encaisse * (1 - reg.abattement));
    const impot = imposable * (p.tmi + reg.ps);
    const apresImpot = resultat - impot;
    const div = (a, b) => (b > 0 ? a / b : 0);
    const coutMax = p.objectif > 0 ? resultat / p.objectif : 0;
    const prixMax = Math.max(0, (coutMax - p.travaux - p.agence - p.mobilier) / (1 + p.notaire));
    return {
      cout, encaisse, charges, resultat, imposable, impot, apresImpot,
      brutPrix: div(loyerAn, p.prix), brut: div(loyerAn, cout), net: div(resultat, cout), netNet: div(apresImpot, cout),
      prixMax, ecartPrix: div(p.prix - prixMax, p.prix),
    };
  }
  const api = { calcul, REGIMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ImmoZenRentabilite = api;
})(typeof window !== 'undefined' ? window : globalThis);
