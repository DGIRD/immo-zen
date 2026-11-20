/**
 * Parc d'exemple fictif pour les captures du site : 4 biens détenus avec crédit, baux, loyers encaissés
 * (un impayé le mois dernier), dépenses, et un T2 à Paris 18e en prospection avec sa simulation.
 * Produit le contenu du stockage du mode démonstration (JSON clé → valeur) à injecter dans le navigateur.
 */
import { createDemoRepo } from '../../src/data/demoRepo.ts';
import { DEFAULT_INPUTS, simulate, summarize, ENGINE_VERSION, type SimulationInputs } from '../../src/domain/simulator.ts';

function memStorage(): Storage & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: (k) => m.get(k) ?? null, key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); }, dump: () => Object.fromEntries(m) };
}

export async function seedDemo(today: string): Promise<Record<string, string>> {
  const st = memStorage();
  const repo = createDemoRepo(st);
  const y = Number(today.slice(0, 4)); const mo = Number(today.slice(5, 7));
  const month = (k: number) => { const d = new Date(Date.UTC(y, mo - 1 + k, 1)); return d.toISOString().slice(0, 10); }; // k mois avant/après le mois courant
  const iso = (k: number, day: number) => month(k).slice(0, 8) + String(day).padStart(2, '0');

  const owned = [
    { title: 'T2 Lyon 7e, Jean Macé', address: '18 rue de Marseille', city: 'Lyon', zip: '69007', surface: 44, rooms: 2, dpe: 'C', furnished: true, rent: 790, charges: 70, regime: 'reel_bic', price: 189000, loan: 100000, rate: 3.6, years: 25, start: '2023-03-05', acq: '2023-02-10', tenant: ['Léa', 'Martin'], leaseStart: '2024-09-01' },
    { title: 'Studio Lille Vieux-Lille', address: '7 rue de la Monnaie', city: 'Lille', zip: '59800', surface: 22, rooms: 1, dpe: 'D', furnished: true, rent: 585, charges: 45, regime: 'micro_bic', price: 112000, loan: 60000, rate: 3.9, years: 20, start: '2023-11-05', acq: '2023-10-12', tenant: ['Hugo', 'Bernard'], leaseStart: '2025-09-01' },
    { title: 'T3 Nantes Chantenay', address: '42 boulevard de Chantenay', city: 'Nantes', zip: '44100', surface: 63, rooms: 3, dpe: 'D', furnished: false, rent: 920, charges: 90, regime: 'reel_foncier', price: 214000, loan: 140000, rate: 3.6, years: 25, start: '2024-06-05', acq: '2024-05-17', tenant: ['Sarah', 'Petit'], leaseStart: '2024-07-01' },
    { title: 'Maison Rennes Sud', address: '5 allée des Tilleuls', city: 'Rennes', zip: '35200', surface: 88, rooms: 4, dpe: 'C', furnished: false, rent: 1180, charges: 0, regime: 'micro_foncier', price: 268000, loan: 170000, rate: 3.4, years: 25, start: '2025-02-05', acq: '2025-01-20', tenant: ['Thomas', 'Robert'], leaseStart: '2025-03-01' },
  ] as const;

  for (const [i, p] of owned.entries()) {
    const prop = await repo.insert('properties', {
      title: p.title, status: 'acquis', property_type: p.rooms === 4 ? 'maison' : 'appartement', address: p.address, city: p.city, acquisition_cost: Math.round(p.price * 1.08), zip: p.zip, surface: p.surface, rooms: p.rooms, dpe: p.dpe,
      furnished: p.furnished, estimated_rent: p.rent, charges_provision: p.charges, asking_price: p.price, offer_price: p.price, property_tax_annual: 700 + i * 250,
      copro_charges_annual: p.rooms === 4 ? 0 : 900 + i * 200, pno_annual: 140, loan_amount: p.loan, loan_rate: p.rate, loan_years: p.years, loan_start_date: p.start,
      loan_insurance_monthly: Math.round(p.loan * 0.0012 / 12 * 100) / 100, acquired_at: p.acq,
      estimate_low: Math.round(p.price * 1.02 / 1000) * 1000, estimate_high: Math.round(p.price * 1.14 / 1000) * 1000, estimate_median: Math.round(p.price * 1.08 / 1000) * 1000,
      estimate_on: today, estimate_source: 'Ventes publiques (DVF) autour du bien', ownership_mode: 'nom_propre', tax_regime: p.regime, occupation_status: 'loue',
    } as never) as { id: string };
    {
      const inp: SimulationInputs = { ...DEFAULT_INPUTS, rentMode: 'manuel', surface: p.surface, askingPrice: p.price, price: p.price, works: 0, monthlyRent: p.rent, downPayment: Math.max(0, Math.round(p.price * 1.08) - p.loan), interestRate: p.rate, loanYears: p.years, pnoAnnual: 140, propertyTaxAnnual: 700 + i * 250, coproChargesAnnual: p.rooms === 4 ? 0 : 900 + i * 200, chargesProvisionMonthly: p.charges };
      const o = simulate(inp);
      const scn = await repo.insert('scenarios', { property_id: prop.id, name: 'Hypothèses d’achat', inputs: inp, results: o.ok ? summarize(o.result) : null, engine_version: ENGINE_VERSION } as never) as { id: string };
      const cur = (await repo.loadAll()).properties.find((x) => x.id === prop.id)!;
      await repo.update('properties', prop.id, cur.version, { primary_scenario_id: scn.id } as never);
    }
    const tenant = await repo.insert('tenants', { first_name: p.tenant[0], last_name: p.tenant[1], email: `${p.tenant[0].toLowerCase()}.${p.tenant[1].toLowerCase()}@exemple.invalid`, phone: null, notes: null, archived_at: null } as never) as { id: string };
    const lease = await repo.insert('leases', {
      property_id: prop.id, label: null, furnished: p.furnished, start_date: p.leaseStart, end_date: null, rent_hc: p.rent, charges_amount: p.charges, charges_mode: 'provision',
      deposit_amount: p.furnished ? p.rent * 2 : p.rent, payment_day: 5, landlord_name: 'Alex Exemple', landlord_address: '10 rue de l’Exemple, 75000 Paris', owner_confirmation_email: false,
      receipt_auto_send: true, reminder_enabled: true, reminder_delay_days: 5, notes: null, irl_enabled: true,
    } as never) as { id: string };
    await repo.insert('lease_tenants', { lease_id: lease.id, tenant_id: tenant.id, left_on: null } as never);
    await repo.generateCharges(lease.id, today);
    // paiements : tous les mois réglés le 5, sauf le mois dernier pour le studio de Lille (impayé), et le mois courant pas encore échu après le 5
    const snap = await repo.loadAll();
    const charges = snap.charges.filter((c) => c.lease_id === lease.id && c.kind === 'loyer' && c.period_start <= today).sort((a, b) => a.period_start.localeCompare(b.period_start));
    for (const c of charges) {
      if (i === 1 && c.period_start === month(-1)) continue;
      if (c.period_start === month(0) && Number(today.slice(8, 10)) < 6) continue;
      const total = Math.round((c.rent_amount + c.charges_amount) * 100) / 100;
      const pay = await repo.insert('payments', { lease_id: lease.id, amount: total, paid_on: c.period_start.slice(0, 8) + '05', date_defaulted: false, method: 'virement', reference: null, comment: null, source: 'saisie', period_month: c.period_start } as never) as { id: string };
      await repo.insert('payment_allocations', { payment_id: pay.id, charge_id: c.id, amount: total } as never);
    }
    // dépenses de l'année passée et de l'année en cours
    for (const yy of [y - 1, y]) {
      const ex = [
        { category: 'taxe_fonciere', label: 'Taxe foncière', amount: 700 + i * 250, d: `${yy}-10-15` },
        { category: 'assurance', label: 'Assurance PNO', amount: 140, d: `${yy}-01-20` },
        ...(p.rooms === 4 ? [] : [{ category: 'copropriete', label: 'Appel de fonds copropriété', amount: 900 + i * 200, d: `${yy}-04-01` }]),
        ...(i === 0 ? [{ category: 'entretien', label: 'Remplacement chauffe-eau', amount: 640, d: `${yy}-03-12` }] : []),
        ...(i === 2 ? [{ category: 'gestion', label: 'Frais de comptabilité', amount: 180, d: `${yy}-02-03` }] : []),
      ].filter((e) => e.d <= today);
      for (const e of ex) {
        await repo.insert('expenses', { property_id: prop.id, expense_date: e.d, supplier: null, label: e.label, amount: e.amount, category: e.category, nature: 'charge', recoverable_amount: 0, payment_status: 'paye', paid_on: e.d, document_id: null, notes: null } as never);
      }
    }
  }

  // un bien en prospection, avec sa simulation
  const prospect = await repo.insert('properties', {
    title: 'T2 Paris 18e, Jules Joffrin', status: 'offre_envisagee', property_type: 'appartement', city: 'Paris', zip: '75018', surface: 38, rooms: 2, dpe: 'D', furnished: true,
    asking_price: 240000, offer_price: 220000, works_budget: 8000, estimated_rent: 1200, property_tax_annual: 650, copro_charges_annual: 1300, pno_annual: 130,
    next_action: 'Faire l’offre à 220 000 € après la 2e visite', follow_up_date: iso(0, 28),
  } as never) as { id: string };
  const inputs: SimulationInputs = { ...DEFAULT_INPUTS, rentMode: 'manuel', surface: 38, askingPrice: 240000, price: 220000, works: 8000, monthlyRent: 1200, downPayment: 70000, pnoAnnual: 130, propertyTaxAnnual: 650, coproChargesAnnual: 1300, coproRecoverableAnnual: 600, chargesProvisionMonthly: 70, vacancyAnnual: 575 };
  const out = simulate(inputs);
  const sc = await repo.insert('scenarios', { property_id: prospect.id, name: 'Offre à 220 000 €', inputs, results: out.ok ? summarize(out.result) : null, engine_version: ENGINE_VERSION } as never) as { id: string; version: number };
  const p2 = (await repo.loadAll()).properties.find((x) => x.id === prospect.id)!;
  await repo.update('properties', prospect.id, p2.version, { primary_scenario_id: sc.id } as never);
  // tableau unique des loyers déjà en place (pas d'écran de reprise)
  const set = (await repo.loadAll()).settings;
  if (set) await repo.saveSettings(set.version, { rental_settings: { ...(set.rental_settings ?? {}), ledger_unified_at: new Date().toISOString() } } as never);
  return st.dump();
}
