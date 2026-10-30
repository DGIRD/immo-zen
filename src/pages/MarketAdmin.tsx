import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../data/store.tsx';
import type { IndicatorStat, MarketConfig, StoredCap, SyncRow } from '../data/market.ts';
import { date, dateTime, todayParis } from '../domain/format.ts';
import { downloadBlob } from '../domain/exporting.ts';
import {
  CAPS_HEADER, ENCADREMENT_END, parseRentCapsCsv, parseRentIndicatorsCsv, RENT_SEGMENTS, SEGMENT_LABELS, segmentFromFileName, type RentCap, type RentIndicator, type RentSegment,
} from '../domain/marketRent.ts';
import { BRACKET_LABELS, currentBenchmarks, quarterOf, type Borrower, type RateBenchmark, type UsuryBracket, type UsuryRate } from '../domain/loanRates.ts';
import { Button, Checkbox, NumberInput, Section, TextInput, useConfirm } from '../ui/components.tsx';
import { resetLoanData } from '../ui/LoanRateHint.tsx';
import { resetMarketRentCache } from '../ui/MarketRentPanel.tsx';

type Run = <T>(fn: () => Promise<T>, ok?: string) => Promise<T | null>;

const CARTE_URL = 'https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/';
const USURY_URL = 'https://www.banque-france.fr/fr/statistiques/taux-et-cours/taux-dusure-2026-q4';

/** Texte d'un fichier : UTF-8, sinon Windows-1252 (fichiers publiés en Latin-1). */
async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}

/**
 * Administration des données de marché : Carte des loyers, plafonds d'encadrement, barème des taux,
 * taux d'usure, réglages. Données publiques communes à tous les comptes.
 */
export function MarketAdmin({ run }: { run: Run }) {
  const { repo } = useStore();
  const api = repo.platform.market;
  const [stats, setStats] = useState<IndicatorStat[] | null>(null);
  const [caps, setCaps] = useState<StoredCap[] | null>(null);
  const [loan, setLoan] = useState<{ benchmarks: RateBenchmark[]; usury: UsuryRate[]; config: MarketConfig } | null>(null);
  const [sync, setSync] = useState<SyncRow[] | null | undefined>(undefined);
  const reload = useCallback(async () => {
    resetMarketRentCache(); resetLoanData();
    const [s, c, l, y] = await Promise.all([run(() => api.admin.indicatorStats()), run(() => api.admin.caps()), run(() => api.loanData()), run(() => api.admin.syncStatus())]);
    setStats(s); setCaps(c); setLoan(l); setSync(y);
  }, [api, run]);
  useEffect(() => { void reload(); }, [reload]);
  return (
    <>
      <p className="note">Données publiques communes à tous les comptes, utilisées par la fiche du bien, le simulateur et les nouveaux baux. Une mise à jour ne modifie pas les fourchettes déjà enregistrées avec les biens.</p>
      <AutoSync rows={sync} demo={repo.mode === 'demo'} />
      <RentIndicators stats={stats} run={run} onDone={reload} />
      <RentCaps caps={caps} run={run} onDone={reload} />
      <Benchmarks loan={loan} run={run} onDone={reload} />
      <Usury loan={loan} run={run} onDone={reload} />
      <Settings loan={loan} run={run} onDone={reload} />
    </>
  );
}

