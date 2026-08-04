# mcp-nasa

NASA MCP — wraps NASA Open APIs (api.nasa.gov)

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `get_apod` | Get the NASA Astronomy Picture of the Day with explanation. Optionally specify a date. Example: get_apod({ date: "2024-01-15", _apiKey: "DEMO_KEY" }) |
| `get_asteroids` | Get near-Earth asteroids approaching within a date range (max 7 days). Returns size, velocity, and miss distance. Example: get_asteroids({ start_date: "2024-01-01", end_date: "2024-01-07", _apiKey: "DEMO_KEY" }) |
| `get_mars_photos` | "Show me photos from the Mars rover" / "Perseverance images from sol 1000" / "latest pictures from Mars" — raw images from NASA's Perseverance rover (Mars 2020), straight off the mars.nasa.gov feed. Filter by Martian sol and by camera. Returns image URLs at four resolutions, the sol, the UTC and Mars-local capture times, and the camera instrument. Keyless. Covers Perseverance only — Curiosity, Opportunity and Spirit have no live public image feed. Example: get_mars_photos({ sol: 1000, camera: "NAVCAM_LEFT" }) |
| `search_nasa_images` | Search the NASA Image and Video Library for images/videos of any subject — planets, missions, astronauts, launches, galaxies, etc. PREFER for "NASA photos of Jupiter", "images of the Apollo 11 mission", "pictures of a nebula". Returns title, description, date, NASA ID, media type, and a thumbnail URL. Keyless. |
| `get_solar_flares` | Get recent solar flare events from NASA DONKI space-weather data. Returns each flare's class (e.g. C4.0, M1.8, X1.2), begin/peak/end times, source region, and active region number. Use for "recent solar flares", "is there solar activity / a solar storm", space-weather questions. |

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Nasa data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
