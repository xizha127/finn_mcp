import * as cheerio from "cheerio";

const clean = (value) => value.replace(/\s+/gu, " ").trim();
const STATUS_LABELS = new Map([
  ["utleid", "rented"],
  ["solgt", "sold"],
  ["inaktiv", "inactive"],
  ["annonsen er inaktiv", "inactive"],
]);

function definitionList($, root) {
  const entries = [];
  root.find("dt").each((_, element) => {
    const label = clean($(element).text());
    const value = clean($(element).next("dd").text());
    if (label && value) entries.push([label, value]);
  });
  return Object.fromEntries(entries);
}

function money(text) {
  if (!text) return null;
  // A conditional deposit, range or insurance offer is not an exact amount.
  const match = /^(\d[\d\s]*(?:,\d{1,2})?)\s*(?:kr|NOK)$/iu.exec(text);
  if (!match) return null;
  return { amount: Number(match[1].replace(/\s/gu, "").replace(",", ".")), currency: "NOK" };
}

function descriptionText(root) {
  const copy = root.clone();
  copy.find("script,style,button,h2,.sr-only").remove();
  copy.find("br").replaceWith("\n");
  copy.find("p,li,div").append("\n");
  return copy.text().split("\n").map(clean).filter(Boolean).join("\n");
}

export function parseEiendomDetail(html, expectedFinnCode) {
  const $ = cheerio.load(html);
  const object = $('[data-testid="object-details"]').first();
  const title = clean(object.find('[data-testid="object-title"] h1').first().text());
  const info = {};
  $('[data-testid="object-info"] tr').each((_, row) => {
    const label = clean($(row).find("th").text());
    if (label) info[label] = clean($(row).find("td").text());
  });
  // Requiring the requested ID prevents login/challenge/error/recommendation
  // pages (including HTTP 200 responses) from appearing to be live ads.
  if (!title || !/^\d+$/u.test(info["FINN-kode"] ?? "") || info["FINN-kode"] !== expectedFinnCode) {
    throw new Error("Cannot parse FINN eiendom detail: expected property data or matching FINN-kode is missing");
  }

  const badges = object
    .children("div")
    .filter((_, element) => $(element).children().length === 0)
    .map((_, element) => clean($(element).text()))
    .get()
    .filter(Boolean);
  const explicit = badges.find((label) => STATUS_LABELS.has(label.toLowerCase()));
  const status = explicit ? STATUS_LABELS.get(explicit.toLowerCase()) : badges.length ? "unknown" : "active";
  const pricing = definitionList($, object.find('[data-testid="pricing-details"]'));
  const asking = object.find('[data-testid="pricing-incicative-price"] > span');
  if (asking.length >= 2) pricing[clean(asking.first().text())] = clean(asking.last().text());
  const keyInfo = definitionList($, object.find('[data-testid="key-info"]'));
  const facilities = object
    .find('[data-testid="object-facilities"] > div > div')
    .map((_, element) => clean($(element).text()))
    .get()
    .filter(Boolean);
  const description = descriptionText(object.find('[data-testid="about-property"] .description-area'));
  const images = [];
  $('[data-testid="image-gallery"] img').each((_, element) => {
    const image = $(element);
    const candidates = (image.attr("data-srcset") || image.attr("srcset") || "")
      .split(",")
      .map((entry) => entry.trim().split(/\s+/u))
      .sort((a, b) => Number.parseInt(b[1] || "0", 10) - Number.parseInt(a[1] || "0", 10));
    const url = candidates[0]?.[0] || image.attr("src");
    if (url && /^https:\/\/images\.finncdn\.no\//u.test(url) && !images.includes(url)) images.push(url);
  });

  return {
    title,
    address: clean(object.find('[data-testid="object-address"]').first().text()) || null,
    status,
    status_evidence: explicit
      ? [explicit]
      : badges.length
        ? badges
        : ["Recognised property page; no explicit inactive, sold or rented badge"],
    availability_confirmed: status === "rented" || status === "sold" || status === "inactive" ? false : null,
    monthly_rent: money(pricing.Månedsleie),
    asking_price: money(pricing.Prisantydning),
    total_price: money(pricing.Totalpris),
    monthly_shared_cost: money(pricing["Felleskost/mnd."]),
    deposit: money(pricing.Depositum),
    included: pricing.Inkluderer ?? null,
    pricing,
    key_info: keyInfo,
    facilities,
    description,
    last_updated: info["Sist endret"] ?? null,
    images,
  };
}
