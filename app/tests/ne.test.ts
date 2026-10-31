import assert from "node:assert/strict";
import { test } from "node:test";
import { NE_NONE, computeNe, defaultField, type NeChoice } from "../src/lib/ne";

const accounts = new Map([
  [3001, { name: "Försäljning 25 %", vatCode: "25" }],
  [3004, { name: "Försäljning momsfri", vatCode: "0" }],
  [3305, { name: "Tjänster utanför EU", vatCode: "0" }],
  [4010, { name: "Inköp", vatCode: "" }],
  [5410, { name: "Förbrukningsinventarier", vatCode: "" }],
  [7010, { name: "Löner", vatCode: "" }],
  [7832, { name: "Avskrivning inventarier", vatCode: "" }],
  [8310, { name: "Ränteintäkter", vatCode: "" }],
  [8410, { name: "Räntekostnader", vatCode: "" }],
  [8500, { name: "Konto utan koppling", vatCode: "" }],
]);

// Saldon i öre, debet − kredit: intäkter är negativa, kostnader positiva.
const bal = new Map<number, number>([
  [3001, -100_000_00],
  [3004, -10_000_00],
  [3305, -5_000_00],
  [4010, 20_000_00],
  [5410, 3_000_00],
  [7010, 12_000_00],
  [7832, 2_500_00],
  [8310, -250_00],
  [8410, 400_00],
  [8500, 1_000_00],
  [8910, 9_999_00], // utanför schemat
  [2641, 7_000_00], // balanskonto
]);

test("standardkoppling enligt BAS-schemat", () => {
  assert.equal(defaultField(3001, "25").field, "R1");
  assert.equal(defaultField(3004, "0").field, "R2");
  assert.equal(defaultField(3305, "0").field, "R2");
  assert.equal(defaultField(4010).field, "R5");
  assert.equal(defaultField(6110).field, "R6");
  assert.equal(defaultField(7510).field, "R7");
  assert.equal(defaultField(7832).field, "R10");
  assert.equal(defaultField(7820).field, "R9");
  assert.equal(defaultField(8310).field, "R4");
  assert.equal(defaultField(8410).field, "R8");
  assert.equal(defaultField(8500).field, null);
});

test("fälten summeras och R1–R10 ger resultatet", () => {
  const r = computeNe(bal, accounts, new Map());
  assert.equal(r.fields.R1.kr, 100_000);
  assert.equal(r.fields.R2.kr, 15_000);
  assert.equal(r.fields.R4.kr, 250);
  assert.equal(r.fields.R5.kr, 20_000);
  assert.equal(r.fields.R6.kr, 3_000);
  assert.equal(r.fields.R7.kr, 12_000);
  assert.equal(r.fields.R8.kr, 400);
  assert.equal(r.fields.R10.kr, 2_500);
  assert.equal(r.result, 100_000 + 15_000 + 250 - 20_000 - 3_000 - 12_000 - 400 - 2_500);
  assert.deepEqual(r.unmapped.map((a) => a.number), [8500]);
  assert.equal(r.unmapped[0].amount, -1_000_00);
});

test("kopplingar kan ändras per konto och konton kan lämnas utanför", () => {
  const overrides = new Map<number, NeChoice>([
    [8500, "R6"],
    [3305, NE_NONE],
  ]);
  const r = computeNe(bal, accounts, overrides);
  assert.equal(r.unmapped.length, 0);
  assert.equal(r.fields.R6.kr, 3_000 + 1_000);
  assert.equal(r.fields.R2.kr, 10_000);
  assert.deepEqual(r.excluded.map((a) => a.number), [3305]);
});

test("balanskonton och konton utanför schemat ingår inte", () => {
  const r = computeNe(bal, accounts, new Map());
  const all = Object.values(r.fields).flatMap((f) => f.accounts.map((a) => a.number));
  assert.ok(!all.includes(2641));
  assert.ok(!all.includes(8910));
});
