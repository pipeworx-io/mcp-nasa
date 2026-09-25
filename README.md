# mcp-nasa

NASA MCP — wraps NASA Open APIs (api.nasa.gov)

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1679+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `get_apod` | Get the NASA Astronomy Picture of the Day with explanation. Optionally specify a date. Example: get_apod({ date: "2024-01-15", _apiKey: "DEMO_KEY" }) |
| `get_asteroids` | Get near-Earth asteroids approaching within a date range (max 7 days). Returns size, velocity, and miss distance. Example: get_asteroids({ start_date: "2024-01-01", end_date: "2024-01-07", _apiKey: "DEMO_KEY" }) |
| `get_mars_photos` | "Show me photos from the Mars rover" / "Perseverance images from sol 1000" / "latest pictures from Mars" — raw images from NASA's Perseverance rover (Mars 2020), straight off the mars.nasa.gov feed. Filter by Martian sol and by camera. Returns image URLs at four resolutions, the sol, the UTC and Mars-local capture times, and the camera instrument. Keyless. Covers Perseverance only — Curiosity, Opportunity and Spirit have no live public image feed. Example: get_mars_photos({ sol: 1000, camera: "NAVCAM_LEFT" }) |
| `search_nasa_images` | Search the NASA Image and Video Library for images/videos of any subject — planets, missions, astronauts, launches, galaxies, etc. PREFER for "NASA photos of Jupiter", "images of the Apollo 11 mission", "pictures of a nebula". Returns title, description, date, NASA ID, media type, and a thumbnail URL. Keyless. |
| `get_solar_flares` | Get recent solar flare events from NASA DONKI space-weather data. Returns each flare's class (e.g. C4.0, M1.8, X1.2), begin/peak/end times, source region, and active region number. Use for "recent solar flares", "is there solar activity / a solar storm", space-weather questions. |
| `donki_cme` | "Was there a coronal mass ejection this week?" / "is a CME heading for Earth?" — coronal mass ejections catalogued by NASA DONKI, the space-weather event database run by NASA's Community Coordinated Modeling Center. AUTHORITATIVE for CME occurrence and geometry: returns each eruption's start time, the instruments that saw it, the analysts' note describing the source region, and for analysed events the modelled speed in km/s, the direction (latitude/longitude on the solar disk), half-angle width and whether the analysis is the most accurate available. A CME is the thing that causes an aurora or a satellite drag event two or three days later, so speed plus direction is what says whether it will reach Earth. |
| `donki_geomagnetic_storms` | "Was there a geomagnetic storm?" / "will there be an aurora tonight?" / "how strong was the Kp index?" — geomagnetic storm events from NASA DONKI, each with the full series of observed Kp index readings and their timestamps. AUTHORITATIVE for whether Earth's magnetic field was actually disturbed, as opposed to whether a flare happened: Kp 5 is a minor storm, Kp 7 puts aurora over the northern US and northern Europe, Kp 8-9 is severe. Also returns the CMEs and shocks DONKI linked to each storm, so you can trace a storm back to the eruption that caused it. |
| `donki_solar_energetic_particles` | Solar energetic particle (SEP) events from NASA DONKI — bursts of high-energy protons arriving at Earth after a flare or CME. These are the events behind radiation warnings for polar airline routes, astronaut EVA holds and satellite single-event upsets. Returns the event time, the detecting instruments and energy channels (e.g. "GOES-P: SEISS >10 MeV"), and the flare or CME DONKI linked as the source. |
| `donki_notifications` | "What is the current space weather forecast?" — the alerts, watches, warnings and weekly summary reports NASA DONKI issues to spacecraft operators. This is the narrative layer over the event catalogues: a human forecaster's text saying what happened, what is expected and what the impact is. Filter by message type (alert, watch, warning, summary) or by event class (CME, flare, geomagnetic storm, SEP, radiation belt enhancement). |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "nasa": {
      "url": "https://gateway.pipeworx.io/nasa/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/nasa/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1679+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/nasa_get_apod \
  -H 'Content-Type: application/json' \
  -d '{"date":"2024-01-15"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/nasa_get_apod`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "nasa": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-nasa"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-nasa
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Nasa data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
