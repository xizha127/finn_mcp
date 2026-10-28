import { z } from "zod";
import { parseEiendomSearchPage } from "../eiendom-parse.js";
import { fetchHtml } from "../fetch.js";

const SORT_VALUES = [
  "RELEVANCE",
  "CLOSEST",
  "PUBLISHED_DESC",
  "PRICE_ASC",
  "PRICE_DESC",
  "PRICE_ASKING_ASC",
  "PRICE_ASKING_DESC",
  "PRICE_SQM_ASC",
  "PRICE_SQM_DESC",
  "AREA_ASC",
  "AREA_DESC",
  "AREA_PROM_ASC",
  "AREA_PROM_DESC",
  "AREA_BOA_ASC",
  "AREA_BOA_DESC",
  "PLOT_AREA_ASC",
  "PLOT_AREA_DESC",
  "RENT_ASC",
  "RENT_DESC",
];

const PROPERTY_TYPES = new Map(
  Object.entries({
    enebolig: "1",
    tomannsbolig: "2",
    leilighet: "3",
    rekkehus: "4",
    garasje: "6",
    "garasje/parkering": "6",
    "produksjon/industri": "9",
    gårdsbruk: "11",
    "gårdsbruk/småbruk": "11",
    andre: "18",
    "bygård/flermannsbolig": "20",
  }),
);

const OWNERSHIP_TYPES = new Map(
  Object.entries({
    obligasjon: "1",
    aksje: "2",
    selveier: "3",
    andel: "4",
    annet: "255",
  }),
);

const ENERGY_LABELS = new Map(
  Object.entries({
    a: "1",
    b: "2",
    c: "3",
    d: "4",
    e: "5",
    f: "6",
    g: "7",
  }),
);

const LIFECYCLES = new Map(
  Object.entries({
    "til salgs": "1",
    "solgt siste 3 dager": "2",
    "kommer for salg": "3",
  }),
);

const FACILITIES = new Map(
  Object.entries({
    "balkong/terrasse": "1",
    "peis/ildsted": "2",
    heis: "4",
    "ingen gjenboere": "5",
    moderne: "12",
    aircondition: "16",
    strandlinje: "17",
    turterreng: "22",
    "garasje/p-plass": "23",
    fellesvaskeri: "24",
    alarm: "25",
    bredbåndstilknytning: "28",
    "vaktmester-/vektertjeneste": "30",
    utsikt: "209",
    lademulighet: "238",
  }),
);

function normalize(value) {
  return String(value).trim().toLowerCase();
}

function codeFrom(codes, value) {
  if (value === undefined) return undefined;
  const text = String(value).trim();
  return codes.get(normalize(text)) ?? text;
}

function buildSearchUrl(subvertical, args) {
  const params = new URLSearchParams();
  const set = (name, value) => {
    if (value !== undefined && value !== null && value !== "") params.set(name, String(value));
  };

  set("q", args.query);
  if (args.page && args.page > 1) set("page", args.page);
  set("sort", args.sort);
  set("price_from", args.price_from);
  set("price_to", args.price_to);
  set("price_collective_from", args.total_price_from);
  set("price_collective_to", args.total_price_to);
  set("area_from", args.area_from);
  set("area_to", args.area_to);
  set("plot_area_from", args.plot_area_from);
  set("plot_area_to", args.plot_area_to);
  set("min_bedrooms", args.bedrooms_from);
  set("construction_year_from", args.construction_year_from);
  set("construction_year_to", args.construction_year_to);
  set("property_type", codeFrom(PROPERTY_TYPES, args.property_type));
  set("ownership_type", codeFrom(OWNERSHIP_TYPES, args.ownership_type));
  set("energy_label", codeFrom(ENERGY_LABELS, args.energy_label));
  set("lifecycle", codeFrom(LIFECYCLES, args.lifecycle));
  set("location", args.location);
  set("viewing", args.viewing);
  set("published", args.published ? "1" : undefined);
  set("is_new_property", args.new_property === undefined ? undefined : String(args.new_property));
  set("is_private_broker", args.private_broker ? "1" : undefined);

  for (const facility of args.facilities ?? []) {
    params.append("facilities", codeFrom(FACILITIES, facility));
  }

  const query = params.toString();
  return `https://www.finn.no/realestate/${subvertical}/search.html${query ? `?${query}` : ""}`;
}

