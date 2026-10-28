import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseEiendomDetail } from "../src/eiendom-detail-parse.js";
import { registerTools } from "../src/tools/index.js";

const html = readFileSync(new URL("fixtures/eiendom-detail.html", import.meta.url), "utf8");
const tools = new Map();
registerTools({ registerTool: (name, _config, handler) => tools.set(name, handler) });
const getItem = tools.get("get_finn_eiendom_item");
const withBadge = (label) =>
  html.replace('<div data-testid="object-details">', `<div data-testid="object-details"><div>${label}</div>`);

test("property details preserve full prose, prices, zero bedrooms, fields and gallery images", () => {
  const data = parseEiendomDetail(html, "123456789");
  assert.equal(data.title, "Eksempel på leilighet til leie");
  assert.equal(data.address, "Eksempelveien 1, 0001 Oslo");
  assert.deepEqual(data.monthly_rent, { amount: 11000, currency: "NOK" });
  assert.deepEqual(data.deposit, { amount: 33000, currency: "NOK" });
  assert.equal(data.included, "Internett");
  assert.equal(data.key_info.Soverom, "0");
  assert.equal(data.key_info.Primærrom, "60 m²");
  assert.deepEqual(data.facilities, ["Balkong/Terrasse", "Garasje/P-plass", "Umøblert"]);
  assert.equal(
    data.description,
    "Internett inkludert.\nStrøm betales separat.\nIkke dyr. Naboens bolig er utleid; denne er ledig.",
  );
  assert.equal(data.last_updated, "28. okt. 2026 10:00");
  assert.deepEqual(data.images, [
    "https://images.finncdn.no/dynamic/1600w/example/front.jpg",
    "https://images.finncdn.no/dynamic/1600w/example/kitchen.jpg",
  ]);
});

test("status uses the property's badge, never neighbours, recommendations or Qasa promotions", () => {
  const active = parseEiendomDetail(html, "123456789");
  assert.equal(active.status, "active");
  assert.equal(active.availability_confirmed, null);
  for (const [label, status] of [
    ["Utleid", "rented"],
    ["Solgt", "sold"],
    ["Inaktiv", "inactive"],
  ]) {
    const result = parseEiendomDetail(withBadge(label), "123456789");
    assert.equal(result.status, status);
    assert.deepEqual(result.status_evidence, [label]);
    assert.equal(result.availability_confirmed, false);
  }
  assert.equal(parseEiendomDetail(withBadge("Ukjent status"), "123456789").status, "unknown");
});

test("conditional and absent deposits stay unknown; explicit zero stays zero", () => {
  for (const value of ["Fra 33 000 kr", "33 000–40 000 kr", "Ikke oppgitt"]) {
    assert.equal(parseEiendomDetail(html.replace("33&nbsp;000 kr", value), "123456789").deposit, null);
  }
  assert.deepEqual(parseEiendomDetail(html.replace("33&nbsp;000 kr", "0 kr"), "123456789").deposit, {
    amount: 0,
    currency: "NOK",
  });
});

test("sale pages preserve asking price outside the definition list and the Om boligen description", () => {
  const sale = html
    .replace('data-testid="beskrivelse"', 'data-testid="om boligen"')
    .replace(
      '<section data-testid="pricing-details">',
      '<section data-testid="pricing-details"><div data-testid="pricing-incicative-price"><span>Prisantydning</span><span>3 950 000 kr</span></div>',
    )
    .replace("<dt>Depositum</dt><dd>33&nbsp;000 kr</dd>", "<dt>Totalpris</dt><dd>4 019 211 kr</dd>");
  const result = parseEiendomDetail(sale, "123456789");
  assert.deepEqual(result.asking_price, { amount: 3950000, currency: "NOK" });
  assert.deepEqual(result.total_price, { amount: 4019211, currency: "NOK" });
  assert.match(result.description, /Strøm betales separat/);
});

test("unrecognised pages and different ads cannot be reported as active", () => {
  for (const body of [
    "<h1>Verify you are human</h1>",
    "<h1>Logg inn</h1>",
    "<h1>404</h1>",
    html.replace("123456789", "999"),
  ]) {
    assert.throws(() => parseEiendomDetail(body, "123456789"), /Cannot parse/);
  }
});

test("detail handler checks the full ad and includes HTTP status, evidence and timestamp", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://www.finn.no/realestate/lettings/ad.html?finnkode=123456789");
    assert.ok(options.signal);
    return new Response(withBadge("Utleid"));
  });
  const result = await getItem({ finn_code: "123456789" });
  assert.ok(!result.isError);
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.status, "rented");
  assert.equal(data.http_status, 200);
  assert.ok(Number.isFinite(Date.parse(data.checked_at)));
  assert.match(data.description, /Strøm betales separat/);
});

test("404 and 410 report missing ads without asserting that they were rented", async (t) => {
  for (const status of [404, 410]) {
    t.mock.method(globalThis, "fetch", async () => new Response("Missing", { status }));
    const result = await getItem({ finn_code: "123456789" });
    assert.ok(!result.isError);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.status, "removed");
    assert.equal(data.http_status, status);
    assert.equal(data.availability_confirmed, null);
    assert.match(data.status_evidence[0], /reason for removal is unknown/);
    t.mock.restoreAll();
  }
});

test("blocked, failed, changed and mismatched pages remain tool errors", async (t) => {
  for (const [status, body] of [
    [403, "Forbidden"],
    [429, "Slow down"],
    [503, "Unavailable"],
    [200, "Verify you are human"],
    [200, html.replace("123456789", "999")],
  ]) {
    t.mock.method(globalThis, "fetch", async () => new Response(body, { status }));
    const result = await getItem({ finn_code: "123456789" });
    assert.equal(result.isError, true);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Network failure");
  });
  assert.equal((await getItem({ finn_code: "123456789" })).isError, true);
});
