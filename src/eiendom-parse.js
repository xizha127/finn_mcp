const STREAM_CHUNK = /streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g;

// React Router's turbo-stream encoding uses negative indexes for values that
// have no JSON equivalent (see turbo-stream's utils.ts).
const HOLE = -1;
const SPECIAL_VALUES = new Map([
  [-2, Number.NaN],
  [-3, Number.NEGATIVE_INFINITY],
  [-4, -0],
  [-5, null],
  [-6, Number.POSITIVE_INFINITY],
  [-7, undefined],
]);

const MAX_DEPTH = 1000;

// Each enqueue() call carries a slice of the newline-delimited stream, and a
// line may be split across calls, so the slices are joined before splitting.
function readStreamText(html) {
  let text = "";
  for (const match of html.matchAll(STREAM_CHUNK)) {
    try {
      const payload = JSON.parse(match[1]);
      if (typeof payload === "string") text += payload;
    } catch {
      // Ignore scripts that are not valid turbo-stream chunks.
    }
  }
  return text;
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function decodeReactRouterStream(html) {
  const lines = readStreamText(html)
    .split("\n")
    .filter((line) => line.trim());
  if (lines.length === 0) return null;

  const values = [];
  // Appends a line's values to the shared value table, like turbo-stream's
  // unflatten(), and returns the index the line's value lives at.
  const append = (parsed) => {
    if (typeof parsed === "number") return parsed;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const startIndex = values.length;
    values.push(...parsed);
    return startIndex;
  };

  const root = append(parseLine(lines[0]));
  if (root === null) return null;

  // Later lines settle deferred values: "P<id>:<value>" resolves promise <id>
  // and "E<id>:<value>" rejects it.
  const settled = new Map();
  for (const line of lines.slice(1)) {
    const match = /^([PE])(\d+):(.*)$/s.exec(line);
    if (!match) continue;
    const index = append(parseLine(match[3]));
    if (index !== null) settled.set(Number(match[2]), { rejected: match[1] === "E", index });
  }

  const hydrated = new Map();
  const hydrate = (index, depth = 0) => {
    if (SPECIAL_VALUES.has(index)) return SPECIAL_VALUES.get(index);
    if (depth > MAX_DEPTH) throw new Error("Cannot parse FINN eiendom search: stream data is nested too deeply");
    if (hydrated.has(index)) return hydrated.get(index);

    const value = values[index];
    if (value === null || typeof value !== "object") return value;

    if (Array.isArray(value)) {
      if (typeof value[0] === "string") return hydrateTyped(index, value, depth);
      const array = [];
      hydrated.set(index, array);
      value.forEach((entry, i) => {
        if (entry !== HOLE) array[i] = hydrate(entry, depth + 1);
      });
      return array;
    }

    const object = {};
    hydrated.set(index, object);
    for (const [key, entry] of Object.entries(value)) {
      // Turbo-stream objects are maps from encoded key indexes to value
      // indexes, for example { "_1": 2, "_3": -7 }.
      object[String(hydrate(Number(key.slice(1)), depth + 1))] = hydrate(entry, depth + 1);
    }
    return object;
  };

  // Typed values are encoded as ["<tag>", ...]. They are decoded to plain
  // JSON-friendly values, since the result is serialised for tool output.
  const hydrateTyped = (index, [type, b, c], depth) => {
    const set = (result) => {
      hydrated.set(index, result);
      return result;
    };
    const rest = values[index].slice(1);
    switch (type) {
      case "D":
        return set(b);
      case "U":
      case "B":
      case "Y":
        return set(String(b));
      case "R":
        return set(String(new RegExp(b, c)));
      case "E":
        return set({ error: String(b) });
      case "S":
        return set(rest.map((entry) => hydrate(entry, depth + 1)));
      case "M": {
        const object = set({});
        for (let i = 0; i + 1 < rest.length; i += 2) {
          object[String(hydrate(rest[i], depth + 1))] = hydrate(rest[i + 1], depth + 1);
        }
        return object;
      }
      case "N": {
        const object = set({});
        for (const [key, entry] of Object.entries(b ?? {})) {
          object[String(hydrate(Number(key.slice(1)), depth + 1))] = hydrate(entry, depth + 1);
        }
        return object;
      }
      case "P": {
        // Deferred data is resolved in place; an unsettled or rejected
        // promise has no usable value.
        const result = settled.get(b);
        if (!result || result.rejected) return set(null);
        hydrated.set(index, null);
        return set(hydrate(result.index, depth + 1));
      }
      case "Z":
        return set(hydrate(b, depth + 1));
      default:
        return set(null);
    }
  };

  return hydrate(root);
}

export function extractEiendomSearchData(html) {
  const root = decodeReactRouterStream(html);
  const loaderData = root?.loaderData;
  if (!loaderData || typeof loaderData !== "object") return null;

  for (const [route, value] of Object.entries(loaderData)) {
    if (!route.endsWith("/search/search")) continue;
    if (Array.isArray(value?.results?.docs)) return value.results;
  }

  for (const value of Object.values(loaderData)) {
    if (Array.isArray(value?.results?.docs)) return value.results;
  }
  return null;
}

function count(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum ? value : null;
}

export function parseEiendomSearchPaging(metadata) {
  return {
    total_results: count(metadata?.result_size?.match_count),
    page: count(metadata?.paging?.current, 1),
    total_pages: count(metadata?.paging?.last),
  };
}

function formatMoney(value) {
  if (!value || typeof value.amount !== "number") return null;
  return { amount: value.amount, currency: value.currency_code ?? "NOK" };
}

function formatArea(value) {
  if (!value) return null;
  if (typeof value.size === "number") {
    if (value.size <= 0) return null;
    return { from: value.size, to: value.size, unit: value.unit ?? "m²" };
  }
  if (typeof value.size_from !== "number") return null;
  return {
    from: value.size_from,
    to: typeof value.size_to === "number" ? value.size_to : value.size_from,
    unit: value.unit ?? "m²",
  };
}

function formatPlotArea(value) {
  if (!value || typeof value.size !== "number" || value.size <= 0) return null;
  return { size: value.size, unit: value.unit ?? "m²" };
}

function formatCoordinates(value) {
  if (!value || typeof value.lat !== "number" || typeof value.lon !== "number") return null;
  return { lat: value.lat, lon: value.lon };
}

function formatPublished(value) {
  if (typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function mapEiendomDoc(doc) {
  return {
    finn_code: doc.ad_id != null || doc.id != null ? String(doc.ad_id ?? doc.id) : null,
    heading: doc.heading ?? null,
    location: doc.location ?? null,
    local_area: doc.local_area_name ?? null,
    price: formatMoney(doc.price_suggestion),
    total_price: formatMoney(doc.price_total),
    monthly_shared_cost: formatMoney(doc.price_shared_cost),
    area: formatArea(doc.area_range ?? doc.area),
    plot_area: formatPlotArea(doc.area_plot),
    bedrooms: typeof doc.number_of_bedrooms === "number" ? doc.number_of_bedrooms : null,
    property_type: doc.property_type_description ?? null,
    ownership_type: doc.owner_type_description?.trim() || null,
    furnished: doc.furnished_state ?? null,
    broker: doc.organisation_name?.trim() || null,
    viewing_times: Array.isArray(doc.viewing_times) ? doc.viewing_times : [],
    features: Array.isArray(doc.features) ? doc.features : [],
    coordinates: formatCoordinates(doc.coordinates),
    published_at: formatPublished(doc.timestamp),
    url: doc.canonical_url ?? null,
    image: doc.image?.url ?? null,
    images: Array.isArray(doc.image_urls) ? doc.image_urls : [],
  };
}

export function parseEiendomSearchResults(html) {
  const results = extractEiendomSearchData(html);
  if (!results) throw new Error("Cannot parse FINN eiendom search: expected search data is missing or malformed");
  return results.docs.map(mapEiendomDoc);
}

export function parseEiendomSearchPage(html) {
  const results = extractEiendomSearchData(html);
  if (!results) throw new Error("Cannot parse FINN eiendom search: expected search data is missing or malformed");
  return {
    ...parseEiendomSearchPaging(results.metadata),
    results: results.docs.map(mapEiendomDoc),
  };
}
