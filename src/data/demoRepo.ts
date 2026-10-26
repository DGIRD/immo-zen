import { createDemoPlatform } from './platform.ts';
/**
 * Mode démonstration : données stockées uniquement dans ce navigateur (localStorage).
 * Aucune sauvegarde en ligne, aucun e-mail, aucun paiement. Signalé en permanence dans l'interface.
 * Reproduit les règles serveur utiles pour tester l'interface : versions, statut « acquis »,
 * historique, échéancier, plafonds de répartition, quittances uniques, relances.
 * Les e-mails sont placés en file mais ne partent jamais.
 */
import { applyStatusRules, statusEventSummary } from '../domain/property.ts';
import { allocatedByCharge, chargeTotal, LEASE_START_MIN, leaseTenants, planCharges, startChangeImpact, tenantName } from '../domain/rental.ts';
import { round2 } from '../domain/simulator.ts';
import { todayParis } from '../domain/format.ts';
import { EMPTY_SNAPSHOT, RepoError, type Repo, type SessionInfo, type Snapshot, type UpdateResult } from './repo.ts';
import type { LeaseRevision, TenantAccount } from './types.ts';
import type {
  Allocation, Insert, Lease, OutboxMessage, Patch, Payment, Property, Receipt, Reminder, RentCharge, Scenario, Tables, TableName,
  TimelineEvent, UserSettings, VersionedTable,
} from './types.ts';

const KEY = 'immozen:demo:v1';
const FILES = 'immozen:demo:file:';
const USER = '00000000-0000-4000-8000-000000000001';
const SESSION: SessionInfo = { userId: USER, email: 'demo@immo-zen.local' };
const DEMO_FILE_LIMIT = 2 * 1024 * 1024;

type Db = { [K in TableName]: Tables[K][] } & { user_settings: UserSettings; receipts: Receipt[]; email_outbox: OutboxMessage[]; lease_revisions: LeaseRevision[]; tenant_accounts: TenantAccount[] };

function emptyDb(): Db {
  return {
    properties: [], scenarios: [], pro_contacts: [], property_tasks: [], timeline_events: [], tenants: [], leases: [], lease_tenants: [],
    rent_charges: [], payments: [], payment_allocations: [], deposit_movements: [], reminders: [], documents: [], expenses: [],
    receipts: [], email_outbox: [], lease_revisions: [], tenant_accounts: [],
    user_settings: { user_id: USER, simulator_defaults: {}, ui_prefs: {}, rental_settings: {}, version: 1, updated_at: new Date().toISOString() },
  };
}

const PROPERTY_DEFAULTS: Omit<Property, 'id' | 'user_id' | 'version' | 'created_at' | 'updated_at' | 'title'> = {
  status: 'repere', status_before_archive: null, occupation_status: null, property_type: 'appartement',
  address: null, zip: null, city: null, surface: null, rooms: null, dpe: null, listing_url: null,
  asking_price: null, offer_price: null, works_budget: null, estimated_rent: null, charges_provision: null, property_tax_annual: null, copro_charges_annual: null, pno_annual: null, management_annual: null, gli_annual: null, other_charges_annual: null, agency_id: null, agent_id: null,
  next_action: null, follow_up_date: null, visit_at: null, comments: null, vigilance: [], ownership_mode: null,
  tax_regime: null, acquired_at: null, acquisition_cost: null, acquisition_snapshot: null, primary_scenario_id: null,
  legacy_simulation_id: null, legacy_ref: null,
};
const DEFAULTS: Partial<Record<TableName, Record<string, unknown>>> = {
  properties: PROPERTY_DEFAULTS,
  scenarios: { property_id: null, name: 'Scénario', inputs: {}, results: null, engine_version: '1', archived_at: null, legacy_simulation_id: null },
  pro_contacts: { kind: 'autre', organization_id: null, organization_name: null, email: null, phone: null, sector: null, notes: null, next_follow_up: null, archived_at: null, legacy_source: null },
  property_tasks: { due_date: null, done_at: null },
  timeline_events: { property_id: null, contact_id: null, channel: null, data: {} },
  tenants: { first_name: null, email: null, phone: null, notes: null, archived_at: null },
  leases: { label: null, furnished: false, end_date: null, charges_amount: 0, charges_mode: 'provision', deposit_amount: 0, payment_day: 1, landlord_name: null,
    landlord_address: null, owner_confirmation_email: false, receipt_auto_send: false, reminder_enabled: false, reminder_delay_days: 10, notes: null },
  lease_tenants: { left_on: null },
  rent_charges: { kind: 'loyer', label: null, cancelled_at: null, charges_amount: 0, rent_amount: 0 },
  payments: { date_defaulted: false, method: 'virement', reference: null, comment: null, source: 'saisie' },
  deposit_movements: { comment: null },
  reminders: { level: 1, charge_ids: [], debt_amount: 0, recipients: [], status: 'brouillon', created_by: 'proprietaire', sent_at: null, error: null },
  documents: { property_id: null, lease_id: null, tenant_id: null, category: 'autre', notes: null, shared_with_tenant: false },
  expenses: { supplier: null, label: null, nature: 'charge', recoverable_amount: 0, payment_status: 'paye', paid_on: null, document_id: null, notes: null, account: null, import_ref: null },
};
const UNVERSIONED: TableName[] = ['timeline_events', 'lease_tenants', 'payment_allocations', 'deposit_movements'];
const fail = (m: string): never => { throw new RepoError(m); };

