interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * NASA MCP — wraps NASA Open APIs (api.nasa.gov)
 *
 * Tools:
 * - get_apod: Astronomy Picture of the Day
 * - get_asteroids: near-Earth asteroid data from NeoWs
 * - get_mars_photos: photos from Mars rovers
 * - search_nasa_images: NASA Image & Video Library search (keyless)
 * - get_solar_flares: DONKI solar-flare space-weather events
 *
 * Uses `api_key` query param (gateway injects PLATFORM_DATAGOV_KEY; falls back to
 * DEMO_KEY). The image library lives on a separate keyless host.
 */


const BASE_URL = 'https://api.nasa.gov';
// NASA Image & Video Library — separate host, no api_key required.
const IMAGES_URL = 'https://images-api.nasa.gov';

const tools: McpToolExport['tools'] = [
  {
    name: 'get_apod',
    description:
      'Get the NASA Astronomy Picture of the Day with explanation. Optionally specify a date. Example: get_apod({ date: "2024-01-15", _apiKey: "DEMO_KEY" })',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format (optional, defaults to today). Range: 1995-06-16 to today.',
        },
        _apiKey: {
          type: 'string',
          description: 'NASA API key (optional, defaults to DEMO_KEY — get a free key at api.nasa.gov)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_asteroids',
    description:
      'Get near-Earth asteroids approaching within a date range (max 7 days). Returns size, velocity, and miss distance. Example: get_asteroids({ start_date: "2024-01-01", end_date: "2024-01-07", _apiKey: "DEMO_KEY" })',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (max 7 days after start)',
        },
        _apiKey: {
          type: 'string',
          description: 'NASA API key (optional, defaults to DEMO_KEY)',
        },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'get_mars_photos',
    description:
      'Get photos taken by Mars rovers (Curiosity, Opportunity, Spirit). Filter by Martian sol and camera. Example: get_mars_photos({ sol: 1000, camera: "FHAZ", _apiKey: "DEMO_KEY" })',
    inputSchema: {
      type: 'object',
      properties: {
        sol: {
          type: 'number',
          description: 'Martian sol (day) to retrieve photos from, e.g. 1000 (default: 1000)',
        },
        camera: {
          type: 'string',
          description: 'Camera abbreviation: "FHAZ" (front hazard), "RHAZ" (rear hazard), "MAST" (mast), "CHEMCAM", "MAHLI", "MARDI", "NAVCAM" (optional)',
        },
        _apiKey: {
          type: 'string',
          description: 'NASA API key (optional, defaults to DEMO_KEY)',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_nasa_images',
    description:
      'Search the NASA Image and Video Library for images/videos of any subject — planets, missions, astronauts, launches, galaxies, etc. PREFER for "NASA photos of Jupiter", "images of the Apollo 11 mission", "pictures of a nebula". Returns title, description, date, NASA ID, media type, and a thumbnail URL. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms, e.g. "jupiter", "apollo 11", "crab nebula".' },
        media_type: { type: 'string', description: 'Optional filter: "image", "video", or "audio".' },
        limit: { type: 'number', description: 'Max results to return (default 10, max 50).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_solar_flares',
    description:
      'Get recent solar flare events from NASA DONKI space-weather data. Returns each flare\'s class (e.g. C4.0, M1.8, X1.2), begin/peak/end times, source region, and active region number. Use for "recent solar flares", "is there solar activity / a solar storm", space-weather questions.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Start date YYYY-MM-DD (optional; default ~30 days ago).' },
        end_date: { type: 'string', description: 'End date YYYY-MM-DD (optional; default today).' },
        _apiKey: { type: 'string', description: 'NASA API key (optional, defaults to DEMO_KEY)' },
      },
      required: [],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = (args._apiKey as string) || 'DEMO_KEY';
  delete args._apiKey;

  switch (name) {
    case 'get_apod':
      return getApod(args.date as string | undefined, apiKey);
    case 'get_asteroids':
      return getAsteroids(args.start_date as string, args.end_date as string, apiKey);
    case 'get_mars_photos':
      return getMarsPhotos(
        (args.sol as number) ?? 1000,
        args.camera as string | undefined,
        apiKey,
      );
    case 'search_nasa_images':
      return searchNasaImages(
        args.query as string,
        args.media_type as string | undefined,
        (args.limit as number) ?? 10,
      );
    case 'get_solar_flares':
      return getSolarFlares(
        args.start_date as string | undefined,
        args.end_date as string | undefined,
        apiKey,
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function getApod(date: string | undefined, apiKey: string) {
  const params = new URLSearchParams({ api_key: apiKey });
  if (date) params.set('date', date);

  const res = await fetch(`${BASE_URL}/planetary/apod?${params}`);
  if (!res.ok) throw new Error(`NASA APOD error: ${res.status}`);

  const data = (await res.json()) as {
    date: string; title: string; explanation: string; url: string;
    hdurl?: string; media_type: string; copyright?: string;
  };

  return {
    date: data.date,
    title: data.title,
    explanation: data.explanation,
    url: data.url,
    hd_url: data.hdurl,
    media_type: data.media_type,
    copyright: data.copyright,
  };
}

async function getAsteroids(startDate: string, endDate: string, apiKey: string) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    api_key: apiKey,
  });

  const res = await fetch(`${BASE_URL}/neo/rest/v1/feed?${params}`);
  if (!res.ok) throw new Error(`NASA NeoWs error: ${res.status}`);

  const data = (await res.json()) as {
    element_count: number;
    near_earth_objects: Record<string, Array<{
      id: string; name: string; nasa_jpl_url: string;
      is_potentially_hazardous_asteroid: boolean;
      estimated_diameter: {
        meters: { estimated_diameter_min: number; estimated_diameter_max: number };
      };
      close_approach_data: Array<{
        close_approach_date: string;
        relative_velocity: { kilometers_per_hour: string };
        miss_distance: { kilometers: string };
      }>;
    }>>;
  };

  const asteroids: Array<Record<string, unknown>> = [];
  for (const [date, neos] of Object.entries(data.near_earth_objects)) {
    for (const neo of neos) {
      const approach = neo.close_approach_data[0];
      asteroids.push({
        id: neo.id,
        name: neo.name,
        date,
        hazardous: neo.is_potentially_hazardous_asteroid,
        diameter_min_m: neo.estimated_diameter.meters.estimated_diameter_min,
        diameter_max_m: neo.estimated_diameter.meters.estimated_diameter_max,
        velocity_km_h: approach ? parseFloat(approach.relative_velocity.kilometers_per_hour) : null,
        miss_distance_km: approach ? parseFloat(approach.miss_distance.kilometers) : null,
        jpl_url: neo.nasa_jpl_url,
      });
    }
  }

  return {
    total_count: data.element_count,
    asteroids: asteroids.slice(0, 30),
  };
}

async function getMarsPhotos(sol: number, camera: string | undefined, apiKey: string) {
  const params = new URLSearchParams({
    sol: String(sol),
    api_key: apiKey,
  });
  if (camera) params.set('camera', camera);

  const res = await fetch(`${BASE_URL}/mars-photos/api/v1/rovers/curiosity/photos?${params}`);
  if (!res.ok) throw new Error(`NASA Mars Photos error: ${res.status}`);

  const data = (await res.json()) as {
    photos: Array<{
      id: number; sol: number; camera: { name: string; full_name: string };
      img_src: string; earth_date: string;
      rover: { name: string; status: string };
    }>;
  };

  return {
    count: data.photos.length,
    photos: data.photos.slice(0, 20).map((p) => ({
      id: p.id,
      sol: p.sol,
      camera: p.camera.name,
      camera_full_name: p.camera.full_name,
      image_url: p.img_src,
      earth_date: p.earth_date,
      rover: p.rover.name,
      rover_status: p.rover.status,
    })),
  };
}

async function searchNasaImages(query: string, mediaType: string | undefined, limit: number) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('Required argument "query" is missing (e.g. "jupiter").');
  const size = Math.min(50, Math.max(1, limit));
  const params = new URLSearchParams({ q });
  if (mediaType) params.set('media_type', mediaType);

  const res = await fetch(`${IMAGES_URL}/search?${params}`);
  if (!res.ok) throw new Error(`NASA Images error: ${res.status}`);

  const data = (await res.json()) as {
    collection?: {
      metadata?: { total_hits?: number };
      items?: Array<{
        data?: Array<{
          title?: string;
          description?: string;
          date_created?: string;
          nasa_id?: string;
          media_type?: string;
          center?: string;
          keywords?: string[];
        }>;
        links?: Array<{ href?: string; rel?: string }>;
      }>;
    };
  };

  const items = data.collection?.items ?? [];
  return {
    query: q,
    total_hits: data.collection?.metadata?.total_hits ?? items.length,
    count: Math.min(items.length, size),
    results: items.slice(0, size).map((it) => {
      const meta = it.data?.[0] ?? {};
      const desc = meta.description ?? '';
      return {
        title: meta.title ?? null,
        description: desc.length > 500 ? `${desc.slice(0, 500)}…` : desc || null,
        date_created: meta.date_created ?? null,
        nasa_id: meta.nasa_id ?? null,
        media_type: meta.media_type ?? null,
        center: meta.center ?? null,
        keywords: meta.keywords ?? [],
        thumbnail: it.links?.find((l) => l.rel === 'preview')?.href ?? it.links?.[0]?.href ?? null,
      };
    }),
  };
}

async function getSolarFlares(startDate: string | undefined, endDate: string | undefined, apiKey: string) {
  const params = new URLSearchParams({ api_key: apiKey });
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  const res = await fetch(`${BASE_URL}/DONKI/FLR?${params}`);
  if (!res.ok) throw new Error(`NASA DONKI error: ${res.status}`);

  const data = (await res.json()) as Array<{
    flrID?: string;
    classType?: string;
    beginTime?: string;
    peakTime?: string;
    endTime?: string;
    sourceLocation?: string;
    activeRegionNum?: number | null;
    link?: string;
  }>;

  return {
    count: data.length,
    flares: data.map((f) => ({
      id: f.flrID ?? null,
      class: f.classType ?? null,
      begin_time: f.beginTime ?? null,
      peak_time: f.peakTime ?? null,
      end_time: f.endTime ?? null,
      source_location: f.sourceLocation ?? null,
      active_region: f.activeRegionNum ?? null,
      link: f.link ?? null,
    })),
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
