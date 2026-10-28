# FINN.no MCP Server

A Model Context Protocol (MCP) server for searching and browsing Norwegian marketplaces — FINN.no and Klarna Price Guide.

## Features

### FINN.no Torget (secondhand marketplace)
- **Search** with filters for category, price, condition, location, colour, clothing size, and radius-based proximity
- **Item details** including description, images, seller info, and key specs

### FINN.no Cars
- **Search** with filters for make, fuel type, body type, transmission, wheel drive, mileage, year, and price
- **Item details** with full specs (engine, mileage, VIN, registration, etc.)

### FINN.no Boats
- **Search** with filters for boat class, length, engine power/type/fuel, year, and price
- **Item details** with full specs (length, width, speed, engine, materials, etc.)

### FINN.no Holiday Homes
- **Destination autocomplete** to discover locations and result counts
- **Property details** including pricing, beds, facilities, house rules, and images

### FINN.no Eiendom (real estate)
- **Search** homes for sale, rentals, newbuildings, and plots
- **Filters** for asking price, total price, area, plot area, bedrooms, construction year,
  property type, ownership type, facilities, energy label, sales status, location,
  viewing date, and listings published today
- **Listings** include asking price, total price, monthly shared cost, area, bedrooms,
  property type, ownership type, broker, viewing times, coordinates, images, and URL

### Klarna Price Guide (prisguiden.no)
- **Search** for new products across Norwegian retailers with lowest prices and price drop alerts
- **Product details** with individual offers, stock status, shipping, delivery estimates, purchase links, and price trend data

## Usage

### CLI

The CLI exposes the same tools and parameters as the MCP server, without starting a server.
Run it from the checkout with `node src/cli.js` (or `pnpm cli`). Installing the package exposes the `finn` command.

```bash
node src/cli.js --help
node src/cli.js search_finn_torget --help
node src/cli.js search_finn_torget --query "harrington" --price_to 1500 --shipping
node src/cli.js get_finn_torget_item --finn_code 343932826
node src/cli.js search_finn_cars --fuel Elektrisk --price_to 300000
node src/cli.js search_finn_eiendom --query "leilighet oslo" --price_to 5000000 --bedrooms_from 2
node src/cli.js search_finn_eiendom --subvertical lettings --query "bergen" --price_to 20000
node src/cli.js search_klarna --query "FiiO K11"
```

Parameter names match MCP inputs, including underscores. Repeat array flags, for example
`--condition 2 --condition 3`. Boolean flags such as `--shipping` enable the filter;
omit them to leave it off. For structured inputs, use `--json` instead of parameter flags:

```bash
node src/cli.js search_finn_torget --json '{"query":"jakke","condition":["2","3"]}'
```

Successful calls print JSON to stdout for piping into tools such as `jq`.
Errors go to stderr and exit with status 1. Help is generated from the shared tool schemas.

### Claude Code

Add to `.mcp.json` in your project root (or `~/.claude/.mcp.json` for global access):

```json
{
  "mcpServers": {
    "finn-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["github:viktorfa/finn_mcp"]
    }
  }
}
```

**Alternative runners:**

```bash
# bunx
"command": "bunx", "args": ["github:viktorfa/finn_mcp"]

# pnpm dlx
"command": "pnpm", "args": ["dlx", "github:viktorfa/finn_mcp"]
```

### Claude Desktop

Add to your Claude Desktop config and restart Claude.

```json
{
  "mcpServers": {
    "finn-mcp": {
      "command": "npx",
      "args": ["github:viktorfa/finn_mcp"]
    }
  }
}
```

Config file locations:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

## Examples

- "Search for 'skjorter' on FINN Torget"
- "Find electric cars under 300k on FINN"
- "Search for cabincruiser boats over 25 feet"
- "Find holiday cabins in Lofoten"
- "Find 3-bedroom apartments in Oslo under 5 million NOK"
- "Search for houses for rent in Bergen"
- "Compare prices for Raspberry Pi 4 on Klarna"
- "Get details for FINN item 343932826"

## Search result counts

FINN searches (Torget, cars, boats, B2B, and Eiendom) return:

- `total_results`: total matches reported by FINN, across pages.
- `page`: current page reported by FINN.
- `total_pages`: last accessible page reported by FINN; upstream paging limits may prevent browsing every match.
- `results_on_page`: number of entries in the returned `results` array.

Missing or invalid pagination metadata is `null`; it is never inferred from the returned list length.
Klarna searches return `results_on_page` only, since the parsed payload provides no verified total.
These fields apply to both the CLI and MCP. Consumers that previously used `total_results`
as a page count should use `results_on_page` instead.

## Eiendom listings

`search_finn_eiendom` returns `price` (asking price), `total_price`, and
`monthly_shared_cost` as `{ "amount": 3700000, "currency": "NOK" }` or `null` when FINN
does not report the value. `area` is `{ "from": 65, "to": 65, "unit": "m²" }`, and
`plot_area` is `{ "size": 624, "unit": "m²" }` or `null`.

The default subvertical is `homes` (bolig til salgs). Use `lettings` for rentals, where
`price` is the monthly rent; `newbuildings` for nybygg; or `plots` for tomter. Sort values
and some filters are subvertical-specific. Property type, ownership type, energy label,
sales status, and facilities accept either the FINN code or the Norwegian display name;
unsupported filters are passed to FINN unchanged.

The Eiendom search page embeds a React Router turbo-stream payload rather than the
base64 search data used by Torget and mobility. The parser decodes that payload and
rejects pages without a recognised search result, matching the failure behaviour of the
other FINN search tools.

## Offer prices and availability

`get_klarna_product` returns an `offers` array from the offers embedded in the page,
including sponsored placements, deduplicated by offer ID. It is not a guarantee of
all offers available from the retailer or on further pages. Each offer contains:

- `id`, `name`, `merchant`, and `url` (a retailer link when supplied, otherwise a Klarna redirect).
- `price` and `shipping_cost`: `{ "amount": 1290, "currency": "NOK" }`, or `null` when unknown.
- `total_price`: item price plus reported shipping, only when both are known and use the same currency.
- `stock_status`: Klarna's explicit status (for example `IN_STOCK`, `OUT_OF_STOCK`, or `BACKORDER`), or `null` when absent.
- `delivery_time`: `{ "min_days": 2, "max_days": 5 }` with unknown bounds set to `null`, or `null` when absent.

Offers are sorted by item price within each currency, with unknown prices last.
Out-of-stock offers remain visible; delivery estimates never imply availability.
Unknown shipping is not free shipping. Totals reflect Klarna's reported shipping,
not a checkout quote for a particular address or basket. Verify shortlisted offers
with the retailer before buying.

The existing `merchants` field remains a summary of merchant minimum prices for
compatibility. Use `offers` for stock and delivered-cost comparisons.
Klarna search `out_of_stock` is now `true`, `false`, or `null`; missing or invalid
stock data is no longer treated as `false`.

FINN marketplace searches and Klarna searches distinguish recognised empty results
from missing or malformed search payloads. Unrecognised pages produce a tool error
(MCP `isError`; CLI exit status 1 and diagnostics on stderr), rather than an empty
success. Klarna product pages also require recognised product and offer data.

## Development

```bash
git clone https://github.com/viktorfa/finn_mcp.git
cd finn_mcp
pnpm install
pnpm run dev
```

```bash
pnpm test         # run tests
pnpm run lint     # lint with biome
pnpm run format   # format with biome
```

## Disclaimer

Please respect FINN.no's terms of service. Avoid excessive requests and automated scraping that could impact their servers.

## License

MIT
