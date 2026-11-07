// Regroupe le cœur des fonctions serveur qui réutilisent src/domain, pour que le déploiement Supabase
// n'ait besoin que du dossier supabase/functions. À lancer avant « supabase functions deploy tdfc ».
//   node scripts/build-functions.mjs
import { build } from 'esbuild';

const targets = [{ entry: 'supabase/functions/tdfc/core.ts', out: 'supabase/functions/tdfc/core.bundle.js' }];

for (const t of targets) {
  await build({
    entryPoints: [t.entry],
    outfile: t.out,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    legalComments: 'none',
    banner: { js: '// Fichier généré par scripts/build-functions.mjs à partir de core.ts : ne pas modifier.\n// @ts-nocheck' },
    logLevel: 'warning',
  });
  console.log(`${t.out} généré`);
}
