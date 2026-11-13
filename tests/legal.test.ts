// Mentions légales : l'identité de l'éditeur est complète et identique sur le site et dans l'application.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EDITEUR, editeurLine } from '../src/domain/legal.ts';

const page = readFileSync(join(import.meta.dirname, '..', 'site', 'mentions-legales.html'), 'utf8');

test('mentions légales du site : plus aucun champ « à compléter »', () => {
  assert.doesNotMatch(page, /data-todo/);
});

test('mentions légales du site : mêmes valeurs que l’application', () => {
  for (const v of [EDITEUR.siren, EDITEUR.tva, EDITEUR.capital, '110 rue de Fontenay, 94300 Vincennes', EDITEUR.directeurPublication, 'RCS de Créteil', '132 015 025']) {
    assert.ok(page.includes(v), `« ${v} » absent de site/mentions-legales.html`);
  }
});

test('numéro de TVA intracommunautaire cohérent avec le SIREN', () => {
  const siren = Number(EDITEUR.siren.replace(/\s/g, ''));
  const key = (12 + 3 * (siren % 97)) % 97;
  assert.equal(EDITEUR.tva, `FR${String(key).padStart(2, '0')}${siren}`);
});

test('ligne d’identification courte', () => {
  assert.equal(editeurLine(), 'Immo-Zen, SASU au capital de 500 € – RCS Créteil 132 762 634');
});