function RentIndicators({ stats, run, onDone }: { stats: IndicatorStat[] | null; run: Run; onDone: () => void }) {
  const { repo } = useStore();
  const [vintage, setVintage] = useState<number>(2025);
  const [files, setFiles] = useState<{ name: string; segment: RentSegment | null; rows: RentIndicator[] | null; error: string | null }[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  async function pick(list: FileList | null) {
    const out: typeof files = [];
    for (const f of Array.from(list ?? [])) {
      const segment = segmentFromFileName(f.name);
      try { out.push({ name: f.name, segment, rows: parseRentIndicatorsCsv(await readText(f), segment ?? 'appart', vintage), error: null }); }
      catch (e) { out.push({ name: f.name, segment, rows: null, error: (e as Error).message }); }
    }
    setFiles(out);
  }
  async function importAll() {
    for (const f of files) {
      if (!f.rows || !f.segment) continue;
      const rows = f.rows.map((r) => ({ ...r, segment: f.segment!, vintage }));
      const done = await run(() => repo.platform.market.admin.importIndicators(vintage, f.segment!, rows, (n) => setProgress(`${SEGMENT_LABELS[f.segment!]} : ${n} / ${rows.length} communes`)));
      if (done === null) { setProgress(null); return; }
    }
    setProgress(null); setFiles([]);
    onDone();
  }
  return (
    <Section title="Carte des loyers">
      <p className="small">Indicateurs de loyers d’annonce par commune, publiés chaque année en décembre par l’ANIL et le ministère chargé du Logement (4 fichiers CSV : appartements, 1-2 pièces, 3 pièces et plus, maisons). Téléchargez-les sur <a href={CARTE_URL} target="_blank" rel="noreferrer">data.gouv.fr</a>, puis chargez-les ici.</p>
      {stats && (stats.length ? (
        <div className="dt-scroll"><table className="dt-table compact">
          <thead><tr><th>Millésime</th><th>Segment</th><th className="num">Communes</th></tr></thead>
          <tbody>{stats.map((s) => <tr key={`${s.vintage}${s.segment}`}><td>{s.vintage}</td><td>{SEGMENT_LABELS[s.segment]}</td><td className="num">{s.communes.toLocaleString('fr-FR')}</td></tr>)}</tbody>
        </table></div>
      ) : <p className="note-warn note">Aucun indicateur chargé : le loyer de marché ne peut pas être calculé.</p>)}
      <div className="grid">
        <NumberInput label="Millésime" value={vintage} onChange={(v) => setVintage(v ? Math.round(v) : 2025)} hint="Année des indicateurs (2025 : biens loués au 3e trimestre 2025)" />
        <label className="field"><span className="label">Fichiers CSV</span><input type="file" accept=".csv,text/csv" multiple aria-label="Fichiers de la Carte des loyers" onChange={(e) => void pick(e.target.files)} /></label>
      </div>
      {files.length > 0 && (
        <>
          <div className="dt-scroll"><table className="dt-table compact">
            <thead><tr><th>Fichier</th><th>Segment</th><th className="num">Communes lues</th></tr></thead>
            <tbody>{files.map((f, i) => (
              <tr key={f.name}>
                <td>{f.name}</td>
                <td>{f.error ? <span className="neg">{f.error}</span> : (
                  <select aria-label={`Segment de ${f.name}`} value={f.segment ?? ''} onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, segment: (e.target.value || null) as RentSegment | null } : x)))}>
                    <option value="">À choisir</option>
                    {RENT_SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}
                  </select>
                )}</td>
                <td className="num">{f.rows?.length.toLocaleString('fr-FR') ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <Button variant="primary" disabled={!!progress || !files.some((f) => f.rows && f.segment)} onClick={() => void importAll()}>{progress ?? `Charger le millésime ${vintage}`}</Button>
          <p className="muted small">Le millésime chargé remplace, segment par segment, les valeurs du même millésime.</p>
        </>
      )}
    </Section>
  );
}