async function searchEiendom(args) {
  const subvertical = args.subvertical ?? "homes";
  const url = buildSearchUrl(subvertical, args);
  const html = await fetchHtml(url);
  const { results, ...paging } = parseEiendomSearchPage(html);
  return { search_url: url, ...paging, results_on_page: results.length, results };
}

export function registerEiendomTools(server) {
  server.registerTool(
    "search_finn_eiendom",
    {
      description:
        "Search FINN.no Eiendom (real estate) for homes for sale, rentals, newbuildings, and plots. " +
        "Returns listings with asking price, total price, monthly shared cost, area, plot area, bedrooms, " +
        "property type, ownership type, location, broker, viewing times, coordinates, and URL.",
      inputSchema: {
        subvertical: z
          .enum(["homes", "lettings", "newbuildings", "plots"])
          .optional()
          .describe(
            "Eiendom subvertical: 'homes' for bolig til salgs (default), 'lettings' for bolig til leie, 'newbuildings' for nybygg, 'plots' for tomter",
          ),
        query: z.string().optional().describe("Search query (e.g. 'leilighet oslo', 'rekkehus bærum')"),
        page: z.coerce.number().optional().describe("Page number"),
        sort: z.enum(SORT_VALUES).optional().describe("Sort order (valid values vary by subvertical)"),
        price_from: z.coerce.number().optional().describe("Minimum asking price in NOK (monthly rent for lettings)"),
        price_to: z.coerce.number().optional().describe("Maximum asking price in NOK (monthly rent for lettings)"),
        total_price_from: z.coerce.number().optional().describe("Minimum total price in NOK"),
        total_price_to: z.coerce.number().optional().describe("Maximum total price in NOK"),
        area_from: z.coerce.number().optional().describe("Minimum usable area in m²"),
        area_to: z.coerce.number().optional().describe("Maximum usable area in m²"),
        plot_area_from: z.coerce.number().optional().describe("Minimum plot area in m²"),
        plot_area_to: z.coerce.number().optional().describe("Maximum plot area in m²"),
        bedrooms_from: z.coerce.number().optional().describe("Minimum number of bedrooms"),
        construction_year_from: z.coerce.number().optional().describe("Minimum construction year"),
        construction_year_to: z.coerce.number().optional().describe("Maximum construction year"),
        property_type: z
          .string()
          .optional()
          .describe(
            "Property type name or FINN code: Enebolig=1, Tomannsbolig=2, Leilighet=3, Rekkehus=4, Garasje/Parkering=6, Produksjon/Industri=9, Gårdsbruk/Småbruk=11, Andre=18, Bygård/Flermannsbolig=20",
          ),
        ownership_type: z
          .string()
          .optional()
          .describe("Ownership type name or code: Obligasjon=1, Aksje=2, Selveier=3, Andel=4, Annet=255"),
        energy_label: z.string().optional().describe("Energy label A-G"),
        lifecycle: z
          .string()
          .optional()
          .describe("Sales status name or code: 'Til salgs'=1, 'Solgt siste 3 dager'=2, 'Kommer for salg'=3"),
        location: z
          .string()
          .optional()
          .describe("FINN location code, e.g. '0.20003' for Akershus or '1.20003.20045' for Bærum"),
        viewing: z.string().optional().describe("Viewing date in YYYYMMDD format, e.g. '20261025'"),
        facilities: z
          .array(z.string())
          .optional()
          .describe(
            "Facilities, as names or codes: Balkong/Terrasse=1, Peis/Ildsted=2, Heis=4, Ingen gjenboere=5, Moderne=12, Aircondition=16, Strandlinje=17, Turterreng=22, Garasje/P-plass=23, Fellesvaskeri=24, Alarm=25, Bredbåndstilknytning=28, Vaktmester-/vektertjeneste=30, Utsikt=209, Lademulighet=238",
          ),
        published: z.boolean().optional().describe("Only listings published today"),
        new_property: z.boolean().optional().describe("true for newbuildings only, false for used homes only"),
        private_broker: z.boolean().optional().describe("Only listings sold by private sellers"),
      },
    },
    async (args) => {
      try {
        const data = await searchEiendom(args);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error searching FINN eiendom: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
}