export function createDemoRepo(storage: Storage = localStorage): Repo {
  let listeners: ((s: SessionInfo | null, e: string) => void)[] = [];
  let signedIn = true;

  const read = (): Db => {
    try {
      const raw = storage.getItem(KEY);
      return raw ? { ...emptyDb(), ...(JSON.parse(raw) as Db) } : emptyDb();
    } catch {
      return emptyDb();
    }
  };
  const write = (db: Db) => storage.setItem(KEY, JSON.stringify(db));
  const now = () => new Date().toISOString();
  const today = () => todayParis();

  function logEvent(db: Db, e: Pick<TimelineEvent, 'property_id' | 'kind' | 'summary' | 'data'>) {
    db.timeline_events.push({ id: crypto.randomUUID(), user_id: USER, contact_id: null, channel: null, occurred_at: now(), created_at: now(), ...e });
  }
  const allocated = (db: Db, chargeId: string) => allocatedByCharge(db.payment_allocations).get(chargeId) ?? 0;
  const hasQuittance = (db: Db, chargeId: string) => db.receipts.some((r) => r.charge_id === chargeId && r.kind === 'quittance' && !r.cancelled_at);

  // ---------- règles reproduites du serveur ----------
  function checkInsert(db: Db, table: TableName, rec: Record<string, unknown>) {
    if (table === 'timeline_events' && !['exchange', 'note', 'visit'].includes(String(rec.kind))) fail('Action refusée par le serveur (droits insuffisants).');
    if (table === 'leases') {
      const p = db.properties.find((x) => x.id === rec.property_id);
      if (!p || p.status !== 'acquis') fail('Un bail ne peut concerner qu’un bien détenu (rubrique Mes biens).');
      if (rec.end_date && String(rec.end_date) < String(rec.start_date)) fail('La date de fin précède la date de début.');
    }
    if (table === 'lease_tenants' && db.lease_tenants.some((l) => l.lease_id === rec.lease_id && l.tenant_id === rec.tenant_id)) fail('Ce locataire figure déjà sur le bail.');
    if (table === 'rent_charges' && rec.kind === 'loyer' && db.rent_charges.some((c) => c.lease_id === rec.lease_id && c.kind === 'loyer' && c.period_start === rec.period_start)) {
      fail('Cet élément existe déjà.');
    }
    if (table === 'payments' && !(Number(rec.amount) > 0)) fail('Le montant doit être positif.');
    if (table === 'payment_allocations') {
      const p = db.payments.find((x) => x.id === rec.payment_id);
      const c = db.rent_charges.find((x) => x.id === rec.charge_id);
      if (!p || !c) fail('Élément lié introuvable (supprimé entre-temps ?).');
      if (p!.lease_id !== c!.lease_id) fail('Le paiement et l’échéance concernent des baux différents.');
      if (c!.cancelled_at) fail('Cette échéance est annulée.');
      const onPay = round2(db.payment_allocations.filter((a) => a.payment_id === p!.id).reduce((s, a) => s + a.amount, 0));
      if (round2(onPay + Number(rec.amount)) > p!.amount) fail('La répartition dépasse le montant du paiement.');
      if (round2(allocated(db, c!.id) + Number(rec.amount)) > chargeTotal(c!)) fail('La répartition dépasse le montant dû de l’échéance.');
    }
    if (table === 'reminders' && rec.status !== 'brouillon') fail('Une relance est créée en brouillon.');
    if (table === 'expenses') {
      if (Number(rec.recoverable_amount ?? 0) > Number(rec.amount)) fail('Une valeur ne respecte pas les règles de saisie.');
      if (rec.payment_status === 'paye' && !rec.paid_on) fail('Indiquez la date de paiement.');
      // index unique (user_id, import_ref) du serveur
      if (rec.import_ref && db.expenses.some((e) => e.import_ref === rec.import_ref)) fail('Cette ligne de relevé a déjà été importée.');
    }
    if (table === 'payments' && rec.import_ref && db.payments.some((p) => p.import_ref === rec.import_ref)) fail('Ce loyer a déjà été importé.');
    if (table === 'documents' && Number(rec.size_bytes) > DEMO_FILE_LIMIT) fail('Fichier trop volumineux pour le mode démonstration (2 Mo).');
  }

  function issue(db: Db, chargeId: string, kind: Receipt['kind']): Receipt {
    const c = db.rent_charges.find((x) => x.id === chargeId) ?? fail('Échéance introuvable.');
    if (c.cancelled_at) fail('Échéance annulée.');
    const total = chargeTotal(c);
    const paid = allocated(db, c.id);
    if (kind === 'quittance') {
      if (inExtras(db, c.id)) fail('Cette somme figure déjà en rappel de charges sur une quittance.');
      const existing = db.receipts.find((r) => r.charge_id === c.id && r.kind === 'quittance' && !r.cancelled_at);
      if (existing) return existing;
      if (total <= 0 || paid < total) fail(`Quittance impossible : la période n’est pas intégralement réglée (${paid.toFixed(2).replace('.', ',')} € sur ${total.toFixed(2).replace('.', ',')} €).`);
    } else {
      if (paid <= 0) fail('Aucun paiement enregistré sur cette échéance.');
      if (paid >= total) fail('Échéance intégralement réglée : émettez une quittance.');
    }
    const l = db.leases.find((x) => x.id === c.lease_id)!;
    const p = db.properties.find((x) => x.id === l.property_id);
    const ts = leaseTenants(l.id, db.lease_tenants.filter((x) => !x.left_on || x.left_on >= c.period_start), db.tenants, false);
    const year = today().slice(0, 4);
    const seq = db.receipts.filter((r) => r.kind === kind && r.issued_on.startsWith(year)).length + 1;
    const pays = db.payment_allocations.filter((a) => a.charge_id === c.id).map((a) => {
      const py = db.payments.find((x) => x.id === a.payment_id)!;
      return { date: py.paid_on, amount: a.amount, method: py.method };
    }).sort((a, b) => a.date.localeCompare(b.date));
    const r: Receipt = {
      id: crypto.randomUUID(), user_id: USER, lease_id: l.id, charge_id: c.id, kind, number: `${kind === 'quittance' ? 'Q' : 'R'}-${year}-${String(seq).padStart(4, '0')}`,
      issued_on: today(), period_start: c.period_start, period_end: c.period_end, rent_amount: c.rent_amount, charges_amount: c.charges_amount,
      paid_amount: Math.min(paid, total), payments: pays, tenant_names: ts.map(tenantName).sort((a, b) => a.localeCompare(b)).join(', ') || '—',
      tenant_emails: ts.map((t) => t.email).filter((e): e is string => !!e), landlord_name: l.landlord_name, landlord_address: l.landlord_address,
      property_address: p ? [p.address, p.zip, p.city].filter(Boolean).join(' ') || null : null,
      send_status: 'non_envoye', sent_at: null, send_error: null, cancelled_at: null, cancel_reason: null, created_at: now(),
    };
    db.receipts.push(r);
    return r;
  }

  function inExtras(db: Db, chargeId: string) {
    return db.receipts.some((r) => !r.cancelled_at && r.kind === 'quittance' && (r.extra_lines ?? []).some((x) => x.charge_id === chargeId));
  }

  function queueEmail(db: Db, m: Omit<OutboxMessage, 'id' | 'user_id' | 'status' | 'attempts' | 'last_error' | 'sent_at' | 'created_at'> & { dedupe: string }) {
    const { dedupe, ...rest } = m;
    if (db.email_outbox.some((o) => (o as OutboxMessage & { dedupe?: string }).dedupe === dedupe)) return;
    db.email_outbox.push({ ...rest, id: crypto.randomUUID(), user_id: USER, status: 'a_envoyer', attempts: 0,
      last_error: 'Mode démonstration : aucun e-mail n’est envoyé.', sent_at: null, created_at: now(), dedupe } as OutboxMessage);
  }

  function queueReceipt(db: Db, r: Receipt) {
    if (!r.tenant_emails.length) fail('Aucune adresse e-mail de locataire : renseignez-la dans la fiche locataire.');
    queueEmail(db, { kind: 'quittance', to_emails: r.tenant_emails, subject: `${r.kind === 'quittance' ? 'Quittance de loyer' : 'Reçu de paiement partiel'} – ${r.period_start.slice(5, 7)}/${r.period_start.slice(0, 4)}`,
      receipt_id: r.id, reminder_id: null, lease_id: r.lease_id, charge_id: r.charge_id, dedupe: `recu:${r.id}` });
    r.send_status = 'a_envoyer';
  }

  function afterAllocation(db: Db, chargeId: string) {
    const c = db.rent_charges.find((x) => x.id === chargeId)!;
    const l = db.leases.find((x) => x.id === c.lease_id)!;
    if (!l.receipt_auto_send || c.cancelled_at || allocated(db, c.id) !== chargeTotal(c) || hasQuittance(db, c.id)) return;
    const r = issue(db, c.id, 'quittance');
    if (r.tenant_emails.length) queueReceipt(db, r);
  }

  function insertOne<T extends TableName>(db: Db, table: T, row: Insert<Tables[T]>): Tables[T] {
    const t = now();
    let rec = { ...(DEFAULTS[table] ?? {}), ...row, user_id: USER, created_at: t } as Record<string, unknown>;
    if (table !== 'lease_tenants') rec.id = row.id ?? crypto.randomUUID();
    if (!UNVERSIONED.includes(table)) Object.assign(rec, { version: 1, updated_at: t });
    if (table === 'timeline_events') rec.occurred_at = rec.occurred_at ?? t;
    checkInsert(db, table, rec);
    if (table === 'properties') {
      rec = applyStatusRules(null, rec as unknown as Property, db.scenarios) as unknown as Record<string, unknown>;
      const ev = statusEventSummary(null, (rec as unknown as Property).status);
      logEvent(db, { property_id: String(rec.id), kind: ev.kind, summary: ev.summary, data: { status: rec.status } });
    }
    (db[table] as unknown as Record<string, unknown>[]).push(rec);
    if (table === 'payment_allocations') afterAllocation(db, String(rec.charge_id));
    return structuredClone(rec) as unknown as Tables[T];
  }

  function cascadeDelete(db: Db, table: TableName, id: string) {
    if (table === 'properties') {
      db.scenarios = db.scenarios.filter((s) => s.property_id !== id);
      db.property_tasks = db.property_tasks.filter((t) => t.property_id !== id);
      db.timeline_events = db.timeline_events.filter((e) => e.property_id !== id);
      db.expenses = db.expenses.filter((e) => e.property_id !== id);
      db.documents = db.documents.filter((d) => d.property_id !== id);
      for (const l of db.leases.filter((x) => x.property_id === id)) cascadeDelete(db, 'leases', l.id);
      db.leases = db.leases.filter((l) => l.property_id !== id);
    }
    if (table === 'leases') {
      const charges = new Set(db.rent_charges.filter((c) => c.lease_id === id).map((c) => c.id));
      const pays = new Set(db.payments.filter((p) => p.lease_id === id).map((p) => p.id));
      db.payment_allocations = db.payment_allocations.filter((a) => !charges.has(a.charge_id) && !pays.has(a.payment_id));
      db.rent_charges = db.rent_charges.filter((c) => c.lease_id !== id);
      db.payments = db.payments.filter((p) => p.lease_id !== id);
      db.lease_tenants = db.lease_tenants.filter((l) => l.lease_id !== id);
      db.deposit_movements = db.deposit_movements.filter((d) => d.lease_id !== id);
      db.receipts = db.receipts.filter((r) => r.lease_id !== id);
      db.reminders = db.reminders.filter((r) => r.lease_id !== id);
      db.documents.forEach((d) => { if (d.lease_id === id) d.lease_id = null; });
    }
    if (table === 'tenants') {
      db.lease_tenants = db.lease_tenants.filter((l) => l.tenant_id !== id);
      db.documents.forEach((d) => { if (d.tenant_id === id) d.tenant_id = null; });
    }
    if (table === 'payments') db.payment_allocations = db.payment_allocations.filter((a) => a.payment_id !== id);
    if (table === 'documents') db.expenses.forEach((e) => { if (e.document_id === id) e.document_id = null; });
    if (table === 'pro_contacts') {
      db.properties.forEach((p) => { if (p.agency_id === id) p.agency_id = null; if (p.agent_id === id) p.agent_id = null; });
      db.pro_contacts.forEach((c) => { if (c.organization_id === id) c.organization_id = null; });
      db.timeline_events.forEach((e) => { if (e.contact_id === id) e.contact_id = null; });
    }
    if (table === 'scenarios') db.properties.forEach((p) => { if (p.primary_scenario_id === id) p.primary_scenario_id = null; });
  }

  return {
    mode: 'demo',
    platform: createDemoPlatform(storage, () => (signedIn ? SESSION.userId : null), () => SESSION.email),
    async getSession() { return signedIn ? SESSION : null; },
    onAuthChange(cb) {
      listeners.push(cb);
      return () => { listeners = listeners.filter((l) => l !== cb); };
    },
    async signIn() { signedIn = true; listeners.forEach((l) => l(SESSION, 'SIGNED_IN')); },
    async signUp() { signedIn = true; listeners.forEach((l) => l(SESSION, 'SIGNED_IN')); return 'session'; },
    async signOut() { signedIn = false; listeners.forEach((l) => l(null, 'SIGNED_OUT')); },
    async requestPasswordReset() { throw new RepoError('Indisponible en mode démonstration (aucun e-mail n’est envoyé).'); },
    async updatePassword() { throw new RepoError('Indisponible en mode démonstration.'); },

    async loadAll(): Promise<Snapshot> {
      const db = read();
      return {
        ...EMPTY_SNAPSHOT,
        properties: db.properties, scenarios: db.scenarios, contacts: db.pro_contacts, tasks: db.property_tasks, events: db.timeline_events,
        tenants: db.tenants, leases: db.leases, leaseTenants: db.lease_tenants, charges: db.rent_charges, payments: db.payments,
        allocations: db.payment_allocations, deposits: db.deposit_movements, receipts: db.receipts, reminders: db.reminders,
        documents: db.documents, expenses: db.expenses, outbox: db.email_outbox, revisions: db.lease_revisions ?? [], tenantAccounts: db.tenant_accounts ?? [], settings: db.user_settings, loadedAt: now(),
      };
    },
    async insert(table, row) {
      const db = read();
      const rec = insertOne(db, table, row);
      write(db);
      return rec;
    },
    async insertMany(table, rows) {
      const db = read();
      const out = rows.map((r) => insertOne(db, table, r));
      write(db);
      return out;
    },
    async update<T extends VersionedTable>(table: T, id: string, version: number, patch: Patch<Tables[T]>): Promise<UpdateResult<Tables[T]>> {
      const db = read();
      const list = db[table] as unknown as (Tables[T] & { version: number })[];
      const idx = list.findIndex((r) => r.id === id);
      if (idx < 0) return { status: 'missing' };
      const prev = list[idx]!;
      if (prev.version !== version) return { status: 'conflict', current: structuredClone(prev) };
      let next = { ...prev, ...patch, id: prev.id, user_id: prev.user_id, created_at: prev.created_at, version: prev.version + 1, updated_at: now() } as Tables[T];
      if (table === 'properties') {
        const p0 = prev as unknown as Property;
        const p1 = applyStatusRules(p0, next as unknown as Property, db.scenarios as Scenario[]);
        if (p1.status !== 'acquis' && p1.occupation_status) throw new RepoError('Une valeur ne respecte pas les règles de saisie.');
        next = p1 as unknown as Tables[T];
        if (p0.status !== p1.status) {
          const ev = statusEventSummary(p0.status, p1.status);
          logEvent(db, { property_id: p1.id, kind: ev.kind, summary: ev.summary, data: { from: p0.status, to: p1.status } });
        }
      }
      if (table === 'payments') {
        const p = next as unknown as Payment;
        const onPay = round2(db.payment_allocations.filter((a) => a.payment_id === id).reduce((s, a) => s + a.amount, 0));
        if (p.amount < onPay) fail('Le montant est inférieur à ce qui est déjà réparti sur les échéances.');
      }
      if (table === 'rent_charges') {
        const c = next as unknown as RentCharge;
        const paid = allocated(db, id);
        if (chargeTotal(c) < paid) fail('Le montant dû ne peut pas être inférieur à ce qui est déjà réglé.');
        if (c.cancelled_at && !(prev as unknown as RentCharge).cancelled_at && paid > 0) fail('Une échéance ayant reçu des paiements ne peut pas être annulée.');
      }
      if (table === 'reminders') {
        const r0 = prev as unknown as Reminder;
        const r1 = next as unknown as Reminder;
        if (r0.status !== 'brouillon') fail('Seule une relance en brouillon peut être modifiée.');
        if (!['brouillon', 'annule', 'envoye_manuellement'].includes(r1.status)) fail('Statut de relance non autorisé.');
        if (r1.status === 'envoye_manuellement') r1.sent_at = now();
      }
      if (table === 'leases') {
        const l0 = prev as unknown as Lease;
        const l1 = next as unknown as Lease;
        if (l1.property_id !== l0.property_id && db.rent_charges.some((c) => c.lease_id === id)) fail('Le bien d’un bail ayant des échéances ne peut pas être changé.');
        if (l1.end_date && l1.end_date < l1.start_date) fail('La date de fin précède la date de début.');
        if (l1.start_date < LEASE_START_MIN) fail('Date de début improbable : vérifiez l’année.');
        if (l1.start_date !== l0.start_date) {
          // échéances antérieures à la nouvelle date (et premier mois à reproratiser) : supprimées, régénérées ensuite
          const imp = startChangeImpact(l0, l1.start_date, db.rent_charges, db.payment_allocations, db.receipts);
          if (imp.blocked.length) fail(`${imp.blocked.length} échéance(s) concernée(s) par la nouvelle date de début ont reçu un paiement ou une quittance : retirez-les avant de modifier la date.`);
          const gone = new Set(imp.remove.map((c) => c.id));
          db.rent_charges = db.rent_charges.filter((c) => !gone.has(c.id));
          db.payment_allocations = db.payment_allocations.filter((a) => !gone.has(a.charge_id));
          db.receipts = db.receipts.filter((r) => !gone.has(r.charge_id));
          db.reminders.forEach((r) => { r.charge_ids = r.charge_ids.filter((x) => !gone.has(x)); });
        }
        if (l1.end_date && (!l0.end_date || l1.end_date < l0.end_date)) {
          db.rent_charges.forEach((c) => {
            if (c.lease_id === id && c.kind === 'loyer' && c.period_start > l1.end_date! && !c.cancelled_at && allocated(db, c.id) === 0) c.cancelled_at = now();
          });
        }
      }
      if (table === 'expenses') {
        const e = next as unknown as Tables['expenses'];
        if (e.recoverable_amount > e.amount) fail('Une valeur ne respecte pas les règles de saisie.');
        if (e.payment_status === 'paye' && !e.paid_on) fail('Indiquez la date de paiement.');
      }
      list[idx] = next;
      write(db);
      return { status: 'ok', row: structuredClone(next) };
    },
    async updateWhere(table, match, patch) {
      const db = read();
      (db[table] as unknown as Record<string, unknown>[]).forEach((r) => {
        if (Object.entries(match).every(([k, v]) => r[k] === v)) Object.assign(r, patch);
      });
      write(db);
    },
    async remove(table, id) {
      const db = read();
      if (table === 'payments' && db.payment_allocations.some((a) => a.payment_id === id && hasQuittance(db, a.charge_id))) {
        fail('Ce paiement est couvert par une quittance : annulez-la avant de supprimer le paiement.');
      }
      if (table === 'payment_allocations') {
        const a = db.payment_allocations.find((x) => x.id === id);
        if (a && hasQuittance(db, a.charge_id)) fail('Une quittance a été émise pour cette échéance : annulez-la avant de modifier ses paiements.');
      }
      if (table === 'rent_charges' && allocated(db, id) > 0) fail('Cette échéance a reçu des paiements : retirez-les ou annulez l’échéance.');
      cascadeDelete(db, table, id);
      (db[table] as unknown as { id: string }[]) = (db[table] as unknown as { id: string }[]).filter((r) => r.id !== id);
      write(db);
    },
    async removeWhere(table, match) {
      const db = read();
      (db[table] as unknown as Record<string, unknown>[]) = (db[table] as unknown as Record<string, unknown>[])
        .filter((r) => !Object.entries(match).every(([k, v]) => r[k] === v));
      write(db);
    },
    async saveSettings(version, patch) {
      const db = read();
      if (db.user_settings.version !== version) return { status: 'conflict', current: db.user_settings };
      db.user_settings = { ...db.user_settings, ...patch, version: version + 1, updated_at: now() };
      write(db);
      return { status: 'ok', row: db.user_settings };
    },

    async inviteTenant(tenantId) {
      const db = read();
      const t = db.tenants.find((x) => x.id === tenantId) ?? fail('Locataire introuvable.');
      if (!t.email) fail('Renseignez l’adresse e-mail du locataire pour l’inviter.');
      if (t.archived_at) fail('Ce locataire est archivé.');
      const code = crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
      const email = t.email!.toLowerCase();
      db.tenant_accounts ??= [];
      let a = db.tenant_accounts.find((x) => x.tenant_id === t.id);
      if (!a) { a = { id: crypto.randomUUID(), user_id: USER, tenant_id: t.id, email, invited_at: now(), account_user_id: null, accepted_at: null, revoked_at: null, created_at: now(), updated_at: now() }; db.tenant_accounts.push(a); }
      else Object.assign(a, { email, invited_at: now(), revoked_at: null, updated_at: now(), ...(a.email !== email ? { account_user_id: null, accepted_at: null } : {}) });
      queueEmail(db, { kind: 'invitation_locataire', to_emails: [email], subject: 'Votre espace locataire Immo-Zen',
        body_text: `Invitation à l’espace locataire (code ${code}). Mode démonstration : aucun e-mail n’est envoyé.`, receipt_id: null, reminder_id: null, lease_id: null, charge_id: null,
        dedupe: `invitation:${a.id}:${code}` } as never);
      write(db);
      return { code, email };
    },
    async revokeTenant(tenantId) {
      const db = read();
      const a = (db.tenant_accounts ?? []).find((x) => x.tenant_id === tenantId) ?? fail('Aucun accès à révoquer pour ce locataire.');
      Object.assign(a, { revoked_at: now(), updated_at: now() });
      write(db);
    },
    async acceptTenantInvite() {
      fail('Mode démonstration : l’espace locataire s’ouvre avec le compte du locataire. Utilisez « Aperçu de l’espace locataire » depuis la fiche du locataire.');
    },
    async tenantPortal() { return { accounts: [] }; },

    async generateCharges(leaseId, until) {
      const db = read();
      const l = db.leases.find((x) => x.id === leaseId) ?? fail('Bail introuvable.');
      let n = 0;
      for (const c of planCharges(l, until ?? today())) {
        if (db.rent_charges.some((x) => x.lease_id === l.id && x.kind === 'loyer' && x.period_start === c.period_start)) continue;
        insertOne(db, 'rent_charges', { lease_id: l.id, kind: 'loyer', ...c });
        n++;
      }
      write(db);
      return n;
    },
    async issueReceiptWithExtras(chargeId, extras) {
      const db = read();
      const c = db.rent_charges.find((x) => x.id === chargeId) ?? fail('Échéance introuvable.');
      if (db.receipts.some((r) => r.charge_id === c.id && r.kind === 'quittance' && !r.cancelled_at) || inExtras(db, c.id))
        fail('Une quittance existe déjà pour cette période : annulez-la pour en émettre une avec le rappel de charges.');
      const lines = extras.map((id) => {
        const x = db.rent_charges.find((y) => y.id === id);
        if (!x || x.lease_id !== c.lease_id || x.id === c.id || x.kind === 'loyer') fail('Rappel de charges invalide (autre bail ou échéance de loyer).');
        if (x!.cancelled_at) fail('Somme due annulée.');
        if (allocated(db, x!.id) < chargeTotal(x!)) fail(`Le rappel « ${x!.label ?? 'Régularisation'} » n’est pas intégralement réglé.`);
        if (inExtras(db, x!.id) || db.receipts.some((r) => r.charge_id === x!.id && r.kind === 'quittance' && !r.cancelled_at)) fail(`Le rappel « ${x!.label ?? 'Régularisation'} » figure déjà sur une quittance.`);
        return { charge_id: x!.id, label: x!.label ?? 'Rappel de charges', amount: chargeTotal(x!) };
      });
      const r = issue(db, chargeId, 'quittance');
      r.extra_lines = lines;
      r.paid_amount = round2(r.paid_amount + lines.reduce((a, x) => a + x.amount, 0));
      write(db);
      return structuredClone(r);
    },
    async reviseRent(a) {
      const db = read();
      const l = db.leases.find((x) => x.id === a.leaseId) ?? fail('Bail introuvable.');
      if (!l.irl_enabled) fail('La révision annuelle n’est pas prévue dans ce bail.');
      const p = db.properties.find((x) => x.id === l.property_id);
      if (p?.dpe === 'F' || p?.dpe === 'G') fail(`Logement classé ${p.dpe} au DPE : révision du loyer interdite (gel des loyers).`);
      if (!(a.oldIndex > 0 && a.newIndex > 0)) fail('Indices IRL manquants.');
      const addY = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;
      if (a.effective < addY(l.start_date, 1)) fail('Première révision possible un an après le début du bail.');
      let anniv = l.start_date;
      while (addY(anniv, 1) <= a.effective) anniv = addY(anniv, 1);
      if (l.last_revision_on && l.last_revision_on >= anniv) fail(`Le loyer a déjà été révisé le ${l.last_revision_on.split('-').reverse().join('/')} pour cette année de bail.`);
      const newRent = round2(l.rent_hc * a.newIndex / a.oldIndex);
      const old = l.rent_hc;
      Object.assign(l, { rent_hc: newRent, irl_base_label: a.newLabel, irl_base_value: a.newIndex, last_revision_on: a.effective, version: l.version + 1, updated_at: now() });
      let n = 0;
      for (const c of db.rent_charges) {
        const fullMonth = c.period_start.endsWith('-01') && c.period_end.slice(0, 7) === c.period_start.slice(0, 7) && Number(c.period_end.slice(8)) >= 28;
        if (c.lease_id === l.id && c.kind === 'loyer' && !c.cancelled_at && c.period_start >= a.effective && fullMonth && allocated(db, c.id) === 0) { c.rent_amount = newRent; n++; }
      }
      const rev: LeaseRevision = { id: crypto.randomUUID(), user_id: USER, lease_id: l.id, effective_on: a.effective, old_rent: old, new_rent: newRent,
        old_index_label: a.oldLabel, old_index: a.oldIndex, new_index_label: a.newLabel, new_index: a.newIndex, charges_updated: n, created_at: now() };
      (db.lease_revisions ??= []).push(rev);
      logEvent(db, { property_id: l.property_id, kind: 'note', summary: `Loyer révisé (IRL) : ${old.toFixed(2).replace('.', ',')} → ${newRent.toFixed(2).replace('.', ',')} à compter du ${a.effective.split('-').reverse().join('/')}`, data: { lease_id: l.id } });
      write(db);
      return structuredClone(rev);
    },
    async issueReceipt(chargeId, kind) {
      const db = read();
      const r = issue(db, chargeId, kind);
      write(db);
      return structuredClone(r);
    },
    async reissueReceipt(receiptId, changes = {}) {
      const db = read();
      const o = db.receipts.find((x) => x.id === receiptId) ?? fail('Document introuvable.');
      if (o.cancelled_at) fail('Document annulé : il ne peut plus être modifié.');
      if ('tenant_names' in changes && !changes.tenant_names?.trim()) fail('Indiquez le nom du ou des locataires.');
      if (changes.issued_on && changes.issued_on > today()) fail('La date d’émission ne peut pas être dans le futur.');
      o.cancelled_at = now();
      o.cancel_reason = 'Réédition';
      db.email_outbox.forEach((m) => { if (m.receipt_id === o.id && m.status === 'a_envoyer') m.status = 'annule'; });
      write(db);
      const extras = (o.extra_lines ?? []).map((x) => x.charge_id);
      let n: Receipt;
      try {
        n = o.kind === 'quittance' && extras.length ? await this.issueReceiptWithExtras(o.charge_id, extras) : await this.issueReceipt(o.charge_id, o.kind);
      } catch (e) {
        const back = read(); const r0 = back.receipts.find((x) => x.id === o.id)!; r0.cancelled_at = null; r0.cancel_reason = null; write(back);
        throw e;
      }
      const db2 = read();
      const r = db2.receipts.find((x) => x.id === n.id)!;
      for (const k of ['landlord_name', 'landlord_address', 'property_address'] as const) if (k in changes) r[k] = changes[k]?.trim() || null;
      if (changes.tenant_names !== undefined) r.tenant_names = changes.tenant_names.trim();
      if (changes.issued_on) r.issued_on = changes.issued_on;
      const old = db2.receipts.find((x) => x.id === o.id)!;
      old.cancel_reason = `Remplacé par ${r.kind === 'quittance' ? 'la quittance' : 'le reçu'} n° ${r.number}`;
      write(db2);
      return structuredClone(r);
    },
    async cancelReceipt(receiptId, reason) {
      if (!reason.trim()) fail('Indiquez le motif d’annulation.');
      const db = read();
      const r = db.receipts.find((x) => x.id === receiptId && !x.cancelled_at) ?? fail('Quittance introuvable ou déjà annulée.');
      r.cancelled_at = now();
      r.cancel_reason = reason.slice(0, 500);
      db.email_outbox.forEach((o) => { if (o.receipt_id === receiptId && o.status === 'a_envoyer') o.status = 'annule'; });
      write(db);
      return structuredClone(r);
    },
    async queueReceiptEmail(receiptId) {
      const db = read();
      const r = db.receipts.find((x) => x.id === receiptId && !x.cancelled_at) ?? fail('Document introuvable ou annulé.');
      queueReceipt(db, r);
      write(db);
    },
    async queueReminder(reminderId) {
      const db = read();
      const m = db.reminders.find((x) => x.id === reminderId) ?? fail('Relance introuvable.');
      if (m.status !== 'brouillon') fail('Cette relance n’est plus un brouillon.');
      if (!m.recipients.length) fail('Aucun destinataire : renseignez l’e-mail du locataire.');
      const due = round2(m.charge_ids.reduce((s, id) => {
        const c = db.rent_charges.find((x) => x.id === id);
        return c && !c.cancelled_at ? s + Math.max(0, chargeTotal(c) - allocated(db, id)) : s;
      }, 0));
      if (due <= 0) {
        m.status = 'annule';
        m.error = 'Dette réglée avant l’envoi';
      } else {
        queueEmail(db, { kind: 'relance', to_emails: m.recipients, subject: m.subject, receipt_id: null, reminder_id: m.id, lease_id: m.lease_id, charge_id: null, dedupe: `relance:${m.id}` });
        m.status = 'a_envoyer';
      }
      write(db);
      return structuredClone(m);
    },

    async uploadFile(path, file) {
      if (file.size > DEMO_FILE_LIMIT) fail('Fichier trop volumineux pour le mode démonstration (2 Mo).');
      const data = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      });
      try { storage.setItem(FILES + path, data); } catch { fail('Espace de stockage du navigateur insuffisant.'); }
    },
    async fileUrl(path) {
      return storage.getItem(FILES + path) ?? fail('Fichier introuvable.');
    },
    async removeFile(path) {
      storage.removeItem(FILES + path);
    },
  };
}

export function resetDemo(storage: Storage = localStorage) {
  for (let i = storage.length - 1; i >= 0; i--) {
    const k = storage.key(i);
    if (k === KEY || k?.startsWith(FILES) || k === 'immozen:demo:platform') storage.removeItem(k);
  }
}

export type { Allocation };
