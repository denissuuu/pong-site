/**
 * Tests du fuseau horaire : le serveur tourne en UTC, la logique doit être en heure de Paris,
 * y compris autour des changements d'heure.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  maintenantParis,
  lundiDe,
  ajouterJours,
  estDateValide,
  jourDeSemaine,
} from '../netlify/lib/temps-paris.js';
import { validerReservation } from '../netlify/lib/regles.js';

describe('Heure de Paris depuis un serveur en UTC', () => {
  test('hiver : UTC+1', () => {
    // 21 nov. 2026, 9h30 UTC → 10h30 à Paris
    assert.deepEqual(maintenantParis(new Date('2026-11-21T09:30:00Z')), {
      date: '2026-11-21',
      minutes: 10 * 60 + 30,
      heure: '10:30',
    });
  });
  test('été : UTC+2', () => {
    // 15 juil. 2026, 9h30 UTC → 11h30 à Paris
    assert.equal(maintenantParis(new Date('2026-07-15T09:30:00Z')).heure, '11:30');
  });
  test('changement de date : 23h30 UTC est déjà le lendemain à Paris', () => {
    assert.equal(maintenantParis(new Date('2026-11-21T23:30:00Z')).date, '2026-11-22');
    assert.equal(maintenantParis(new Date('2026-07-15T22:30:00Z')).date, '2026-07-16');
  });
  test("passage à l'heure d'été (29 mars 2026)", () => {
    assert.equal(maintenantParis(new Date('2026-03-29T00:59:00Z')).heure, '01:59');
    assert.equal(maintenantParis(new Date('2026-03-29T01:00:00Z')).heure, '03:00');
    // À 10h00 heure de Paris (8h UTC), le créneau de 10h00 est commencé, 10h30 est libre.
    const m = maintenantParis(new Date('2026-03-29T08:00:00Z'));
    assert.equal(m.heure, '10:00');
    const vide = { reservations: [], blocages: [] };
    assert.throws(() => validerReservation({ prenom: 'Léa', date: '2026-03-29', debut: '10:00', duree: 30 }, vide, m));
    assert.ok(validerReservation({ prenom: 'Léa', date: '2026-03-29', debut: '10:30', duree: 30 }, vide, m));
  });
  test("passage à l'heure d'hiver (25 octobre 2026)", () => {
    assert.equal(maintenantParis(new Date('2026-10-25T00:30:00Z')).heure, '02:30');
    assert.equal(maintenantParis(new Date('2026-10-25T01:30:00Z')).heure, '02:30'); // 2h30 vécue deux fois
    assert.equal(maintenantParis(new Date('2026-10-25T09:00:00Z')).heure, '10:00');
  });
});

describe('Calendrier', () => {
  test('lundi de la semaine', () => {
    assert.equal(lundiDe('2026-11-21'), '2026-11-16'); // samedi
    assert.equal(lundiDe('2026-11-22'), '2026-11-16'); // dimanche
    assert.equal(lundiDe('2026-11-23'), '2026-11-23'); // lundi
  });
  test('ajout de jours à travers un changement d’heure et une fin de mois', () => {
    assert.equal(ajouterJours('2026-03-28', 1), '2026-03-29');
    assert.equal(ajouterJours('2026-03-29', 1), '2026-03-30');
    assert.equal(ajouterJours('2026-11-21', 21), '2026-12-12');
    assert.equal(ajouterJours('2026-12-31', 1), '2027-01-01');
  });
  test('jour de semaine (lundi = 0)', () => {
    assert.equal(jourDeSemaine('2026-11-23'), 0);
    assert.equal(jourDeSemaine('2026-11-29'), 6);
  });
  test('dates valides et invalides', () => {
    assert.equal(estDateValide('2028-02-29'), true);
    assert.equal(estDateValide('2026-02-29'), false);
    assert.equal(estDateValide('2026-13-01'), false);
    assert.equal(estDateValide('21/11/2026'), false);
  });
});
