import { useState } from 'react';
import type { Property } from '../data/types.ts';
import { money2 } from '../domain/format.ts';
import { readImportFile } from '../domain/importing.ts';
import {
  buildSchedule, cellsToLines, COLUMN_ROLE_LABELS, parseTable, readPdfLines, scheduleYears, tokenizeText,
  type ColumnRole, type LoanSchedule, type ParsedTable,
} from '../domain/loanSchedule.ts';
import { Button, Help, Modal } from '../ui/components.tsx';

const fr = (iso: string) => iso.split('-').reverse().join('/');

/** Totaux par année d'un tableau d'amortissement. */
export function ScheduleYearsTable({ schedule }: { schedule: LoanSchedule }) {
  const years = scheduleYears(schedule);
  return (
    <div className="dt-scroll"><table className="dt-table compact">
      <thead><tr><th>Année</th><th className="num">Échéances</th><th className="num">Intérêts</th><th className="num">Assurance</th><th className="num">Capital remboursé</th><th className="num">Capital restant dû au 31/12</th></tr></thead>
      <tbody>{years.map((y) => (
        <tr key={y.year}><td>{y.year}</td><td className="num">{y.count}</td><td className="num"><strong>{money2(y.interest)}</strong></td><td className="num">{money2(y.insurance)}</td>
          <td className="num">{money2(y.principal)}</td><td className="num">{y.remainingEnd == null ? '—' : money2(y.remainingEnd)}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

/**
 * Tableau d'amortissement du crédit (Mes biens) : import du document de la banque (PDF, Excel, CSV ou texte copié),
 * contrôle des colonnes reconnues, puis intérêts et assurance de chaque année repris dans la déclaration.
 */
export function LoanScheduleBlock({ draft, set }: {
  draft: Partial<Property>; set: (k: 'loan_schedule' | 'loan_start_date' | 'loan_amount', v: LoanSchedule | string | number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showYears, setShowYears] = useState(false);
  const s = draft.loan_schedule;
  return (
    <div className="loan-schedule field-full">
      <p className="label">Tableau d’amortissement de la banque</p>
      {s?.rows.length ? (
        <>
          <p className="muted small">{s.rows.length} échéances du {fr(s.rows[0]!.date)} au {fr(s.rows.at(-1)!.date)}{s.source ? `, importées de « ${s.source} »` : ''}.
            {' '}Les intérêts, l’assurance et le capital restant dû de chaque année sont repris de ce tableau dans la déclaration.</p>
          <div className="row">
            <Button size="sm" onClick={() => setShowYears((x) => !x)}>{showYears ? 'Masquer' : 'Voir'} les montants par année</Button>
            <Button size="sm" onClick={() => setOpen(true)}>Remplacer</Button>
            <Button size="sm" variant="ghost" onClick={() => set('loan_schedule', null)}>Retirer le tableau</Button>
          </div>
          {showYears && <ScheduleYearsTable schedule={s} />}
        </>
      ) : (
        <>
          <Help>Sans tableau, les intérêts sont calculés d’après le montant, le taux, la durée et la première échéance : ils diffèrent des intérêts réels en cas d’intérêts intercalaires, de différé ou d’assurance prélevée avec l’échéance. Importez le tableau d’amortissement de votre offre de prêt pour retenir les montants exacts.</Help>
          <Button size="sm" onClick={() => setOpen(true)}>Importer le tableau d’amortissement</Button>
        </>
      )}
      {open && <ImportModal firstDue={draft.loan_start_date ?? null} onClose={() => setOpen(false)} onDone={(sch) => {
        set('loan_schedule', sch);
        const first = sch.rows[0]!;
        if (!draft.loan_start_date) set('loan_start_date', first.date);
        if (!draft.loan_amount && first.remaining > 0) set('loan_amount', Math.round((first.remaining + first.principal) * 100) / 100);
        setOpen(false);
        setShowYears(true);
      }} />}
    </div>
  );
}

function ImportModal({ firstDue, onClose, onDone }: { firstDue: string | null; onClose: () => void; onDone: (s: LoanSchedule) => void }) {
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [roles, setRoles] = useState<ColumnRole[]>([]);
  const [source, setSource] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [due, setDue] = useState(firstDue ?? '');

  const load = (t: ParsedTable, name: string) => {
    if (!t.rows.length) { setError(t.warnings[0] ?? 'Tableau illisible.'); return; }
    setError(''); setTable(t); setRoles(t.roles); setSource(name);
  };
  const readFile = async (f: File) => {
    setBusy(true);
    try {
      const name = f.name.toLowerCase();
      if (name.endsWith('.pdf') || f.type === 'application/pdf') {
        const lines = await readPdfLines(await f.arrayBuffer());
        if (!lines.some((l) => l.length > 2)) throw new Error('Ce PDF ne contient pas de texte (document scanné) : copiez le tableau depuis l’espace client de la banque, ou demandez-le au format Excel.');
        load(parseTable(lines), f.name);
      } else load(parseTable(cellsToLines(await readImportFile(f))), f.name);
    } catch (x) { setError(x instanceof Error ? x.message : 'Fichier illisible.'); } finally { setBusy(false); }
  };
  const built = table ? buildSchedule(table, roles, due || null, source) : null;
  const dup = roles.filter((r, i) => r !== 'ignore' && roles.indexOf(r) !== i);

  return (
    <Modal open wide title="Importer le tableau d’amortissement" onClose={onClose}
      footer={table ? <>
        <Button onClick={() => { setTable(null); setError(''); }}>Autre fichier</Button>
        <Button variant="primary" disabled={!built?.schedule || dup.length > 0} onClick={() => built?.schedule && onDone(built.schedule)}>Utiliser ce tableau</Button>
      </> : <Button onClick={onClose}>Fermer</Button>}>
      {!table ? (
        <div className="import-start">
          <p>Tableau d’amortissement de l’offre de prêt ou de l’espace client de la banque : PDF (texte, non scanné), Excel (.xlsx) ou CSV. Une ligne par échéance, avec sa date ou son numéro et ses montants. Le document est lu sur votre appareil : il n’est ni envoyé ni conservé, seuls les montants sont enregistrés.</p>
          <label className="btn btn-primary file-btn">{busy ? 'Lecture…' : 'Choisir un fichier'}
            <input type="file" accept=".pdf,application/pdf,.xlsx,.xlsm,.csv,.txt" aria-label="Tableau d’amortissement" disabled={busy} onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void readFile(f);
            }} />
          </label>
          <div className="field field-full">
            <label htmlFor="sched-paste">… ou collez le tableau copié depuis le PDF ou le site de la banque</label>
            <textarea id="sched-paste" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'1  15/04/2023  914,89  377,14  537,75  4,61  169 601,25\n2  15/05/2023  …'} />
          </div>
          <Button disabled={!paste.trim()} onClick={() => load(parseTable(tokenizeText(paste)), 'texte collé')}>Analyser le texte collé</Button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      ) : (
        <>
          <p role="status"><strong>{table.rows.length}</strong> échéance(s) lue(s) dans {source}. Vérifiez le rôle de chaque colonne d’après les premières lignes.</p>
          <div className="dt-scroll"><table className="dt-table compact">
            <thead>
              <tr><th>Date</th>{roles.map((r, j) => (
                <th key={j} className="num">
                  <select aria-label={`Colonne ${j + 1}${table.headers[j] ? ` (${table.headers[j]})` : ''}`} value={r} onChange={(e) => setRoles(roles.map((x, k) => (k === j ? e.target.value as ColumnRole : x)))}>
                    {(Object.entries(COLUMN_ROLE_LABELS) as [ColumnRole, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  {table.headers[j] && <div className="muted small">{table.headers[j]}</div>}
                </th>
              ))}</tr>
            </thead>
            <tbody>{table.rows.slice(0, 6).map((row, i) => (
              <tr key={i}><td>{row.date ? fr(row.date) : `n° ${row.index ?? i + 1}`}</td>{row.values.map((v, j) => <td key={j} className={`num${roles[j] === 'ignore' ? ' muted' : ''}`}>{money2(v)}</td>)}</tr>
            ))}</tbody>
          </table></div>
          {table.rows.some((r) => !r.date) && (
            <div className="field"><label htmlFor="sched-due">Date de la première échéance</label>
              <input id="sched-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          )}
          {table.warnings.map((w) => <p key={w} className="muted small">⚠ {w}</p>)}
          {dup.length > 0 && <p className="form-error" role="alert">Chaque rôle ne peut être choisi qu’une fois ({[...new Set(dup)].map((r) => COLUMN_ROLE_LABELS[r]).join(', ')}).</p>}
          {built?.errors.map((e) => <p key={e} className="form-error" role="alert">{e}</p>)}
          {built?.schedule && dup.length === 0 && <><h3>Montants par année</h3><ScheduleYearsTable schedule={built.schedule} /></>}
        </>
      )}
    </Modal>
  );
}
