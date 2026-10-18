/** Fichier DVF communal fictif (mêmes colonnes que geo-dvf) pour les tests. */
export const DVF_HEAD = 'id_mutation,date_mutation,numero_disposition,nature_mutation,valeur_fonciere,adresse_numero,adresse_suffixe,adresse_nom_voie,adresse_code_voie,code_postal,code_commune,nom_commune,code_departement,id_parcelle,code_type_local,type_local,surface_reelle_bati,nombre_pieces_principales,surface_terrain,longitude,latitude';

export interface FakeSale { id: string; date?: string; nature?: string; value: number; type?: string; surface: number; lat?: number; lon?: number; extraRows?: string[] }

export function row(s: FakeSale, type = s.type ?? 'Appartement', surface: number | '' = s.surface): string {
  return [s.id, s.date ?? '2024-05-02', '000001', s.nature ?? 'Vente', s.value, '12', '', '"RUE DE LA PAIX, BAT A"', '1234', '75002', '75102', 'Paris 2e Arrondissement', '75', '75102000AB0001',
    type === 'Dépendance' ? '3' : '2', type, surface, type === 'Dépendance' ? '0' : '2', '', s.lon ?? 2.3317, s.lat ?? 48.8686].join(',');
}

/** n ventes d'appartements autour d'un point, prix au m² de base ± dispersion régulière. */
export function salesAround(n: number, base: number, opts: { lat?: number; lon?: number; spread?: number; prefix?: string; date?: string } = {}): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const surface = 40 + (i % 5) * 5;
    const perM2 = base + ((i % 9) - 4) * (opts.spread ?? 100);
    out.push(row({ id: `${opts.prefix ?? 'M'}${i}`, date: opts.date, value: perM2 * surface, surface, lat: (opts.lat ?? 48.8686) + (i % 3) * 0.0002, lon: opts.lon ?? 2.3317 }));
  }
  return out;
}

export const csv = (rows: string[]) => [DVF_HEAD, ...rows].join('\n');
