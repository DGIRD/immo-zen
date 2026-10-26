import { useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { Expense, ExpenseCategory, ExpenseNature, Insert } from '../../data/types.ts';
import { downloadBlob, stamp, toCsv, toXlsx, type ExportColumn } from '../../domain/exporting.ts';
import { date, money2, todayParis } from '../../domain/format.ts';
import { defaultNature, EXPENSE_CATEGORY_LABELS, EXPENSE_NATURE_LABELS, expenseTotals, isIncome, MAIN_EXPENSE_CATEGORIES, OTHER_EXPENSE_CATEGORIES } from '../../domain/rental.ts';
import { ExpenseImportDialog } from './ExpenseImport.tsx';
import { expenseYears, isDepreciable } from '../../domain/fiscal.ts';
import { round2 } from '../../domain/simulator.ts';
import { DataTable, type Column } from '../../ui/DataTable.tsx';
import { GridEditor, type GridColumn } from '../../ui/GridEditor.tsx';
import { expenseDuplicates, findDuplicates, sameExpense } from '../../domain/duplicates.ts';
import { Button, EmptyState, Modal, NumberInput, PageHeader, Select, TextArea, TextInput, useConfirm } from '../../ui/components.tsx';
import { checkFile, openDocument, useUpload } from './Documents.tsx';

const CATS = [...MAIN_EXPENSE_CATEGORIES, ...OTHER_EXPENSE_CATEGORIES].map((k) => [k, EXPENSE_CATEGORY_LABELS[k]] as [ExpenseCategory, string]);
const NATURES = Object.entries(EXPENSE_NATURE_LABELS) as [ExpenseNature, string][];
const NATURE_HINT: Record<ExpenseNature, string> = {
  charge: 'Dépense courante de l’année (entretien, taxe, assurance, intérêts…).',
  immobilisation: 'Dépense durable qui augmente la valeur du bien (amélioration, mobilier) ; son traitement fiscal dépend du régime.',
  remboursement_capital: 'Part de capital d’une échéance de prêt : sortie de trésorerie, jamais une charge.',
  tresorerie: 'Mouvement de trésorerie sans incidence sur le résultat (avance, dépôt…).',
};

export function ExpensesPage({ propertyId }: { propertyId?: string }) {
  const store = useStore();
  const { data } = store;
  const { ask, dialog } = useConfirm();
  const [edit, setEdit] = useState<Expense | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [property, setProperty] = useState(propertyId ?? '');
  const [year, setYear] = useState(todayParis().slice(0, 4));
  const [status, setStatus] = useState<'' | 'paye' | 'a_payer' | 'doublons'>('');
  const [grid, setGrid] = useState(false);
  const dups = useMemo(() => expenseDuplicates(data.expenses), [data.expenses]);
  const titles = new Map(data.properties.map((p) => [p.id, p.title]));
  const owned = data.properties.filter((p) => p.status === 'acquis');
  const years = useMemo(() => [...new Set([todayParis().slice(0, 4), ...data.expenses.map((e) => e.expense_date.slice(0, 4))])].sort().reverse(), [data.expenses]);
  const rows = data.expenses.filter((e) => (!property || e.property_id === property) && (!year || e.expense_date.startsWith(year)) && (!status || (status === 'doublons' ? dups.ids.has(e.id) : e.payment_status === status)));
  const extraShown = dups.extra.filter((e) => (!property || e.property_id === property) && (!year || e.expense_date.startsWith(year)));
  const t = expenseTotals(rows);

  const columns: Column<Expense>[] = [
    { id: 'date', label: 'Date', value: (e) => e.expense_date, kind: 'date', render: (e) => date(e.expense_date), primary: true },
    { id: 'property', label: 'Bien', value: (e) => titles.get(e.property_id) ?? '—', mobile: true },
    { id: 'category', label: 'Catégorie', value: (e) => EXPENSE_CATEGORY_LABELS[e.category], mobile: true },
    { id: 'nature', label: 'Nature', value: (e) => EXPENSE_NATURE_LABELS[e.nature] },
    { id: 'amort', label: 'Amortissement', value: (e) => (isDepreciable(e) ? expenseYears(e, data.settings?.tax_inputs?.params?.[e.property_id] ?? {}) : null),
      render: (e) => (isDepreciable(e) ? `${String(expenseYears(e, data.settings?.tax_inputs?.params?.[e.property_id] ?? {})).replace('.', ',')} ans${e.amortization_years ? '' : ' (défaut)'}` : '—'), defaultHidden: false },
    { id: 'supplier', label: 'Fournisseur', value: (e) => e.supplier },
    { id: 'label', label: 'Libellé', value: (e) => e.label, defaultHidden: true },
    { id: 'dup', label: 'Doublon', value: (e) => (dups.ids.has(e.id) ? 'doublon possible' : null), mobile: true,
      render: (e) => (dups.ids.has(e.id) ? <span className="pill pill-warn dup-flag" title="Même bien, même montant, même date (ou même catégorie à quelques jours)">doublon possible</span> : '') },
    { id: 'amount', label: 'Montant', value: (e) => (isIncome(e) ? e.amount : -e.amount), kind: 'money', align: 'right', render: (e) => (isIncome(e) ? <span className="pos">+{money2(e.amount)}</span> : money2(e.amount)), mobile: true },
    { id: 'account', label: 'Compte', value: (e) => e.account ?? null, defaultHidden: true },
    { id: 'recoverable', label: 'Récupérable', value: (e) => e.recoverable_amount, kind: 'money', align: 'right', render: (e) => (e.recoverable_amount ? money2(e.recoverable_amount) : '—') },
    { id: 'status', label: 'Paiement', value: (e) => (e.payment_status === 'paye' ? `Payée le ${date(e.paid_on)}` : 'À payer'),
      render: (e) => (e.payment_status === 'paye' ? <span className="muted">payée le {date(e.paid_on)}</span> : <span className="pill pill-warn">à payer</span>), mobile: true },
    { id: 'delete', label: 'Supprimer', value: () => null, sortable: false, align: 'right',
      render: (e) => <button type="button" className="icon-btn row-delete" aria-label={`Supprimer la dépense du ${date(e.expense_date)} (${money2(e.amount)})`} title="Supprimer" onClick={() => void del([e])}>🗑</button> },
    { id: 'proof', label: 'Justificatif', value: (e) => (e.document_id ? 'oui' : null), sortable: false,
      render: (e) => { const d = data.documents.find((x) => x.id === e.document_id); return d ? <button type="button" className="link" onClick={() => void openDocument(store.repo, d).catch((x: Error) => store.notify(x.message, 'error'))}>Voir</button> : '—'; } },
  ];
  async function del(list: Expense[]) {
    const label = list.length === 1 ? `${money2(list[0]!.amount)} du ${date(list[0]!.expense_date)} sera supprimée.` : `${list.length} lignes seront supprimées.`;
    if (!(await ask(list.length === 1 ? 'Supprimer la dépense' : 'Supprimer les dépenses', `${label} Les justificatifs restent dans Documents.`, 'Supprimer'))) return false;
    let n = 0;
    for (const e of list) if (await store.remove('expenses', e.id)) n++;
    if (n > 1) store.notify(`${n} lignes supprimées.`);
    return n > 0;
  }
  const gridCols: GridColumn<Expense>[] = [
    { id: 'expense_date', label: 'Date', type: 'date', get: (e) => e.expense_date, validate: (x) => (x ? null : 'Date obligatoire') },
    { id: 'property_id', label: 'Bien', type: 'select', options: owned.map((p) => [p.id, p.title] as const), get: (e) => e.property_id },
    { id: 'category', label: 'Catégorie', type: 'select', options: CATS, get: (e) => e.category },
    { id: 'label', label: 'Libellé', type: 'text', get: (e) => e.label, width: '10rem', validate: (x) => (String(x ?? '').length > 300 ? '300 caractères au plus' : null) },
    { id: 'supplier', label: 'Fournisseur', type: 'text', get: (e) => e.supplier, validate: (x) => (String(x ?? '').length > 200 ? '200 caractères au plus' : null) },
    { id: 'amount', label: 'Montant', type: 'money', get: (e) => e.amount, validate: (x) => (x === null || !((x as number) > 0) ? 'Montant positif' : null) },
    { id: 'recoverable_amount', label: 'Récupérable', type: 'money', get: (e) => e.recoverable_amount,
      validate: (x, _e, all) => { const r = (x as number | null) ?? 0; return r < 0 || r > Number(all.amount ?? 0) ? 'Entre 0 et le montant' : null; } },
    { id: 'payment_status', label: 'Paiement', type: 'select', options: [['paye', 'Payée'], ['a_payer', 'À payer']] as const, get: (e) => e.payment_status },
    { id: 'paid_on', label: 'Payée le', type: 'date', get: (e) => e.paid_on, validate: (x, _e, all) => (all.payment_status === 'paye' && !x ? 'Date de paiement' : null) },
  ];
  async function saveGrid(changes: { row: Expense; values: Record<string, string | number | null> }[]) {
    let n = 0;
    for (const { row, values } of changes) {
      const patch: Partial<Expense> = { ...(values as Partial<Expense>) };
      if ('amount' in values) patch.amount = round2(Number(values.amount));
      if ('recoverable_amount' in values) patch.recoverable_amount = round2(Number(values.recoverable_amount ?? 0));
      // nouvelle catégorie : la nature suit, sauf si elle avait été choisie à la main
      if (values.category && row.nature === defaultNature(row.category)) patch.nature = defaultNature(values.category as ExpenseCategory);
      if ((patch.payment_status ?? row.payment_status) === 'a_payer') patch.paid_on = null;
      else if (!(patch.paid_on ?? row.paid_on)) patch.paid_on = (patch.expense_date ?? row.expense_date);
      if (await store.update('expenses', row, patch, `La dépense du ${date(row.expense_date)}`)) n++;
    }
    if (n) store.notify(`${n} ligne${n > 1 ? 's' : ''} modifiée${n > 1 ? 's' : ''}.`);
    return n;
  }
  const exportCols: ExportColumn<Expense>[] = columns.filter((c) => c.id !== 'proof' && c.id !== 'delete').map((c) => ({ label: c.label, value: c.value, kind: c.kind }));
  const exp = async (f: 'xlsx' | 'csv') => {
    const name = `immo-zen-depenses-${year || 'toutes'}-${stamp()}`;
    if (f === 'csv') downloadBlob(new Blob([toCsv(exportCols, rows)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
    else downloadBlob(await toXlsx([{ name: 'Dépenses', columns: exportCols, rows }]), `${name}.xlsx`);
  };
  async function duplicate(e: Expense) {
    const { id: _i, user_id: _u, version: _v, created_at: _c, updated_at: _up, import_ref: _r, document_id: _d, ...rest } = e;
    if (await store.create('expenses', { ...rest, document_id: null, import_ref: null })) store.notify('Ligne dupliquée.');
  }

  return (
    <>
      <PageHeader title="Dépenses" subtitle="Dépenses par bien, avec justificatif, part récupérable et nature (charge, immobilisation, capital, trésorerie)."
        actions={<>
          <Button disabled={!owned.length} onClick={() => setImporting(true)}>Importer (Excel, CSV)</Button>
          <Button variant="primary" disabled={!owned.length} title={owned.length ? undefined : 'Ajoutez d’abord un bien dans Mes biens'} onClick={() => setEdit('new')}>Ajouter une dépense</Button>
        </>} />
      <div className="figures">
        <div className="figure"><span className="figure-label">Total {year || 'toutes années'}</span><span className="figure-value">{money2(t.total)}</span><span className="figure-hint">dont à payer {money2(t.toPay)}</span></div>
        <div className="figure"><span className="figure-label">Charges</span><span className="figure-value">{money2(t.byNature.charge)}</span><span className="figure-hint">récupérables {money2(t.recoverable)}</span></div>
        <div className="figure"><span className="figure-label">Immobilisations</span><span className="figure-value">{money2(t.byNature.immobilisation)}</span></div>
        <div className="figure"><span className="figure-label">Capital et trésorerie</span><span className="figure-value">{money2(round2(t.byNature.remboursement_capital + t.byNature.tresorerie))}</span><span className="figure-hint">hors charges</span></div>
        {t.income > 0 && <div className="figure"><span className="figure-label">Recettes importées</span><span className="figure-value pos">{money2(t.income)}</span><span className="figure-hint">catégorie Loyer, hors dépenses</span></div>}
      </div>
      {owned.length > 0 && <QuickAdd owned={owned} defaultProperty={property || propertyId || (owned.length === 1 ? owned[0]!.id : '')} />}
      {extraShown.length > 0 && !grid && status !== 'doublons' && (
        <p className="note note-warn">{extraShown.length} ligne{extraShown.length > 1 ? 's semblent' : ' semble'} en double (même bien, même montant, même date ou même catégorie à quelques jours).{' '}
          <button type="button" className="link" onClick={() => setStatus('doublons')}>Afficher les doublons</button>{' · '}
          <button type="button" className="link" onClick={() => void del(extraShown)}>Supprimer les doublons (garder la première ligne)</button></p>
      )}
      {grid ? (
        <GridEditor rows={[...rows].sort((a, b) => b.expense_date.localeCompare(a.expense_date))} columns={gridCols} rowKey={(e) => e.id}
          rowLabel={(e) => `dépense du ${date(e.expense_date)}`}
          flag={(e) => (dups.ids.has(e.id) ? <span className="pill pill-warn dup-flag">doublon possible</span> : null)}
          note="Lignes affichées selon les filtres (bien, année, paiement). La nature suit la catégorie, sauf si vous l’aviez choisie à la main ; justificatifs, notes et amortissement se modifient dans la fiche."
          onSave={saveGrid} onClose={() => setGrid(false)} />
      ) : (
      <DataTable id="depenses" rows={rows} columns={columns} rowKey={(e) => e.id} initialSort={{ id: 'date', dir: 'desc' }} onOpen={(e) => setEdit(e)}
        toolbar={<>
          <label className="inline-select">Bien<select value={property} onChange={(e) => setProperty(e.target.value)}><option value="">Tous</option>{owned.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
          <label className="inline-select">Année<select value={year} onChange={(e) => setYear(e.target.value)}><option value="">Toutes</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
          <label className="inline-select">Afficher<select value={status} onChange={(e) => setStatus(e.target.value as '' | 'paye' | 'a_payer' | 'doublons')}><option value="">Toutes</option><option value="paye">Payées</option><option value="a_payer">À payer</option><option value="doublons">Doublons possibles ({dups.ids.size})</option></select></label>
          <Button size="sm" onClick={() => setGrid(true)} disabled={!rows.length}>Modifier en grille</Button>
        </>}
        rowActions={(e) => [
          { label: 'Modifier', onSelect: () => setEdit(e) },
          ...(e.payment_status === 'a_payer' ? [{ label: 'Marquer payée aujourd’hui', onSelect: () => void store.update('expenses', e, { payment_status: 'paye', paid_on: todayParis() }, 'La dépense') }] : []),
          { label: 'Dupliquer', onSelect: () => void duplicate(e) },
          { label: 'Supprimer', danger: true, onSelect: () => void del([e]) },
        ]}
        bulkActions={(sel, clear) => <Button size="sm" variant="danger" onClick={async () => { if (await del(sel)) clear(); }}>Supprimer ({sel.length})</Button>}
        empty={<EmptyState title="Aucune dépense" action={owned.length > 0 && <Button variant="primary" onClick={() => setEdit('new')}>Ajouter une dépense</Button>}>
          {owned.length ? 'Copropriété, taxe foncière, assurances, intérêts, travaux, mobilier, entretien, gestion…' : <>Ajoutez d’abord un bien dans <a href="#/biens">Mes biens</a>.</>}
        </EmptyState>} />
      )}
      <div className="export-row">
        <span className="muted">Exporter la liste affichée :</span>
        <Button size="sm" onClick={() => void exp('xlsx')}>Excel (.xlsx)</Button>
        <Button size="sm" onClick={() => void exp('csv')}>CSV</Button>
      </div>
      <p className="muted small">La nature d’une dépense sert au suivi ; elle ne vaut pas qualification fiscale. Faites valider les cas particuliers (travaux, mobilier) par un professionnel.</p>
      <ExpenseDialog expense={edit} onClose={() => setEdit(null)} propertyId={property || propertyId} />
      <ExpenseImportDialog open={importing} onClose={() => setImporting(false)} />
      {dialog}
    </>
  );
}

export function ExpenseDialog({ expense, onClose, propertyId }: { expense: Expense | 'new' | null; onClose: () => void; propertyId?: string }) {
  const store = useStore();
  const upload = useUpload();
  const existing = expense && expense !== 'new' ? expense : null;
  const owned = store.data.properties.filter((p) => p.status === 'acquis');
  const blank = (): Insert<Expense> => ({ property_id: propertyId ?? (owned.length === 1 ? owned[0]!.id : ''), expense_date: todayParis(), amount: undefined, category: 'copropriete', nature: 'charge', recoverable_amount: 0, payment_status: 'paye', paid_on: todayParis(), supplier: '', label: '' });
  const [d, setD] = useState<Insert<Expense>>(blank);
  const [key, setKey] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState<Expense[] | null>(null);
  const k = existing?.id ?? (expense === 'new' ? 'new' : null);
  if (k !== key) { setKey(k); setD(existing ? { ...existing } : blank()); setFile(null); setErr(null); setDups(null); }
  const set = <K extends keyof Expense>(f: K, v: Expense[K] | null | undefined) => { setDups(null); setD((x) => ({ ...x, [f]: v })); };

  async function save() {
    setErr(null);
    if (!d.property_id) return setErr('Choisissez le bien.');
    if (!d.expense_date) return setErr('Indiquez la date.');
    if (!(d.amount && d.amount > 0)) return setErr('Indiquez un montant positif.');
    if ((d.recoverable_amount ?? 0) < 0 || (d.recoverable_amount ?? 0) > d.amount) return setErr('La part récupérable doit être comprise entre 0 et le montant.');
    if (d.amortization_years != null && !(d.amortization_years > 0 && d.amortization_years <= 50)) return setErr('Durée d’amortissement entre 1 et 50 ans.');
    if (d.payment_status === 'paye' && !d.paid_on) return setErr('Indiquez la date de paiement.');
    if (!dups) {
      const same = findDuplicates({ id: existing?.id, property_id: d.property_id, amount: round2(d.amount), expense_date: d.expense_date, category: d.category!, label: d.label ?? null, supplier: d.supplier ?? null }, store.data.expenses, sameExpense);
      if (same.length) { setDups(same); return; }
    }
    setBusy(true);
    try {
      let documentId = d.document_id ?? null;
      if (file) {
        const doc = await upload(file, { title: `Justificatif – ${d.supplier || EXPENSE_CATEGORY_LABELS[d.category!]} ${date(d.expense_date)}`, category: 'facture', property_id: d.property_id });
        if (!doc) return;
        documentId = doc.id;
      }
      const { id: _i, user_id: _u, version: _v, created_at: _c, updated_at: _up, ...rest } = d as Partial<Expense>;
      if (rest.amortization_years == null) delete rest.amortization_years; // compatibilité avant migration
      const payload: Insert<Expense> = { ...rest, amount: round2(d.amount), recoverable_amount: round2(d.recoverable_amount ?? 0), supplier: d.supplier?.trim() || null, label: d.label?.trim() || null,
        paid_on: d.payment_status === 'paye' ? d.paid_on : null, document_id: documentId };
      const row = existing ? await store.update('expenses', existing, payload, 'La dépense') : await store.create('expenses', payload);
      if (row) { store.notify('Dépense enregistrée.'); onClose(); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!expense} wide title={existing ? 'Modifier la dépense' : 'Ajouter une dépense'} onClose={onClose}
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Enregistrement…' : dups ? 'Enregistrer quand même' : 'Enregistrer'}</Button></>}>
      <div className="grid">
        <Select label="Bien" value={d.property_id || null} onChange={(v) => set('property_id', v ?? '')} allowEmpty="Choisir…" options={owned.map((p) => [p.id, p.title] as const)} />
        <TextInput label="Date" type="date" value={d.expense_date} onChange={(v) => set('expense_date', v)} />
        <Select label="Catégorie" value={d.category!} onChange={(v) => setD((x) => ({ ...x, category: v ?? 'autre', nature: existing ? x.nature : defaultNature(v ?? 'autre') }))} options={CATS} />
        <Select label="Nature" value={d.nature!} onChange={(v) => set('nature', v ?? 'charge')} options={NATURES} hint={NATURE_HINT[d.nature!]} />
        <TextInput label="Fournisseur" value={d.supplier} onChange={(v) => set('supplier', v)} maxLength={200} />
        <TextInput label="Libellé" value={d.label} onChange={(v) => set('label', v)} maxLength={300} />
        <NumberInput label={d.category === 'loyer' ? 'Montant reçu' : 'Montant TTC'} suffix="€" value={d.amount ?? null} onChange={(v) => set('amount', v ?? undefined)} />
        <NumberInput label="Part récupérable sur le locataire" suffix="€" value={d.recoverable_amount ?? 0} onChange={(v) => set('recoverable_amount', v ?? 0)} />
        {(d.nature === 'immobilisation' || d.category === 'mobilier' || d.category === 'entretien_amortissable' || (d.amortization_years ?? 0) > 0) && (
          <NumberInput label="Durée d’amortissement" suffix="ans" value={d.amortization_years ?? null} onChange={(v) => set('amortization_years', v)}
            hint={`Vide : durée par défaut (${d.category === 'mobilier' ? 'meubles 7 ans' : 'travaux 10 ans'}, réglable dans la déclaration fiscale). Les amortissements de l’année s’ajoutent à la déclaration (LMNP au réel).`} />
        )}
        <Select label="Statut" value={d.payment_status!} onChange={(v) => set('payment_status', v ?? 'paye')} options={[['paye', 'Payée'], ['a_payer', 'À payer']] as const} />
        {d.payment_status === 'paye' && <TextInput label="Payée le" type="date" value={d.paid_on} onChange={(v) => set('paid_on', v || null)} />}
        <div className="field field-wide">
          <label htmlFor="exp-file">Justificatif {d.document_id && !file ? '(déjà joint, remplacer ?)' : ''}</label>
          <input id="exp-file" type="file" accept="application/pdf,image/*,.heic" onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            const m = f ? checkFile(f) : null;
            setErr(m);
            setFile(f && !m ? f : null);
          }} />
          <small className="muted">Enregistré dans Documents (catégorie Facture), 10 Mo maximum.</small>
        </div>
        <TextArea label="Notes" value={d.notes} onChange={(v) => set('notes', v || null)} rows={2} />
      </div>
      {dups && <DupWarning dups={dups} titles={new Map(store.data.properties.map((p) => [p.id, p.title]))} />}
      {err && <p className="form-error" role="alert">{err}</p>}
    </Modal>
  );
}

/** Ajout d'une ligne en une fois, sans ouvrir de fenêtre : date, bien, catégorie, libellé, montant. */
function QuickAdd({ owned, defaultProperty }: { owned: { id: string; title: string }[]; defaultProperty: string }) {
  const store = useStore();
  const today = todayParis();
  const [d, setD] = useState({ property_id: defaultProperty, expense_date: today, category: 'copropriete' as ExpenseCategory, label: '', amount: '' });
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState<Expense[] | null>(null);
  const amount = Number(d.amount.replace(/\s/g, '').replace(',', '.'));
  const ok = d.property_id && d.expense_date && Number.isFinite(amount) && amount > 0;
  async function add() {
    if (!ok) { store.notify('Indiquez le bien, la date et un montant positif.', 'error'); return; }
    if (!dups) {
      const same = findDuplicates({ property_id: d.property_id, amount: round2(amount), expense_date: d.expense_date, category: d.category, label: d.label.trim() || null, supplier: null }, store.data.expenses, sameExpense);
      if (same.length) { setDups(same); return; }
    }
    setBusy(true);
    try {
      const row = await store.create('expenses', { property_id: d.property_id, expense_date: d.expense_date, category: d.category, nature: defaultNature(d.category),
        label: d.label.trim() || null, amount: round2(amount), recoverable_amount: 0, payment_status: 'paye', paid_on: d.expense_date, supplier: null });
      if (row) { store.notify('Ligne ajoutée.'); setD((x) => ({ ...x, label: '', amount: '' })); setDups(null); }
    } finally { setBusy(false); }
  }
  const upd = (patch: Partial<typeof d>) => { setDups(null); setD({ ...d, ...patch }); };
  return (
    <>
    <form className="quick-add" onSubmit={(e) => { e.preventDefault(); void add(); }} aria-label="Ajout rapide d’une dépense">
      <input type="date" aria-label="Date" value={d.expense_date} onChange={(e) => upd({ expense_date: e.target.value })} />
      <select aria-label="Bien" value={d.property_id} onChange={(e) => upd({ property_id: e.target.value })}>
        <option value="">Bien…</option>{owned.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>
      <select aria-label="Catégorie" value={d.category} onChange={(e) => upd({ category: e.target.value as ExpenseCategory })}>
        {CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <input aria-label="Libellé" placeholder="Libellé" maxLength={300} value={d.label} onChange={(e) => upd({ label: e.target.value })} />
      <input aria-label="Montant" placeholder="Montant €" inputMode="decimal" value={d.amount} onChange={(e) => upd({ amount: e.target.value })} />
      <Button type="submit" variant="primary" disabled={busy}>{dups ? 'Ajouter quand même' : '+ Ajouter'}</Button>
    </form>
    {dups && <DupWarning dups={dups} titles={new Map(owned.map((p) => [p.id, p.title]))} onCancel={() => setDups(null)} />}
    </>
  );
}

function DupWarning({ dups, titles, onCancel }: { dups: Expense[]; titles: Map<string, string>; onCancel?: () => void }) {
  return (
    <div className="note note-warn" role="alert">
      <strong>Doublon probable.</strong> {dups.length > 1 ? 'Des lignes semblables existent déjà' : 'Une ligne semblable existe déjà'} :
      <ul>{dups.slice(0, 5).map((e) => <li key={e.id}>{date(e.expense_date)} · {titles.get(e.property_id) ?? '—'} · {EXPENSE_CATEGORY_LABELS[e.category]}{e.label ? ` · ${e.label}` : ''} · {money2(e.amount)}</li>)}</ul>
      S’il s’agit bien d’une autre dépense, enregistrez quand même{onCancel ? <>, ou <button type="button" className="link" onClick={onCancel}>modifiez la saisie</button></> : ''}.
    </div>
  );
}
