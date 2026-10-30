import { useMemo } from 'react';
import { useStore } from '../data/store.tsx';
import type { Contact, Insert, Property, Scenario } from '../data/types.ts';
import { downloadBlob, stamp, toCsv, toXlsx, type ExportColumn } from '../domain/exporting.ts';
import { date, money, number, pct, todayParis } from '../domain/format.ts';
import { OCCUPATION_LABELS, OWNERSHIP_LABELS, STATUS_LABELS, TYPE_LABELS } from '../domain/labels.ts';
import { ANNUAL_CHARGE_FIELDS, annualChargesTotal, isOwned, loanInfo, metrics, ownedCashflow, rentWithCharges, summarize, type CashflowEstimate, type PropertyMetrics, primaryScenario } from '../domain/property.ts';
import { propertyRentalSummary, type PropertyRentalSummary } from '../domain/rental.ts';

import { normalizeInputs, simulate, simulatedCashflow } from '../domain/simulator.ts';
import type { Column } from '../ui/DataTable.tsx';
import { StatusBadge } from '../ui/components.tsx';

export interface PropertyRow {
  p: Property;
  m: PropertyMetrics;
  agency: Contact | null;
  agent: Contact | null;
  /** Suivi locatif de l'année en cours (biens détenus). */
  rs: PropertyRentalSummary;
  /** Cash-flow prévisionnel d'un bien détenu (loyer − charges − crédit). */
  cf: CashflowEstimate | null;
}