function RentCaps({ caps, run, onDone }: { caps: StoredCap[] | null; run: Run; onDone: () => void }) {
  const { repo } = useStore();
  const { ask, dialog } = useConfirm();
  const [parsed, setParsed] = useState<RentCap[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);
  const [ends, setEnds] = useState<Record<string, string>>({});
  const today = todayParis();
  const territories = [...new Set((caps ?? []).map((c) => c.territory))].map((t) => {
    const rows = (caps ?? []).filter((c) => c.territory === t);
    const to = rows.map((c) => c.valid_to).filter(Boolean).sort().at(-1) ?? null;
    return { t, rows: rows.length, communes: new Set(rows.map((c) => c.insee)).size, from: rows.map((c) => c.valid_from).sort()[0]!, to, live: rows.some((c) => c.valid_from <= today && (!c.valid_to || today <= c.valid_to)) };
  });
  async function pick(f: File | undefined) {
    setError(null); setParsed(null);
    if (!f) return;
    try { setParsed(parseRentCapsCsv(await readText(f))); } catch (e) { setError((e as Error).message); }
  }
  return (
    <Section title="Plafonds d’encadrement des loyers" actions={<Button size="sm" onClick={() => downloadBlob(new Blob([`${CAPS_HEADER}\nEst Ensemble;93048;1;2;;1945;non;20,5;24,6;14,35;2026-06-01;${ENCADREMENT_END}\n`], { type: 'text/csv' }), 'plafonds-encadrement-modele.csv')}>Modèle CSV</Button>}>
      <p className="small">Loyers de référence, majorés et minorés (€/m² hors charges) fixés chaque année par arrêté préfectoral dans les 9 territoires encadrés : Paris, Lille-Hellemmes-Lomme, Plaine Commune, Est Ensemble, Lyon et Villeurbanne, Montpellier, Bordeaux, Pays basque, Grenoble-Alpes Métropole. Le loyer majoré × surface devient le loyer haut.</p>
      <p className="note-warn note small">L’expérimentation prend fin le {date(ENCADREMENT_END)} sauf nouvelle loi (prolongation jusqu’en 2028 votée par le Sénat le 21/10/2026, en attente de l’Assemblée nationale). À la fin de validité, le loyer haut revient automatiquement à la Carte des loyers : prolongez la validité si la loi est adoptée.</p>
      {territories.length > 0 && (
        <div className="dt-scroll"><table className="dt-table compact">
          <thead><tr><th>Territoire</th><th className="num">Communes</th><th className="num">Lignes</th><th>Validité</th><th>Prolonger jusqu’au</th><th /></tr></thead>
          <tbody>{territories.map((x) => (
            <tr key={x.t}>
              <td>{x.t}{!x.live && <span className="muted"> (hors validité)</span>}</td><td className="num">{x.communes}</td><td className="num">{x.rows}</td>
              <td>{date(x.from)} → {x.to ? date(x.to) : 'sans fin'}</td>
              <td><input type="date" aria-label={`Nouvelle fin de validité, ${x.t}`} value={ends[x.t] ?? ''} onChange={(e) => setEnds({ ...ends, [x.t]: e.target.value })} />
                <Button size="sm" disabled={!ends[x.t]} onClick={async () => { if (await run(() => repo.platform.market.admin.setCapsEnd(x.t, ends[x.t]!), `Plafonds de ${x.t} valables jusqu’au ${date(ends[x.t]!)}.`) !== null) onDone(); }}>Enregistrer</Button></td>
              <td><Button size="sm" variant="danger" onClick={async () => { if (await ask('Supprimer les plafonds', `Les ${x.rows} plafonds de « ${x.t} » seront supprimés.`, 'Supprimer') && await run(() => repo.platform.market.admin.deleteCaps(x.t), 'Plafonds supprimés.') !== null) onDone(); }}>Supprimer</Button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {caps && !caps.length && <p className="muted">Aucun plafond chargé.</p>}
      <div className="grid">
        <label className="field"><span className="label">Fichier des plafonds (modèle CSV)</span><input type="file" accept=".csv,text/csv" aria-label="Fichier des plafonds" onChange={(e) => void pick(e.target.files?.[0])} /></label>
        <Checkbox label="Remplacer les plafonds des territoires présents dans le fichier" checked={replace} onChange={setReplace} />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {parsed && (
        <p>{parsed.length} plafonds lus ({[...new Set(parsed.map((c) => c.territory))].join(', ')}).{' '}
          <Button variant="primary" onClick={async () => { if (await run(() => repo.platform.market.admin.importCaps(parsed, replace), `${parsed.length} plafonds enregistrés.`) !== null) { setParsed(null); onDone(); } }}>Enregistrer</Button>
        </p>
      )}
      <p className="muted small">Une ligne par commune, zone, nombre de pièces (4 = 4 et plus), période de construction et type de location. Fin de validité vide : {date(ENCADREMENT_END)}.</p>
      {dialog}
    </Section>
  );
}

const DEFAULT_YEARS = [10, 15, 20, 25];

function Benchmarks({ loan, run, onDone }: { loan: { benchmarks: RateBenchmark[] } | null; run: Run; onDone: () => void }) {
  const { repo } = useStore();
  const today = todayParis();
  const cur = loan ? currentBenchmarks(loan.benchmarks, today) : null;
  const [on, setOn] = useState(`${today.slice(0, 7)}-01`);
  const [source, setSource] = useState('Administrateur');
  const [rates, setRates] = useState<Record<number, number | null>>({});
  useEffect(() => { if (cur) setRates(Object.fromEntries(cur.rows.map((r) => [r.years, r.rate]))); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.on]);
  const years = [...new Set([...DEFAULT_YEARS, ...(cur?.rows.map((r) => r.years) ?? [])])].sort((a, b) => a - b);
  const history = loan ? [...new Set(loan.benchmarks.map((b) => b.effective_on))].sort().reverse().slice(0, 12) : [];
  return (
    <Section title="Barème des taux de crédit par durée">
      <p className="small">Taux nominaux moyens hors assurance, à mettre à jour chaque mois (par exemple d’après les publications de l’Observatoire Crédit Logement/CSA ou des courtiers). Une durée intermédiaire est interpolée ; au-delà de 45 jours sans mise à jour, le taux proposé est signalé « à vérifier ».</p>
      {cur ? <p>Barème en vigueur depuis le {date(cur.on)} : {cur.rows.map((r) => `${r.years} ans ${r.rate.toLocaleString('fr-FR')} %`).join(' · ')}.</p> : <p className="note-warn note">Aucun barème : le taux de référence n’est pas proposé dans le simulateur.</p>}
      <div className="grid">
        <TextInput label="Date d’effet" type="date" value={on} onChange={setOn} />
        <TextInput label="Source" value={source} onChange={setSource} maxLength={200} />
        {years.map((y) => <NumberInput key={y} label={`${y} ans`} suffix="%" value={rates[y] ?? null} onChange={(v) => setRates({ ...rates, [y]: v })} />)}
      </div>
      <Button variant="primary" disabled={!on || !Object.values(rates).some((v) => v != null)} onClick={async () => {
        const rows = years.filter((y) => rates[y] != null && rates[y]! >= 0 && rates[y]! < 20).map((y) => ({ years: y, rate: rates[y]! }));
        if (await run(() => repo.platform.market.admin.saveBenchmarks(on, rows, source.trim() || 'Administrateur'), `Barème du ${date(on)} enregistré.`) !== null) onDone();
      }}>Enregistrer le barème</Button>
      {history.length > 1 && <p className="muted small">Barèmes précédents : {history.slice(1).map((h) => date(h)).join(', ')}.</p>}
    </Section>
  );
}

const PART_BRACKETS: UsuryBracket[] = ['moins_10', '10_20', '20_plus', 'variable', 'relais'];
const PM_BRACKETS: UsuryBracket[] = ['moins_10', '10_20', '20_plus'];

function Usury({ loan, run, onDone }: { loan: { usury: UsuryRate[] } | null; run: Run; onDone: () => void }) {
  const { repo } = useStore();
  const today = todayParis();
  // trimestre suivant : publié à la fin du trimestre en cours
  const next = quarterOf(new Date(Date.parse(`${quarterOf(today).to}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10));
  const [q, setQ] = useState(next.quarter);
  const [vals, setVals] = useState<Record<string, number | null>>({});
  const quarters = loan ? [...new Set(loan.usury.map((u) => u.quarter))].sort().reverse() : [];
  const latest = quarters[0];
  const rowsOf = (quarter: string) => (loan?.usury ?? []).filter((u) => u.quarter === quarter);
  const k = (b: Borrower, br: UsuryBracket, f: 'average' | 'usury') => `${b}|${br}|${f}`;
  const valid = /^\d{4}-Q[1-4]$/.test(q);
  async function save() {
    const y = Number(q.slice(0, 4)), n = Number(q.slice(-1));
    const bounds = quarterOf(`${y}-${String((n - 1) * 3 + 1).padStart(2, '0')}-01`);
    const rows: UsuryRate[] = [];
    for (const [b, list] of [['particulier', PART_BRACKETS], ['personne_morale', PM_BRACKETS]] as const) for (const br of list) {
      const u = vals[k(b, br, 'usury')];
      if (u != null && u > 0) rows.push({ quarter: q, borrower: b, bracket: br, average: vals[k(b, br, 'average')] ?? null, usury: u, valid_from: bounds.from, valid_to: bounds.to });
    }
    if (!rows.length) return;
    if (await run(() => repo.platform.market.admin.saveUsury(rows), `Taux d’usure du ${q.replace('-Q', ', trimestre ')} enregistrés.`) !== null) { setVals({}); onDone(); }
  }
  return (
    <Section title="Taux d’usure (Banque de France)">
      <p className="small">Publiés à la fin de chaque trimestre par la <a href={USURY_URL} target="_blank" rel="noreferrer">Banque de France</a> pour le trimestre suivant : taux effectif moyen pratiqué et taux d’usure, par tranche de durée. Saisissez-les avant le 1er janvier, avril, juillet et octobre ; sans valeurs pour le trimestre en cours, le simulateur affiche « Plafond non à jour ».</p>
      {latest && (
        <div className="dt-scroll"><table className="dt-table compact">
          <thead><tr><th>{latest.replace('-Q', ', trimestre ')}</th><th className="num">Taux moyen</th><th className="num">Usure</th></tr></thead>
          <tbody>{rowsOf(latest).map((u) => <tr key={u.borrower + u.bracket}><td>{u.borrower === 'personne_morale' ? 'Personnes morales, ' : ''}{BRACKET_LABELS[u.bracket].toLowerCase()}</td><td className="num">{u.average?.toLocaleString('fr-FR') ?? '—'} %</td><td className="num">{u.usury.toLocaleString('fr-FR')} %</td></tr>)}</tbody>
        </table></div>
      )}
      <div className="grid">
        <TextInput label="Trimestre" value={q} onChange={setQ} placeholder="2027-Q1" hint="AAAA-QN" error={valid ? undefined : 'Format AAAA-QN'} />
      </div>
      {(['particulier', 'personne_morale'] as const).map((b) => (
        <div key={b}>
          <p className="label">{b === 'particulier' ? 'Crédits immobiliers aux particuliers' : 'Prêts aux personnes morales sans activité commerciale (SCI)'}</p>
          <div className="grid">
            {(b === 'particulier' ? PART_BRACKETS : PM_BRACKETS).map((br) => (
              <div key={br} className="field usury-pair">
                <span className="label">{BRACKET_LABELS[br]}</span>
                <NumberInput label="Taux moyen" suffix="%" value={vals[k(b, br, 'average')] ?? null} onChange={(v) => setVals({ ...vals, [k(b, br, 'average')]: v })} />
                <NumberInput label="Usure" suffix="%" value={vals[k(b, br, 'usury')] ?? null} onChange={(v) => setVals({ ...vals, [k(b, br, 'usury')]: v })} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <Button variant="primary" disabled={!valid} onClick={() => void save()}>Enregistrer les taux d’usure</Button>
    </Section>
  );
}

function Settings({ loan, run, onDone }: { loan: { config: MarketConfig } | null; run: Run; onDone: () => void }) {
  const { repo } = useStore();
  const [c, setC] = useState<MarketConfig | null>(null);
  useEffect(() => { if (loan) setC(loan.config); }, [loan]);
  if (!c) return null;
  return (
    <Section title="Réglages">
      <div className="grid">
        <NumberInput label="Fourchette trop large au-delà de" suffix="%" value={Math.round(c.rent_wide_threshold * 100)} onChange={(v) => setC({ ...c, rent_wide_threshold: (v ?? 60) / 100 })}
          hint="Écart entre loyer haut et bas, rapporté au loyer central : fiabilité « Faible » au-delà" />
        <NumberInput label="Coefficient meublé par défaut" value={c.furnished_coef} onChange={(v) => setC({ ...c, furnished_coef: v ?? 1.15 })} hint="1,15 = loyer d’une location vide + 15 %" />
        <NumberInput label="Écart de renégociation" suffix="point" value={c.renegotiation_gap} onChange={(v) => setC({ ...c, renegotiation_gap: v ?? 0.7 })} hint="Crédit d’un bien détenu au-dessus du barème : « Renégociation à étudier »" />
        {c.encadrement_end !== undefined && (
          <TextInput label="Fin de l’encadrement des loyers" type="date" value={c.encadrement_end ?? ''} onChange={(v) => setC({ ...c, encadrement_end: v || null })}
            hint="Appliquée aux plafonds chargés automatiquement (Paris). À reporter si la loi prolonge l’encadrement." />
        )}
      </div>
      <Button onClick={async () => { if (await run(() => repo.platform.market.admin.saveConfig(c), 'Réglages enregistrés.') !== null) onDone(); }}>Enregistrer les réglages</Button>
    </Section>
  );
}


const SOURCE_LABEL = (k: string): string => {
  const c = /^carte:(\d{4}):(.+)$/.exec(k);
  if (c) return `Carte des loyers ${c[1]} – ${SEGMENT_LABELS[c[2] as RentSegment] ?? c[2]}`;
  const u = /^usure:(\d{4})-Q(\d)$/.exec(k);
  if (u) return `Taux d’usure ${u[1]}, trimestre ${u[2]}`;
  const p = /^paris:(\d{4})$/.exec(k);
  if (p) return `Plafonds de Paris ${p[1]}-${Number(p[1]) + 1}`;
  return k === 'derniere-erreur' ? 'Dernière erreur signalée' : k;
};

/** Chargements automatiques de la nuit (fonction serveur « marche »). */
function AutoSync({ rows, demo }: { rows: SyncRow[] | null | undefined; demo: boolean }) {
  if (rows === undefined) return null;
  return (
    <Section title="Mises à jour automatiques">
      <p className="small">Chaque nuit, Immo-Zen vérifie et charge dès leur publication : la Carte des loyers (data.gouv.fr, en décembre), les taux d’usure (Banque de France, chaque trimestre) et les plafonds de Paris (Ville de Paris, au 1er juillet). Le 1er de chaque mois, un e-mail rappelle à l’adresse de support ce qui reste à saisir : le barème des taux et les arrêtés des autres territoires encadrés.</p>
      {demo ? <p className="muted">Mode démonstration : aucune mise à jour automatique.</p>
        : rows === null ? <p className="note-warn note">Mises à jour automatiques non installées : exécutez la migration 20261030000200, déployez la fonction « marche » et planifiez-la (supabase/scheduling-marche.sql).</p>
          : !rows.length ? <p className="muted">Aucun chargement automatique pour l’instant (première exécution la nuit prochaine).</p> : (
            <div className="dt-scroll"><table className="dt-table compact">
              <thead><tr><th>Donnée</th><th>Chargée le</th><th>Détail</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.source} className={r.source === 'derniere-erreur' ? 'neg' : undefined}>
                  <td>{SOURCE_LABEL(r.source)}</td><td>{dateTime(r.loaded_at)}</td>
                  <td>{r.source === 'derniere-erreur' ? r.version : Object.entries(r.details).map(([k, v]) => `${k} : ${typeof v === 'number' ? v.toLocaleString('fr-FR') : String(v)}`).join(', ')}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      <p className="muted small">Un échec de chargement apparaît dans l’onglet Incidents et est signalé par e-mail. Les saisies manuelles ci-dessous restent possibles à tout moment.</p>
    </Section>
  );
}
