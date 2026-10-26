import { useStore } from '../data/store.tsx';
import type { Property, PropertyStatus } from '../data/types.ts';
import { STATUS_LABELS } from '../domain/labels.ts';
import { navigate } from '../ui/router.ts';
import { scenarioSummary, useDuplicate } from './propertyShared.tsx';

/** Actions métier sur un bien, partagées par les tableaux et la fiche. */
export function usePropertyActions(ask: (title: string, msg: React.ReactNode, confirm?: string, danger?: boolean) => Promise<boolean>) {
  const { update, remove, data, notify } = useStore();
  const duplicate = useDuplicate();

  async function setStatus(p: Property, status: PropertyStatus): Promise<Property | null> {
    if (status === p.status) return p;
    if (status === 'acquis') {
      const ok = await ask('Marquer comme acquis',
        <>Le bien « {p.title} » sera transféré dans <strong>Mes biens</strong>, avec son historique. Les hypothèses de sa simulation seront figées comme photographie de l’acquisition.</>,
        'Transférer dans Mes biens', false);
      if (!ok) return null;
      const s = data.scenarios.find((x) => x.id === p.primary_scenario_id);
      if (s) {
        const results = scenarioSummary(s);
        if (results) await update('scenarios', s, { results }, 'Le scénario');
      }
    }
    if (p.status === 'acquis') {
      const ok = await ask('Annuler l’acquisition',
        <>Le bien « {p.title} » reviendra en prospection avec le statut « {STATUS_LABELS[status]} ». Son statut d’occupation sera effacé.</>, 'Revenir en prospection');
      if (!ok) return null;
    }
    const patch: Partial<Property> = { status };
    if (status === 'archive') patch.status_before_archive = p.status;
    const row = await update('properties', p, patch, `Le bien « ${p.title} »`);
    if (row) notify(status === 'acquis' ? `« ${p.title} » est maintenant dans Mes biens.` : `Statut : ${STATUS_LABELS[status]}.`);
    return row;
  }

  async function toggleArchive(p: Property) {
    if (p.status === 'archive') return setStatus(p, p.status_before_archive ?? 'repere');
    return setStatus(p, 'archive');
  }

  async function del(p: Property): Promise<boolean> {
    const n = data.scenarios.filter((s) => s.property_id === p.id).length;
    const ok = await ask('Supprimer définitivement',
      <>« {p.title} » sera supprimé avec {n} scénario{n > 1 ? 's' : ''}, ses tâches et son historique. Cette action est irréversible ; préférez l’archivage pour conserver une trace.</>,
      'Supprimer');
    if (!ok) return false;
    const done = await remove('properties', p.id);
    if (done) notify('Bien supprimé.');
    return done;
  }

  async function dup(p: Property) {
    const np = await duplicate(p);
    if (np) navigate(`/bien/${np.id}`);
  }

  return { setStatus, toggleArchive, del, dup };
}
