import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseEiendomSearchPage, parseEiendomSearchPaging, parseEiendomSearchResults } from "../src/eiendom-parse.js";
import { registerTools } from "../src/tools/index.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");
const searchHtml = fixture("eiendom-search");
const emptyHtml = fixture("eiendom-search-empty");

const tools = new Map();
registerTools({ registerTool: (name, _config, handler) => tools.set(name, handler) });

test("parseEiendomSearchPage extracts paging and real estate listings", () => {
  const page = parseEiendomSearchPage(searchHtml);
  assert.deepEqual(
    { total_results: page.total_results, page: page.page, total_pages: page.total_pages },
    { total_results: 599, page: 2, total_pages: 6 },
  );
  assert.equal(page.results.length, 50);

  const first = page.results[0];
  assert.equal(first.finn_code, "423735924");
  assert.equal(first.heading, "Lys og moderne 3-roms med privat uteareal og tilhørende parkering i carport");
  assert.equal(first.location, "Camp Maura, leilighet 54, Maura");
  assert.deepEqual(first.price, { amount: 3700000, currency: "NOK" });
  assert.deepEqual(first.total_price, { amount: 3731840, currency: "NOK" });
  assert.deepEqual(first.monthly_shared_cost, { amount: 2760, currency: "NOK" });
  assert.deepEqual(first.area, { from: 65, to: 65, unit: "m²" });
  assert.equal(first.plot_area, null);
  assert.equal(first.bedrooms, 2);
  assert.equal(first.property_type, "Leilighet");
  assert.equal(first.ownership_type, "Selveier");
  assert.equal(first.broker, "PrivatMegleren Brustad & Partnere");
  assert.deepEqual(first.coordinates, { lat: 60.2582, lon: 11.02941 });
  assert.equal(first.images.length, 3);
  assert.match(first.url, /finnkode=423735924$/);
});

test("parseEiendomSearchPage reports zero-result searches explicitly", () => {
  const page = parseEiendomSearchPage(emptyHtml);
  assert.deepEqual(
    { total_results: page.total_results, page: page.page, total_pages: page.total_pages },
    { total_results: 0, page: 1, total_pages: 0 },
  );
  assert.deepEqual(page.results, []);
});

test("missing or malformed eiendom metadata stays unknown", () => {
  for (const metadata of [
    undefined,
    {},
    { result_size: { match_count: -1 }, paging: { current: 0, last: "50" } },
    { result_size: { match_count: 1.5 }, paging: { current: "2", last: -1 } },
  ]) {
    assert.deepEqual(parseEiendomSearchPaging(metadata), {
      total_results: null,
      page: null,
      total_pages: null,
    });
  }
});

test("parseEiendomSearchResults rejects unrecognised HTML", () => {
  for (const html of [
    "<html></html>",
    "<script>eynotvalidjson</script>",
    '<script>window.__reactRouterContext.streamController.enqueue("{}");</script>',
  ]) {
    assert.throws(() => parseEiendomSearchResults(html), /Cannot parse FINN eiendom search/);
  }
});

test("search_finn_eiendom builds filters and maps names to FINN codes", async (t) => {
  let requested;
  t.mock.method(globalThis, "fetch", async (url) => {
    requested = url;
    return new Response(searchHtml);
  });

  const result = await tools.get("search_finn_eiendom")({
    query: "oslo",
    page: 2,
    sort: "PRICE_ASC",
    price_from: 3000000,
    price_to: 5000000,
    area_from: 50,
    bedrooms_from: 2,
    property_type: "Leilighet",
    ownership_type: "Selveier",
    facilities: ["Heis", "Balkong/Terrasse"],
  });
  assert.ok(!result.isError);

  const url = new URL(requested);
  assert.equal(url.pathname, "/realestate/homes/search.html");
  assert.equal(url.searchParams.get("q"), "oslo");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("sort"), "PRICE_ASC");
  assert.equal(url.searchParams.get("price_from"), "3000000");
  assert.equal(url.searchParams.get("price_to"), "5000000");
  assert.equal(url.searchParams.get("area_from"), "50");
  assert.equal(url.searchParams.get("min_bedrooms"), "2");
  assert.equal(url.searchParams.get("property_type"), "3");
  assert.equal(url.searchParams.get("ownership_type"), "3");
  assert.deepEqual(url.searchParams.getAll("facilities"), ["4", "1"]);

  const data = JSON.parse(result.content[0].text);
  assert.equal(data.total_results, 599);
  assert.equal(data.page, 2);
  assert.equal(data.total_pages, 6);
  assert.equal(data.results_on_page, 50);
  assert.equal(data.results_on_page, data.results.length);
});

test("search_finn_eiendom supports subverticals and reports upstream failures", async (t) => {
  let requested;
  t.mock.method(globalThis, "fetch", async (url) => {
    requested = url;
    return new Response(searchHtml);
  });

  const rentals = await tools.get("search_finn_eiendom")({ subvertical: "lettings", query: "oslo" });
  assert.ok(!rentals.isError);
  assert.equal(new URL(requested).pathname, "/realestate/lettings/search.html");

  t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  const failure = await tools.get("search_finn_eiendom")({ query: "oslo" });
  assert.equal(failure.isError, true);
  assert.match(failure.content[0].text, /503/);

  t.mock.method(globalThis, "fetch", async () => new Response("<html>Verify you are human</html>", { status: 200 }));
  const malformed = await tools.get("search_finn_eiendom")({ query: "oslo" });
  assert.equal(malformed.isError, true);
  assert.match(malformed.content[0].text, /Cannot parse FINN eiendom search/);
});

// A hand-encoded turbo-stream payload: nulls (-5), undefined (-7), a URL value,
// search results deferred behind a promise, and a doc without an id.
function syntheticStreamHtml() {
  const root = [{ _1: 2 }, "loaderData", { _3: 4 }, "routes/realestate/search/search", { _5: 6 }, "results", ["P", 1]];
  const results = [
    { _8: 9, _10: 11 },
    "docs",
    [17, 24],
    "metadata",
    { _12: 13 },
    "result_size",
    { _14: 15 },
    "match_count",
    2,
    "ad_id",
    { _16: 18, _19: -5, _20: -5, _21: 22, _23: -7 },
    123,
    "organisation_name",
    "owner_type_description",
    "canonical_url",
    ["U", "https://www.finn.no/realestate/homes/ad.html?finnkode=123"],
    "number_of_bedrooms",
    {},
  ];
  const stream = `${JSON.stringify(root)}\nP1:${JSON.stringify(results)}\n`;
  // Split mid-line to check that chunks spanning enqueue() calls are joined.
  const cut = Math.floor(stream.length / 2);
  return [stream.slice(0, cut), stream.slice(cut)]
    .map((part) => `<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(part)});</script>`)
    .join("");
}

test("eiendom stream decoding handles nulls, typed values, deferred data and split chunks", () => {
  const page = parseEiendomSearchPage(syntheticStreamHtml());
  assert.equal(page.total_results, 2);
  assert.equal(page.results.length, 2);

  const [first, second] = page.results;
  assert.equal(first.finn_code, "123");
  assert.equal(first.broker, null);
  assert.equal(first.ownership_type, null);
  assert.equal(first.bedrooms, null);
  assert.equal(first.url, "https://www.finn.no/realestate/homes/ad.html?finnkode=123");
  assert.equal(second.finn_code, null);
});
