/**
 * Espace locataire : ce que voit un locataire (mêmes règles que la fonction serveur iz_tenant_portal) et état
 * de son accès côté bailleur. L'aperçu permet au bailleur de vérifier ce qui est partagé.
 */
import type { PortalAccount, Snapshot } from '../data/repo.ts';
import type { Tenant, TenantAccount } from '../data/types.ts';

export type AccessStatus = 'aucun' | 'invite' | 'actif' | 'revoque' | 'expire';
export const ACCESS_STATUS_LABELS: Record<AccessStatus, string> = {
  aucun: 'Non invité', invite: 'Invitation envoyée', actif: 'Espace actif', revoque: 'Accès révoqué', expire: 'Invitation expirée',
};

export function accessStatus(a: TenantAccount | undefined, now = Date.now()): AccessStatus {
  if (!a) return 'aucun';
  if (a.revoked_at) return 'revoque';
  if (a.accepted_at && a.account_user_id) return 'actif';
  if (a.invited_at && now - Date.parse(a.invited_at) > 30 * 86400000) return 'expire';
  return a.invited_at ? 'invite' : 'aucun';
}

/** Espace du locataire tel qu'il le verrait (aperçu du bailleur). */
export function portalPreview(tenant: Tenant, d: Pick<Snapshot, 'leases' | 'leaseTenants' | 'properties' | 'receipts' | 'documents'>): PortalAccount {
  const leaseIds = new Set(d.leaseTenants.filter((x) => x.tenant_id === tenant.id).map((x) => x.lease_id));
  const leases = d.leases.filter((l) => leaseIds.has(l.id)).sort((a, b) => b.start_date.localeCompare(a.start_date));
  return {
    id: `apercu-${tenant.id}`,
    tenant_id: tenant.id,
    accepted_at: new Date().toISOString(),
    tenant_name: [tenant.first_name, tenant.last_name].filter(Boolean).join(' '),
    leases: leases.map((l) => {
      const p = d.properties.find((x) => x.id === l.property_id);
      return {
        id: l.id, label: l.label, furnished: l.furnished, start_date: l.start_date, end_date: l.end_date, rent_hc: l.rent_hc, charges_amount: l.charges_amount,
        charges_mode: l.charges_mode, payment_day: l.payment_day, landlord_name: l.landlord_name, landlord_address: l.landlord_address,
        property_title: p?.title ?? '', property_address: [p?.address, p?.zip, p?.city].filter(Boolean).join(' '),
      };
    }),
    receipts: d.receipts.filter((r) => leaseIds.has(r.lease_id) && !r.cancelled_at)
      .sort((a, b) => b.period_start.localeCompare(a.period_start) || b.issued_on.localeCompare(a.issued_on))
      .map((r) => ({
        id: r.id, lease_id: r.lease_id, kind: r.kind, number: r.number, issued_on: r.issued_on, period_start: r.period_start, period_end: r.period_end,
        rent_amount: r.rent_amount, charges_amount: r.charges_amount, paid_amount: r.paid_amount, payments: r.payments, tenant_names: r.tenant_names,
        landlord_name: r.landlord_name, landlord_address: r.landlord_address, property_address: r.property_address, extra_lines: r.extra_lines,
        charges_mode: leases.find((l) => l.id === r.lease_id)?.charges_mode ?? 'provision',
      })),
    documents: d.documents.filter((x) => x.shared_with_tenant && (x.tenant_id === tenant.id || (x.lease_id && leaseIds.has(x.lease_id))))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((x) => ({ id: x.id, title: x.title, category: x.category, mime_type: x.mime_type, size_bytes: x.size_bytes, storage_path: x.storage_path, created_at: x.created_at, lease_id: x.lease_id })),
  };
}

/** Code d'invitation présent dans l'adresse (#/espace-locataire?code=…) ou mémorisé avant la création du compte. */
export const PENDING_CODE_KEY = 'immozen:tenant-invite';
export function readInviteCode(hash = location.hash): string | null {
  const m = /[?&]code=([A-Za-z0-9]{6,32})/.exec(hash);
  if (m) return m[1]!.toUpperCase();
  try { return sessionStorage.getItem(PENDING_CODE_KEY) ?? localStorage.getItem(PENDING_CODE_KEY); } catch { return null; }
}
export function rememberInviteCode(code: string | null) {
  try {
    if (code) { localStorage.setItem(PENDING_CODE_KEY, code); sessionStorage.setItem(PENDING_CODE_KEY, code); }
    else { localStorage.removeItem(PENDING_CODE_KEY); sessionStorage.removeItem(PENDING_CODE_KEY); }
  } catch { /* stockage indisponible */ }
}