export function usePropertyRows(filter: (p: Property) => boolean): PropertyRow[] {
  const { data, simulatorDefaults } = useStore();
  return useMemo(() => {
    const contacts = new Map(data.contacts.map((c) => [c.id, c]));
    const today = todayParis();
    const year = Number(today.slice(0, 4));
    const rental = { leases: data.leases, leaseTenants: data.leaseTenants, tenants: data.tenants, charges: data.charges, payments: data.payments, allocations: data.allocations, expenses: data.expenses };
    return data.properties.filter(filter).map((p) => {
      const rs = propertyRentalSummary(p.id, year, today, rental);
      const m = metrics(p, data.scenarios, simulatorDefaults);
      return {
        rs, p, m,
        cf: isOwned(p) ? ownedCashflow(p, rs.activeLeases, m.result, today) : null,
        agency: p.agency_id ? contacts.get(p.agency_id) ?? null : null,
        agent: p.agent_id ? contacts.get(p.agent_id) ?? null : null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, simulatorDefaults]);
}

const rentCC = (r: PropertyRow) => { const l = r.rs.activeLeases[0]; return l ? Math.round((l.rent_hc + l.charges_amount) * 100) / 100 : rentWithCharges(r.p); };

export function cfTitle(cf: CashflowEstimate | null): string {
  if (!cf) return 'Renseignez le loyer, les charges ou le crédit du bien';
  if (cf.source === 'simulation') return 'D’après la simulation principale (aucun loyer ni charge saisi sur le bien)';
  return `Loyer CC ${money(cf.income)} − charges ${money(cf.charges)} − crédit ${money(cf.loan)}${cf.loanSource === 'simulation' ? ' (simulation)' : ''}, par mois, avant impôts`;
}

/** Écart (%) entre le loyer hors charges du bien et le loyer central de marché hors charges (charges comprises à défaut). */
export function marketRentGap(p: Property): number | null {
  const m = p.market_rent;
  const ref = m?.hc?.mid ?? m?.mid;
  if (!m?.high || !ref || !p.estimated_rent) return null;
  return Math.round(((p.estimated_rent - ref) / ref) * 1000) / 10;
}
export const estimateMid = (p: Property) => p.estimate_median ?? (p.estimate_low != null && p.estimate_high != null ? Math.round((p.estimate_low + p.estimate_high) / 2) : null);
export const estimateRange = (p: Property) => (p.estimate_low != null && p.estimate_high != null ? `${money(p.estimate_low)} – ${money(p.estimate_high)}` : '—');
export function estimateGap(price: number | null | undefined, p: Property): number | null {
  const mid = estimateMid(p);
  return price && mid ? Math.round(((price - mid) / mid) * 1000) / 10 : null;
}
const latentGain = (p: Property) => { const mid = estimateMid(p); const cost = p.acquisition_cost ?? p.acquisition_snapshot?.results?.totalCost ?? null; return mid != null && cost ? mid - cost : null; };

const tone = (x: number | null | undefined) => (x === null || x === undefined ? '' : x >= 0 ? 'pos' : 'neg');

export function prospectColumns(): Column<PropertyRow>[] {
  return [
    { id: 'title', label: 'Titre', value: (r) => r.p.title, primary: true },
    { id: 'city', label: 'Ville', value: (r) => r.p.city, mobile: true },
    { id: 'address', label: 'Adresse', value: (r) => r.p.address, defaultHidden: true },
    { id: 'type', label: 'Type', value: (r) => TYPE_LABELS[r.p.property_type], defaultHidden: true },
    { id: 'surface', label: 'Surface du logement', value: (r) => r.p.surface, kind: 'number', align: 'right', render: (r) => (r.p.surface ? `${number(r.p.surface)} m²` : '—'), mobile: true },
    { id: 'rooms', label: 'Pièces', value: (r) => r.p.rooms, kind: 'number', align: 'right', defaultHidden: true },
    { id: 'dpe', label: 'DPE', value: (r) => r.p.dpe, render: (r) => (r.p.dpe ? <span className={`dpe dpe-${r.p.dpe}`}>{r.p.dpe}</span> : '—') },
    { id: 'asking', label: 'Prix de présentation FAI', value: (r) => r.p.asking_price, kind: 'money', align: 'right', render: (r) => money(r.p.asking_price), mobile: true },
    { id: 'offer', label: 'Prix proposé', value: (r) => r.p.offer_price, kind: 'money', align: 'right', render: (r) => money(r.p.offer_price) },
    { id: 'nego', label: 'Négociation', value: (r) => r.m.result?.negotiationPct ?? null, kind: 'percent', align: 'right', render: (r) => pct(r.m.result?.negotiationPct), defaultHidden: true },
    { id: 'm2', label: 'Prix / m²', value: (r) => r.m.pricePerM2, kind: 'money', align: 'right', render: (r) => money(r.m.pricePerM2) },
    { id: 'estimate', label: 'Estimation DVF', value: (r) => estimateMid(r.p), kind: 'money', align: 'right', render: (r) => estimateRange(r.p) },
    { id: 'gap', label: 'Écart prix / estimation', value: (r) => estimateGap(r.m.result?.offerFai ?? r.p.offer_price, r.p), kind: 'percent', align: 'right',
      render: (r) => { const g = estimateGap(r.m.result?.offerFai ?? r.p.offer_price, r.p); return g === null ? '—' : <span className={g > 5 ? 'neg' : g < -5 ? 'pos' : ''}>{g > 0 ? '+' : ''}{pct(g)}</span>; } },
    { id: 'works', label: 'Travaux', value: (r) => r.p.works_budget, kind: 'money', align: 'right', render: (r) => money(r.p.works_budget), defaultHidden: true },
    { id: 'rent', label: 'Loyer hors charges', value: (r) => r.p.estimated_rent, kind: 'money', align: 'right', render: (r) => money(r.p.estimated_rent), defaultHidden: true },
    { id: 'marketrent', label: 'Loyer de marché central (CC)', value: (r) => (r.p.market_rent?.high ? r.p.market_rent.mid : null), kind: 'money', align: 'right',
      render: (r) => (r.p.market_rent?.high ? <span title={`Bas ${money(r.p.market_rent.low)}, haut ${money(r.p.market_rent.high)}${r.p.market_rent.cap_hc != null ? ' (plafond légal)' : ''}`}>{money(r.p.market_rent.mid)}</span> : '—'), defaultHidden: true },
    { id: 'rentgap', label: 'Écart loyer / marché', value: (r) => marketRentGap(r.p), kind: 'percent', align: 'right', defaultHidden: true,
      render: (r) => { const g = marketRentGap(r.p); return g === null ? '—' : <span className={g > 10 ? 'neg' : ''}>{g > 0 ? '+' : ''}{pct(g)}</span>; } },
    { id: 'yield', label: 'Rendement brut', value: (r) => r.m.result?.grossYield ?? null, kind: 'percent', align: 'right', render: (r) => pct(r.m.result?.grossYield), mobile: true },
    { id: 'cashflow', label: 'Cash-flow / mois', value: (r) => simulatedCashflow(r.m.result), kind: 'money', align: 'right',
      render: (r) => { const cf = simulatedCashflow(r.m.result); return cf === null ? <span className="muted" title="Renseignez le loyer au m² pour lancer la simulation">—</span> : <span className={tone(cf)}>{money(cf)}</span>; }, mobile: true },
    { id: 'agency', label: 'Agence', value: (r) => r.agency?.name, defaultHidden: true },
    { id: 'agent', label: 'Agent', value: (r) => r.agent?.name, defaultHidden: true },
    { id: 'status', label: 'Statut', value: (r) => STATUS_LABELS[r.p.status], render: (r) => <StatusBadge status={r.p.status} />, mobile: true },
    { id: 'next', label: 'Prochaine action', value: (r) => r.p.next_action },
    { id: 'followup', label: 'Relance', value: (r) => r.p.follow_up_date, kind: 'date', render: (r) => date(r.p.follow_up_date), mobile: true },
    { id: 'visit', label: 'Visite', value: (r) => r.p.visit_at?.slice(0, 10) ?? null, kind: 'date', render: (r) => date(r.p.visit_at), defaultHidden: true },
    { id: 'url', label: 'Annonce', value: (r) => r.p.listing_url, kind: 'url', sortable: false,
      render: (r) => (r.p.listing_url ? <a href={r.p.listing_url} target="_blank" rel="noopener noreferrer">Ouvrir</a> : '—'), defaultHidden: true },
    { id: 'updated', label: 'Modifié le', value: (r) => r.p.updated_at.slice(0, 10), kind: 'date', render: (r) => date(r.p.updated_at), defaultHidden: true },
  ];
}

/** Occupation affichée : « Loué » dès qu'un bail est en cours, sinon le statut saisi (jamais « Loué » sans bail). */
export function occupationLabel(r: PropertyRow): string | null {
  if (r.rs.activeLeases.length) return OCCUPATION_LABELS.loue;
  if (!r.p.occupation_status) return null;
  return r.p.occupation_status === 'loue' ? OCCUPATION_LABELS.vacant : OCCUPATION_LABELS[r.p.occupation_status];
}

export function ownedColumns(): Column<PropertyRow>[] {
  const y = todayParis().slice(0, 4);
  return [
    { id: 'title', label: 'Bien', value: (r) => r.p.title, primary: true },
    { id: 'address', label: 'Adresse', value: (r) => [r.p.address, r.p.zip, r.p.city].filter(Boolean).join(' ') || null, mobile: true },
    { id: 'ownership', label: 'Détention', value: (r) => (r.p.ownership_mode ? OWNERSHIP_LABELS[r.p.ownership_mode] : null) },
    { id: 'acquired', label: 'Acquis le', value: (r) => r.p.acquired_at, kind: 'date', render: (r) => date(r.p.acquired_at), mobile: true },
    { id: 'cost', label: 'Coût d’acquisition', value: (r) => r.p.acquisition_cost ?? r.p.acquisition_snapshot?.results?.totalCost ?? null, kind: 'money', align: 'right',
      render: (r) => money(r.p.acquisition_cost ?? r.p.acquisition_snapshot?.results?.totalCost ?? null) },
    { id: 'estimate', label: 'Estimation du prix actuel', value: (r) => estimateMid(r.p), kind: 'money', align: 'right', render: (r) => estimateRange(r.p) },
    { id: 'gain', label: 'Plus-value latente', value: (r) => latentGain(r.p), kind: 'money', align: 'right', defaultHidden: true,
      render: (r) => { const g = latentGain(r.p); return <span className={tone(g)} title="Estimation médiane − coût d’acquisition, avant impôts et frais de vente">{money(g)}</span>; } },
    { id: 'occupation', label: 'Occupation', value: occupationLabel, mobile: true },
    { id: 'tenant', label: 'Locataire actif', value: (r) => r.rs.tenantNames || null, mobile: true },
    { id: 'rent', label: 'Loyer HC', value: (r) => r.rs.activeLeases[0]?.rent_hc ?? r.p.estimated_rent, kind: 'money', align: 'right', render: (r) => money(r.rs.activeLeases[0]?.rent_hc ?? r.p.estimated_rent) },
    { id: 'provision', label: 'Provision charges', value: (r) => r.rs.activeLeases[0]?.charges_amount ?? r.p.charges_provision ?? null, kind: 'money', align: 'right',
      render: (r) => money(r.rs.activeLeases[0]?.charges_amount ?? r.p.charges_provision), defaultHidden: true },
    { id: 'rentcc', label: 'Loyer CC', value: (r) => rentCC(r), kind: 'money', align: 'right', render: (r) => money(rentCC(r)), mobile: true },
    { id: 'charges', label: 'Charges / an', value: (r) => annualChargesTotal(r.p), kind: 'money', align: 'right', render: (r) => money(annualChargesTotal(r.p)),
      // détail au survol
      sortable: true },
    ...ANNUAL_CHARGE_FIELDS.map(([k, label]): Column<PropertyRow> => ({
      id: k, label: `${label} / an`, value: (r) => r.p[k] ?? null, kind: 'money', align: 'right', render: (r) => money(r.p[k] ?? null), defaultHidden: true,
    })),
    { id: 'received', label: `Encaissements ${y}`, value: (r) => r.rs.received, kind: 'money', align: 'right', render: (r) => money(r.rs.received) },
    { id: 'expenses', label: `Dépenses ${y}`, value: (r) => r.rs.expensesPaid, kind: 'money', align: 'right', render: (r) => money(r.rs.expensesPaid) },
    { id: 'balance', label: 'Solde locatif', value: (r) => r.rs.balance, kind: 'money', align: 'right',
      render: (r) => <span className={r.rs.overdue ? 'neg' : ''} title={r.rs.overdue ? `Impayé échu : ${money(r.rs.overdue)}` : r.rs.balance > 0 ? 'Avance des locataires' : undefined}>{money(r.rs.balance)}</span> },
    { id: 'realcf', label: `Cash-flow réel ${y}`, value: (r) => r.rs.cashflow, kind: 'money', align: 'right',
      render: (r) => <span className={tone(r.rs.cashflow)} title="Loyers encaissés − dépenses payées depuis le 1er janvier (hors dépôt de garantie, avant impôts)">{money(r.rs.cashflow)}</span>, mobile: true },
    { id: 'cashflow', label: 'Cash-flow / mois', value: (r) => r.cf?.monthly ?? null, kind: 'money', align: 'right', mobile: true,
      render: (r) => <span className={tone(r.cf?.monthly)} title={cfTitle(r.cf)}>{money(r.cf?.monthly)}</span> },
    { id: 'loan', label: 'Mensualité crédit', value: (r) => loanInfo(r.p, todayParis())?.monthlyTotal ?? null, kind: 'money', align: 'right',
      render: (r) => money(loanInfo(r.p, todayParis())?.monthlyTotal ?? null) },
    { id: 'crd', label: 'Capital restant dû', value: (r) => loanInfo(r.p, todayParis())?.remaining ?? null, kind: 'money', align: 'right', defaultHidden: true,
      render: (r) => money(loanInfo(r.p, todayParis())?.remaining ?? null) },
  ];
}

export function exportColumns(cols: Column<PropertyRow>[]): ExportColumn<PropertyRow>[] {
  return cols
    .map((c) => ({ label: c.label, value: c.value, kind: c.kind === 'percent' ? 'percent' : c.kind }));
}

export async function exportRows(format: 'xlsx' | 'csv' | 'json', name: string, cols: Column<PropertyRow>[], rows: PropertyRow[], scenarios: Scenario[]) {
  const ex = exportColumns(cols);
  const file = `immo-zen-${name}-${stamp()}`;
  if (format === 'csv') downloadBlob(new Blob([toCsv(ex, rows)], { type: 'text/csv;charset=utf-8' }), `${file}.csv`);
  else if (format === 'xlsx') downloadBlob(await toXlsx([{ name, columns: ex, rows }]), `${file}.xlsx`);
  else {
    const ids = new Set(rows.map((r) => r.p.id));
    const payload = { format: 'immo-zen-export', exported_at: new Date().toISOString(), properties: rows.map((r) => r.p), scenarios: scenarios.filter((s) => s.property_id && ids.has(s.property_id)) };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${file}.json`);
  }
}

/** Copie d'un bien (et de sa simulation) en prospection, sans historique ni tâches. */
export function useDuplicate() {
  const { create, createMany, update, data, notify } = useStore();
  return async (p: Property): Promise<Property | null> => {
    const { id: _id, user_id: _u, version: _v, created_at: _c, updated_at: _up, legacy_simulation_id: _l, legacy_ref: _r, acquisition_snapshot: _s, primary_scenario_id: _ps, ...rest } = p;
    const copy: Insert<Property> = { ...rest, title: `${p.title} (copie)`.slice(0, 200), status: p.status === 'acquis' || p.status === 'archive' ? 'repere' : p.status, status_before_archive: null, occupation_status: null, acquired_at: null };
    const np = await create('properties', copy);
    if (!np) return null;
    // une seule simulation par bien : celle du bien d'origine est copiée
    const sc = primaryScenario(p, data.scenarios);
    if (sc) {
      const created = await createMany('scenarios', [{ property_id: np.id, name: sc.name, inputs: sc.inputs, results: sc.results, engine_version: sc.engine_version }]);
      if (created?.[0]) await update('properties', np, { primary_scenario_id: created[0].id });
    }
    notify('Bien dupliqué.');
    return np;
  };
}

/** Recalcule et enregistre le résumé d'un scénario (photographie fidèle au moment de l'acquisition). */
export function scenarioSummary(s: Scenario) {
  const out = simulate(normalizeInputs(s.inputs));
  return out.ok ? summarize(out.result) : null;
}
