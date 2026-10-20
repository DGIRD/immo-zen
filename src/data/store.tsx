import type { PlatformState } from './platform.ts';
import { planViolation, UNLIMITED_PLAN, type PlanInfo, type PlanOp } from '../domain/plans.ts';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { userDefaults, type SimulationInputs } from '../domain/simulator.ts';
import { describeError, EMPTY_SNAPSHOT, RepoError, SNAPSHOT_KEY, type Repo, type SessionInfo, type Snapshot, type TenantPortal } from './repo.ts';
import type { Insert, Patch, Tables, TableName, UserSettings, VersionedTable } from './types.ts';

export type SyncState = 'loading' | 'synced' | 'saving' | 'offline' | 'error';

export interface ConflictRequest {
  table: VersionedTable;
  label: string;
  resolve: (choice: 'reload' | 'overwrite') => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'error' | 'info';
}

interface StoreValue {
  repo: Repo;
  session: SessionInfo | null;
  authReady: boolean;
  data: Snapshot;
  sync: { state: SyncState; message?: string; lastSync?: string };
  conflict: ConflictRequest | null;
  toasts: Toast[];
  simulatorDefaults: SimulationInputs;
  /** Accès et abonnement (undefined : en cours de chargement ; null : migration du lot 3 absente). */
  platform: PlatformState | null | undefined;
  refreshPlatform(): Promise<void>;
  /** Espace locataire du compte connecté (undefined : en cours de chargement). */
  portal: TenantPortal | null | undefined;
  refreshPortal(): Promise<void>;
  notify(message: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
  refresh(): Promise<void>;
  create<T extends TableName>(table: T, row: Insert<Tables[T]>): Promise<Tables[T] | null>;
  createMany<T extends TableName>(table: T, rows: Insert<Tables[T]>[]): Promise<Tables[T][] | null>;
  update<T extends VersionedTable>(table: T, current: Tables[T], patch: Patch<Tables[T]>, label?: string): Promise<Tables[T] | null>;
  remove(table: TableName, id: string): Promise<boolean>;
  saveSettings(patch: Partial<Pick<UserSettings, 'simulator_defaults' | 'ui_prefs' | 'rental_settings' | 'tax_inputs'>>): Promise<boolean>;
  /** Appel d'une fonction serveur (échéances, quittances, relances…) puis rechargement des données. */
  call<R>(fn: (repo: Repo) => Promise<R>, success?: string): Promise<R | null>;
  removeWhere(table: TableName, match: Record<string, string>): Promise<boolean>;
  updateWhere<T extends TableName>(table: T, match: Record<string, string>, patch: Patch<Tables[T]>): Promise<boolean>;
  signOut(): Promise<void>;
}

const EMPTY: Snapshot = EMPTY_SNAPSHOT;
const CACHE_PREFIX = 'immozen:cache:';
const Ctx = createContext<StoreValue | null>(null);

const listKey = SNAPSHOT_KEY;

/** Supprime toute copie locale de données privées (déconnexion). */
export function purgePrivateCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    }
    sessionStorage.clear();
  } catch { /* stockage indisponible */ }
}

export function StoreProvider({ repo, children }: { repo: Repo; children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [sync, setSync] = useState<StoreValue['sync']>({ state: 'loading' });
  const [conflict, setConflict] = useState<ConflictRequest | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const lastRefresh = useRef(0);
  const sessionRef = useRef<SessionInfo | null>(null);
  sessionRef.current = session;

  const notify = useCallback((message: string, tone: Toast['tone'] = 'ok') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 9000 : 4000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const persist = useCallback((snap: Snapshot) => {
    const s = sessionRef.current;
    if (!s || repo.mode === 'demo') return;
    try { localStorage.setItem(CACHE_PREFIX + s.userId, JSON.stringify(snap)); } catch { /* quota */ }
  }, [repo.mode]);

  const commit = useCallback((fn: (d: Snapshot) => Snapshot) => {
    setData((d) => {
      const next = fn(d);
      persist(next);
      return next;
    });
  }, [persist]);

  const [platform, setPlatform] = useState<PlatformState | null | undefined>(undefined);
  const [portal, setPortal] = useState<TenantPortal | null | undefined>(undefined);
  const refreshPortal = useCallback(async () => {
    try { setPortal(await repo.tenantPortal()); } catch { setPortal(null); }
  }, [repo]);
  // Formule en vigueur et données courantes, lues par les vérifications faites avant chaque écriture
  const planRef = useRef<PlanInfo | null>(null);
  planRef.current = platform?.plan ?? null;
  const dataRef = useRef<Snapshot>(EMPTY);
  dataRef.current = data;
  const refresh = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    lastRefresh.current = Date.now();
    if (!navigator.onLine && repo.mode !== 'demo') {
      setSync({ state: 'offline', message: 'Hors connexion : consultation seule des données déjà chargées.' });
      return;
    }
    setSync((x) => ({ ...x, state: 'loading' }));
    try {
      const snap = await repo.loadAll();
      void repo.platform.state().then(setPlatform).catch(() => setPlatform(null));
      void refreshPortal();
      setData(snap);
      persist(snap);
      setSync({ state: 'synced', lastSync: snap.loadedAt });
    } catch (e) {
      setSync({ state: navigator.onLine ? 'error' : 'offline', message: describeError(e) });
    }
  }, [repo, persist, refreshPortal]);

  // Session
  useEffect(() => {
    let alive = true;
    repo.getSession().then((s) => {
      if (!alive) return;
      setSession(s);
      setAuthReady(true);
    }).catch(() => setAuthReady(true));
    const off = repo.onAuthChange((s, event) => {
      setSession((prev) => (prev?.userId === s?.userId ? prev : s));
      if (event === 'SIGNED_OUT') { setData(EMPTY); setPlatform(undefined); setPortal(undefined); purgePrivateCache(); }
    });
    return () => { alive = false; off(); };
  }, [repo]);

  // Chargement initial : cache local pour un affichage immédiat, puis serveur
  useEffect(() => {
    if (!session) return;
    if (repo.mode !== 'demo') {
      try {
        const raw = localStorage.getItem(CACHE_PREFIX + session.userId);
        if (raw) setData({ ...EMPTY, ...(JSON.parse(raw) as Partial<Snapshot>) });
      } catch { /* cache illisible : ignoré */ }
    }
    void refresh();
  }, [session?.userId, repo, refresh]);

  // Reprise après coupure / retour sur l'onglet
  useEffect(() => {
    const online = () => { notify('Connexion rétablie : synchronisation…', 'info'); void refresh(); };
    const offline = () => setSync({ state: 'offline', message: 'Hors connexion : consultation seule des données déjà chargées.' });
    const visible = () => { if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > 30000) void refresh(); };
    addEventListener('online', online);
    addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    return () => { removeEventListener('online', online); removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible); };
  }, [refresh, notify]);

  const guard = useCallback(() => {
    if (!navigator.onLine && repo.mode !== 'demo') {
      throw new RepoError('Hors connexion : la modification n’a pas été enregistrée. Réessayez une fois la connexion rétablie.', undefined, true);
    }
  }, [repo.mode]);

  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | null> => {
    try {
      guard();
      setSync((x) => ({ ...x, state: 'saving' }));
      const r = await fn();
      setSync({ state: 'synced', lastSync: new Date().toISOString() });
      return r;
    } catch (e) {
      const message = describeError(e);
      setSync({ state: navigator.onLine ? 'error' : 'offline', message });
      notify(message, 'error');
      return null;
    }
  }, [guard, notify]);

  const upsertLocal = useCallback(<T extends TableName>(table: T, rows: Tables[T][]) => {
    const key = listKey[table];
    commit((d) => {
      const list = [...(d[key] as unknown as { id: string }[])];
      for (const row of rows as unknown as { id: string }[]) {
        const i = list.findIndex((x) => x.id === row.id);
        if (i >= 0) list[i] = row; else list.push(row);
      }
      return { ...d, [key]: list };
    });
  }, [commit]);

  /** Refus local si l'écriture dépasse la formule (la base applique la même règle). */
  const overPlan = useCallback((op: PlanOp) => {
    const msg = planViolation(planRef.current, dataRef.current, op);
    if (msg) notify(msg, 'error');
    return !!msg;
  }, [notify]);

  const create = useCallback(async <T extends TableName>(table: T, row: Insert<Tables[T]>) => {
    if (overPlan({ table, rows: [row] })) return null;
    const rec = await run(() => repo.insert(table, row));
    refreshAfter(table, rec);
    if (rec) {
      upsertLocal(table, [rec]);
      // les déclencheurs serveur ajoutent de l'historique : on le relit sans bloquer
      if (table === 'properties') void repo.loadAll().then((s) => commit((d) => ({ ...d, events: s.events }))).catch(() => undefined);
    }
    return rec;
  }, [repo, run, upsertLocal, commit, overPlan]);

  // Effets serveur (quittance automatique, file d'e-mails…) : rechargement complet
  const refreshAfter = useCallback(<T,>(table: TableName, r: T) => {
    if (r && ['payment_allocations', 'payments', 'leases', 'rent_charges', 'lease_tenants'].includes(table)) void refresh();
    return r;
  }, [refresh]);

  const createMany = useCallback(async <T extends TableName>(table: T, rows: Insert<Tables[T]>[]) => {
    if (overPlan({ table, rows })) return null;
    const recs = await run(() => repo.insertMany(table, rows));
    if (recs) upsertLocal(table, recs);
    return refreshAfter(table, recs);
  }, [repo, run, upsertLocal, refreshAfter, overPlan]);

  const askConflict = useCallback((table: VersionedTable, label: string) =>
    new Promise<'reload' | 'overwrite'>((resolve) => setConflict({ table, label, resolve: (c) => { setConflict(null); resolve(c); } })), []);

  const update = useCallback(async <T extends VersionedTable>(table: T, current: Tables[T], patch: Patch<Tables[T]>, label = 'Cet élément') => {
    if (overPlan({ table, current, patch })) return null;
    let version = current.version;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await run(() => repo.update(table, current.id, version, patch));
      if (!res) return null;
      if (res.status === 'ok') {
        upsertLocal(table, [res.row]);
        if (table === 'properties' && 'status' in patch) {
          void repo.loadAll().then((s) => commit((d) => ({ ...d, events: s.events }))).catch(() => undefined);
        }
        return res.row;
      }
      if (res.status === 'missing') {
        notify(`${label} a été supprimé entre-temps.`, 'error');
        void refresh();
        return null;
      }
      setSync({ state: 'error', message: 'Conflit de modification' });
      const choice = await askConflict(table, label);
      if (choice === 'reload') {
        upsertLocal(table, [res.current]);
        setSync({ state: 'synced' });
        notify('Version enregistrée rechargée : vos modifications n’ont pas été appliquées.', 'info');
        return null;
      }
      version = res.current.version; // écrasement explicitement choisi
    }
    return null;
  }, [repo, run, upsertLocal, askConflict, notify, refresh, commit, overPlan]);

  const remove = useCallback(async (table: TableName, id: string) => {
    const ok = await run(async () => { await repo.remove(table, id); return true; });
    if (ok) {
      commit((d) => {
        const key = listKey[table];
        const next: Snapshot = { ...d, [key]: (d[key] as unknown as { id: string }[]).filter((x) => x.id !== id) };
        if (table === 'properties') {
          next.scenarios = next.scenarios.filter((s) => s.property_id !== id);
          next.tasks = next.tasks.filter((t) => t.property_id !== id);
          next.events = next.events.filter((e) => e.property_id !== id);
        }
        if (table === 'pro_contacts') {
          next.properties = next.properties.map((p) => ({ ...p, agency_id: p.agency_id === id ? null : p.agency_id, agent_id: p.agent_id === id ? null : p.agent_id }));
        }
        return next;
      });
      if (['properties', 'leases', 'payments', 'tenants', 'documents', 'rent_charges', 'payment_allocations'].includes(table)) void refresh();
    }
    return !!ok;
  }, [repo, run, commit, refresh]);

  const removeWhere = useCallback(async (table: TableName, match: Record<string, string>) => {
    const ok = await run(async () => { await repo.removeWhere(table, match); return true; });
    if (ok) void refresh();
    return !!ok;
  }, [repo, run, refresh]);

  const updateWhere = useCallback(async <T extends TableName>(table: T, match: Record<string, string>, patch: Patch<Tables[T]>) => {
    const ok = await run(async () => { await repo.updateWhere(table, match, patch); return true; });
    if (ok) void refresh();
    return !!ok;
  }, [repo, run, refresh]);

  const call = useCallback(async <R,>(fn: (r: Repo) => Promise<R>, success?: string) => {
    const out = await run(() => fn(repo));
    if (out !== null) {
      if (success) notify(success);
      await refresh();
    }
    return out;
  }, [repo, run, notify, refresh]);

  const saveSettings = useCallback(async (patch: Partial<Pick<UserSettings, 'simulator_defaults' | 'ui_prefs' | 'rental_settings' | 'tax_inputs'>>) => {
    const version = data.settings?.version ?? 1;
    const res = await run(() => repo.saveSettings(version, patch));
    if (!res) return false;
    if (res.status === 'ok') { commit((d) => ({ ...d, settings: res.row })); return true; }
    if (res.status === 'conflict') {
      commit((d) => ({ ...d, settings: res.current }));
      notify('Paramètres modifiés ailleurs : la dernière version a été rechargée, refaites votre modification.', 'error');
    }
    return false;
  }, [data.settings?.version, repo, run, commit, notify]);

  const signOut = useCallback(async () => {
    await repo.signOut();
    purgePrivateCache();
    setData(EMPTY);
    setSession(null);
  }, [repo]);

  const refreshPlatform = useCallback(async () => {
    try { setPlatform(await repo.platform.state()); } catch { setPlatform(null); }
  }, [repo]);

  const simulatorDefaults = useMemo(() => userDefaults(data.settings?.simulator_defaults as Record<string, unknown> | undefined), [data.settings]);

  const value: StoreValue = {
    repo, session, authReady, data, sync, conflict, toasts, simulatorDefaults, platform, refreshPlatform, portal, refreshPortal,
    notify, dismissToast, refresh, create, createMany, update, remove, removeWhere, updateWhere, call, saveSettings, signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider manquant');
  return v;
}

/** Formule du compte connecté (sans migration des formules ni contrôle activé : aucune limite). */
export function usePlan(): PlanInfo {
  const { platform } = useStore();
  return platform?.plan ?? UNLIMITED_PLAN;
}
