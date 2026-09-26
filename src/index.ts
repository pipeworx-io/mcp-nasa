interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    // Fleet #2382. Everything that isn't a timeout/abort here is a genuine
    // NETWORK-LEVEL failure — DNS resolution, connection refused, TLS handshake,
    // Cloudflare's own "Network connection lost." — meaning `fetch()` itself
    // threw and no HTTP response of any kind was ever received. Until this fix
    // that raw exception was rethrown VERBATIM: a bare `TypeError: fetch failed`
    // (or the Workers-runtime equivalent) names no upstream, carries no class
    // token, and reads exactly like a defect in OUR code — because it says
    // nothing about the call at all. It landed in `error`, the tier that means
    // "Pipeworx has a defect", for every one of the (at the time of writing)
    // ~470 packs that call this helper directly with no wrapper of their own.
    //
    // `dexscreener` hit this independently (fleet #1579) and fixed it with a
    // bespoke per-pack try/catch around `fetchWithTimeout`. That fix is correct
    // but only covers one pack; every other caller of this shared helper still
    // leaked the raw exception. Moving the same fix HERE — the one place that
    // already carries the timeout case — covers every pack that uses
    // `fetchWithTimeout` without a wrapper, for free, and without widening
    // `classifyToolError`'s regex list: the fix is giving the message a proper
    // `upstream_down:` token at the point the two facts (no response was ever
    // received, and which host we were trying to reach) are actually in hand,
    // not teaching the classifier to guess from prose after the fact.
    //
    // Safe on the same grounds as the timeout branch above: no argument a
    // caller passes can make `fetch()` itself throw a connection-level error,
    // so this is always an availability failure, never a caller mistake. Same
    // `markInternalOrigin` treatment — an origin we run that never answered is
    // still ours, not a third party's outage.
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(
      markInternalOrigin(
        `upstream_down: could not reach ${name} at all (${raw.slice(0, 160)}). ` +
          `No request reached ${name}, so this says NOTHING about whether the arguments you passed ` +
          'are valid — do not re-check them on the strength of this error. Retry shortly.',
        url,
      ),
    );
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * NASA MCP — wraps NASA Open APIs (api.nasa.gov)
 *
 * Tools:
 * - get_apod: Astronomy Picture of the Day
 * - get_asteroids: near-Earth asteroid data from NeoWs
 * - get_mars_photos: raw Perseverance rover images (keyless)
 * - search_nasa_images: NASA Image & Video Library search (keyless)
 * - get_solar_flares: DONKI solar-flare space-weather events
 * - donki_cme: DONKI coronal mass ejections, with the modelled speed/direction
 * - donki_geomagnetic_storms: DONKI geomagnetic storms, with observed Kp
 * - donki_solar_energetic_particles: DONKI SEP (radiation-storm) events
 * - donki_notifications: DONKI alerts, watches, warnings and summary reports
 *
 * Uses `api_key` query param (gateway injects PLATFORM_DATAGOV_KEY; falls back to
 * DEMO_KEY). The image library and the Mars raw-image feed live on separate
 * keyless hosts.
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'NASA');
}

const BASE_URL = 'https://api.nasa.gov';
// NASA Image & Video Library — separate host, no api_key required.
const IMAGES_URL = 'https://images-api.nasa.gov';
// Mars 2020 raw-image feed. api.nasa.gov/mars-photos/* was retired (every rover
// path 404s as of 2026-07), which had this tool failing 100% of calls. This feed
// is the live replacement: keyless, 556k+ Perseverance images, same sol/camera
// filters. It serves Perseverance ONLY -- category=msl (Curiosity) returns
// total_results: 0, so the older rovers genuinely have no live source here.
const MARS_RAW_URL = 'https://mars.nasa.gov/rss/api';

// `search` on the raw feed is an EXACT match on camera.instrument, not a
// substring: search=NAVCAM returns 0 while search=NAVCAM_LEFT returns 62k. So a
// plausible-looking abbreviation silently yields an empty result rather than an
// error -- hence the explicit allowlist, plus aliases for the Curiosity-era
// abbreviations this tool used to document. Counts verified live 2026-07-29.
const MARS_CAMERAS = [
  'NAVCAM_LEFT', 'NAVCAM_RIGHT', 'FRONT_HAZCAM_LEFT_A', 'FRONT_HAZCAM_RIGHT_A',
  'REAR_HAZCAM_LEFT', 'REAR_HAZCAM_RIGHT', 'MCZ_LEFT', 'MCZ_RIGHT',
  'SHERLOC_WATSON', 'SUPERCAM_RMI', 'SKYCAM', 'PIXL_MCC', 'CACHECAM',
];
const MARS_CAMERA_ALIASES: Record<string, string> = {
  FHAZ: 'FRONT_HAZCAM_LEFT_A',
  RHAZ: 'REAR_HAZCAM_LEFT',
  NAVCAM: 'NAVCAM_LEFT',
  HAZCAM: 'FRONT_HAZCAM_LEFT_A',
  MAST: 'MCZ_LEFT',
  MASTCAM: 'MCZ_LEFT',
  MCZ: 'MCZ_LEFT',
  WATSON: 'SHERLOC_WATSON',
  SHERLOC: 'SHERLOC_WATSON',
  SUPERCAM: 'SUPERCAM_RMI',
};

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
      '"Show me photos from the Mars rover" / "Perseverance images from sol 1000" / "latest pictures from Mars" — raw images from NASA\'s Perseverance rover (Mars 2020), straight off the mars.nasa.gov feed. Filter by Martian sol and by camera. Returns image URLs at four resolutions, the sol, the UTC and Mars-local capture times, and the camera instrument. Keyless. Covers Perseverance only — Curiosity, Opportunity and Spirit have no live public image feed. Example: get_mars_photos({ sol: 1000, camera: "NAVCAM_LEFT" })',
    inputSchema: {
      type: 'object',
      properties: {
        sol: {
          type: 'number',
          description: 'Martian sol (mission day) to retrieve images from, e.g. 1000. Perseverance landed on sol 0 (2021-02-18) and is past sol 1900. Omit for the most recent images.',
        },
        camera: {
          type: 'string',
          description: 'Camera instrument, exact: "NAVCAM_LEFT", "NAVCAM_RIGHT", "FRONT_HAZCAM_LEFT_A", "FRONT_HAZCAM_RIGHT_A", "REAR_HAZCAM_LEFT", "REAR_HAZCAM_RIGHT", "MCZ_LEFT"/"MCZ_RIGHT" (Mastcam-Z), "SHERLOC_WATSON", "SUPERCAM_RMI", "SKYCAM", "PIXL_MCC", "CACHECAM". Short forms FHAZ/RHAZ/NAVCAM/MAST are accepted. Optional.',
        },
        limit: {
          type: 'number',
          description: 'Max images to return (default 20, max 100).',
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
  {
    name: 'donki_cme',
    description:
      '"Was there a coronal mass ejection this week?" / "is a CME heading for Earth?" — coronal mass ejections catalogued by NASA DONKI, the space-weather event database run by NASA\'s Community Coordinated Modeling Center. AUTHORITATIVE for CME occurrence and geometry: returns each eruption\'s start time, the instruments that saw it, the analysts\' note describing the source region, and for analysed events the modelled speed in km/s, the direction (latitude/longitude on the solar disk), half-angle width and whether the analysis is the most accurate available. A CME is the thing that causes an aurora or a satellite drag event two or three days later, so speed plus direction is what says whether it will reach Earth.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Start date YYYY-MM-DD (optional; DONKI defaults to ~30 days ago).' },
        end_date: { type: 'string', description: 'End date YYYY-MM-DD (optional; defaults to today).' },
        min_speed_km_s: { type: 'number', description: 'Only return CMEs whose best analysis measured at least this speed in km/s. ~500 is fast, ~1000+ is a major event.' },
        limit: { type: 'number', description: 'Max events to return (default 50, max 200).' },
        _apiKey: { type: 'string', description: 'NASA API key (optional, defaults to DEMO_KEY)' },
      },
      required: [],
    },
  },
  {
    name: 'donki_geomagnetic_storms',
    description:
      '"Was there a geomagnetic storm?" / "will there be an aurora tonight?" / "how strong was the Kp index?" — geomagnetic storm events from NASA DONKI, each with the full series of observed Kp index readings and their timestamps. AUTHORITATIVE for whether Earth\'s magnetic field was actually disturbed, as opposed to whether a flare happened: Kp 5 is a minor storm, Kp 7 puts aurora over the northern US and northern Europe, Kp 8-9 is severe. Also returns the CMEs and shocks DONKI linked to each storm, so you can trace a storm back to the eruption that caused it.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Start date YYYY-MM-DD (optional; DONKI defaults to ~30 days ago).' },
        end_date: { type: 'string', description: 'End date YYYY-MM-DD (optional; defaults to today).' },
        min_kp: { type: 'number', description: 'Only return storms whose peak observed Kp reached at least this value (5 = minor storm, 7 = strong, 9 = extreme).' },
        limit: { type: 'number', description: 'Max storms to return (default 50, max 200).' },
        _apiKey: { type: 'string', description: 'NASA API key (optional, defaults to DEMO_KEY)' },
      },
      required: [],
    },
  },
  {
    name: 'donki_solar_energetic_particles',
    description:
      'Solar energetic particle (SEP) events from NASA DONKI — bursts of high-energy protons arriving at Earth after a flare or CME. These are the events behind radiation warnings for polar airline routes, astronaut EVA holds and satellite single-event upsets. Returns the event time, the detecting instruments and energy channels (e.g. "GOES-P: SEISS >10 MeV"), and the flare or CME DONKI linked as the source.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Start date YYYY-MM-DD (optional; DONKI defaults to ~30 days ago). SEP events are rare — a year-wide window is often the right query.' },
        end_date: { type: 'string', description: 'End date YYYY-MM-DD (optional; defaults to today).' },
        limit: { type: 'number', description: 'Max events to return (default 50, max 200).' },
        _apiKey: { type: 'string', description: 'NASA API key (optional, defaults to DEMO_KEY)' },
      },
      required: [],
    },
  },
  {
    name: 'donki_notifications',
    description:
      '"What is the current space weather forecast?" — the alerts, watches, warnings and weekly summary reports NASA DONKI issues to spacecraft operators. This is the narrative layer over the event catalogues: a human forecaster\'s text saying what happened, what is expected and what the impact is. Filter by message type (alert, watch, warning, summary) or by event class (CME, flare, geomagnetic storm, SEP, radiation belt enhancement).',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Start date YYYY-MM-DD (optional; DONKI defaults to ~30 days ago).' },
        end_date: { type: 'string', description: 'End date YYYY-MM-DD (optional; defaults to today).' },
        type: {
          type: 'string',
          description: 'Message class: "all" (default), "FLR" (flare), "SEP", "CME", "IPS" (interplanetary shock), "MPC" (magnetopause crossing), "GST" (geomagnetic storm), "RBE" (radiation belt enhancement), "report" (weekly summary).',
        },
        message_type: {
          type: 'string',
          description: 'Filter the returned rows by the DONKI messageType field: "Alert", "Watch", "Warning" or "Report". Applied after fetching.',
        },
        limit: { type: 'number', description: 'Max messages to return (default 20, max 100).' },
        include_body: { type: 'boolean', description: 'Include the full message text (default true). Set false for a compact index — these bodies are long.' },
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
        args.sol as number | undefined,
        args.camera as string | undefined,
        (args.limit as number) ?? 20,
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
    case 'donki_cme':
      return getDonkiCme(args, apiKey);
    case 'donki_geomagnetic_storms':
      return getDonkiStorms(args, apiKey);
    case 'donki_solar_energetic_particles':
      return getDonkiSep(args, apiKey);
    case 'donki_notifications':
      return getDonkiNotifications(args, apiKey);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function getApod(date: string | undefined, apiKey: string) {
  const params = new URLSearchParams({ api_key: apiKey });
  if (date) params.set('date', date);

  const res = await pwFetch(`${BASE_URL}/planetary/apod?${params}`);
  if (!res.ok) throw await httpError(res, 'NASA APOD error');

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

  const res = await pwFetch(`${BASE_URL}/neo/rest/v1/feed?${params}`);
  if (!res.ok) throw await httpError(res, 'NASA NeoWs error');

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

async function getMarsPhotos(sol: number | undefined, camera: string | undefined, limit: number) {
  const num = Math.min(100, Math.max(1, limit));
  const params = new URLSearchParams({
    feed: 'raw_images',
    category: 'mars2020',
    feedtype: 'json',
    num: String(num),
  });

  if (camera) {
    const raw = camera.trim().toUpperCase();
    const instrument = MARS_CAMERA_ALIASES[raw] ?? raw;
    if (!MARS_CAMERAS.includes(instrument)) {
      throw new Error(
        `user_error: unknown camera "${camera}". Perseverance cameras are: ${MARS_CAMERAS.join(', ')}. ` +
        `CHEMCAM, MAHLI and MARDI are Curiosity instruments and are not available on this feed.`,
      );
    }
    params.set('search', instrument);
  }

  // The feed has no sol= param; sol is expressed as a gte/lte condition pair.
  if (sol != null) {
    params.set('condition_2', `${sol}:sol:gte`);
    params.set('condition_3', `${sol}:sol:lte`);
  }

  const res = await pwFetch(`${MARS_RAW_URL}/?${params}`);
  if (!res.ok) throw await httpError(res, 'upstream_down: NASA Mars raw-image feed error');

  const data = (await res.json()) as {
    total_results?: number;
    images?: Array<{
      imageid: string; sol: number; title: string;
      date_taken_utc: string; date_taken_mars: string; credit: string; link: string;
      camera?: { instrument?: string; filter_name?: string };
      image_files?: { small?: string; medium?: string; large?: string; full_res?: string };
    }>;
  };

  const images = data.images ?? [];
  return {
    rover: 'Perseverance',
    sol: sol ?? null,
    camera: camera ?? null,
    total_matching: data.total_results ?? images.length,
    count: images.length,
    photos: images.map((p) => ({
      id: p.imageid,
      sol: p.sol,
      title: p.title,
      camera: p.camera?.instrument ?? null,
      filter: p.camera?.filter_name ?? null,
      earth_date: p.date_taken_utc,
      mars_time: p.date_taken_mars,
      image_url: p.image_files?.large ?? p.image_files?.medium ?? p.image_files?.full_res ?? null,
      full_res_url: p.image_files?.full_res ?? null,
      thumbnail_url: p.image_files?.small ?? null,
      page_url: p.link,
      credit: p.credit,
    })),
  };
}

async function searchNasaImages(query: string, mediaType: string | undefined, limit: number) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('Required argument "query" is missing (e.g. "jupiter").');
  const size = Math.min(50, Math.max(1, limit));
  const params = new URLSearchParams({ q });
  if (mediaType) params.set('media_type', mediaType);

  const res = await pwFetch(`${IMAGES_URL}/search?${params}`);
  if (!res.ok) throw await httpError(res, 'NASA Images error');

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

  const res = await pwFetch(`${BASE_URL}/DONKI/FLR?${params}`);
  if (!res.ok) throw await httpError(res, 'NASA DONKI error');

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

/* --------------------------------------------------------------- DONKI ---- */

/**
 * DONKI is the CCMC's space-weather event database. Every endpoint takes the
 * same startDate/endDate pair and answers a JSON ARRAY — an empty array is a
 * real "nothing happened in that window" for CME/GST/SEP, which is why the
 * helpers below report `window` alongside the count: a zero is only readable
 * next to the dates it was asked about.
 *
 * DONKI ignores an out-of-range date silently rather than erroring, so the
 * dates are validated here instead.
 */
async function donkiList(
  endpoint: string,
  args: Record<string, unknown>,
  apiKey: string,
  extra?: Record<string, string>,
): Promise<{ data: Array<Record<string, unknown>>; window: { start: string | null; end: string | null } }> {
  const params = new URLSearchParams({ api_key: apiKey, ...(extra ?? {}) });
  const start = assertDonkiDate(args.start_date, 'start_date');
  const end = assertDonkiDate(args.end_date, 'end_date');
  if (start) params.set('startDate', start);
  if (end) params.set('endDate', end);

  const res = await pwFetch(`${BASE_URL}/DONKI/${endpoint}?${params}`);
  if (!res.ok) throw await httpError(res, `NASA DONKI ${endpoint} error`);

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error(`upstream_error: NASA DONKI ${endpoint} returned a non-array body.`);
  }
  return { data: data as Array<Record<string, unknown>>, window: { start: start ?? null, end: end ?? null } };
}

function assertDonkiDate(raw: unknown, field: string): string | undefined {
  if (raw == null || raw === '') return undefined;
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`user_error: ${field} must be YYYY-MM-DD, got "${raw}".`);
  }
  return s;
}

function donkiLimit(raw: unknown, def: number, max: number): number {
  const n = Math.round(Number(raw ?? def));
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : def;
}

function instrumentNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((i) => (i as { displayName?: string })?.displayName ?? '').filter(Boolean);
}

function linkedIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((i) => (i as { activityID?: string })?.activityID ?? '').filter(Boolean);
}

async function getDonkiCme(args: Record<string, unknown>, apiKey: string) {
  const limit = donkiLimit(args.limit, 50, 200);
  const { data, window } = await donkiList('CME', args, apiKey);

  const events = data.map((e) => {
    const analyses = Array.isArray(e.cmeAnalyses) ? (e.cmeAnalyses as Array<Record<string, unknown>>) : [];
    // DONKI may carry several analyses per CME; `isMostAccurate` marks the one
    // the forecaster stands behind. Taking analyses[0] would sometimes report a
    // superseded speed as if it were current.
    const best = analyses.find((a) => a.isMostAccurate === true) ?? analyses[0];
    return {
      id: (e.activityID as string) ?? null,
      start_time: (e.startTime as string) ?? null,
      catalog: (e.catalog as string) ?? null,
      instruments: instrumentNames(e.instruments),
      source_location: (e.sourceLocation as string) || null,
      active_region: (e.activeRegionNum as number | null) ?? null,
      speed_km_s: best ? ((best.speed as number | null) ?? null) : null,
      direction_latitude: best ? ((best.latitude as number | null) ?? null) : null,
      direction_longitude: best ? ((best.longitude as number | null) ?? null) : null,
      half_angle_deg: best ? ((best.halfAngle as number | null) ?? null) : null,
      cme_type: best ? ((best.type as string | null) ?? null) : null,
      analysis_is_most_accurate: best ? best.isMostAccurate === true : null,
      analysis_count: analyses.length,
      note: (e.note as string) || null,
      linked_events: linkedIds(e.linkedEvents),
      link: (e.link as string) ?? null,
    };
  });

  const minSpeed = args.min_speed_km_s == null ? null : Number(args.min_speed_km_s);
  const filtered = minSpeed == null
    ? events
    : events.filter((e) => e.speed_km_s != null && (e.speed_km_s as number) >= minSpeed);

  return {
    window,
    min_speed_km_s: minSpeed,
    total_matching: filtered.length,
    count: Math.min(filtered.length, limit),
    fastest_km_s: filtered.reduce<number | null>((m, e) => {
      const s = e.speed_km_s as number | null;
      return s != null && (m == null || s > m) ? s : m;
    }, null),
    cmes: filtered.slice(0, limit),
  };
}

async function getDonkiStorms(args: Record<string, unknown>, apiKey: string) {
  const limit = donkiLimit(args.limit, 50, 200);
  const { data, window } = await donkiList('GST', args, apiKey);

  const storms = data.map((e) => {
    const kp = Array.isArray(e.allKpIndex) ? (e.allKpIndex as Array<Record<string, unknown>>) : [];
    const values = kp.map((k) => Number(k.kpIndex)).filter((n) => Number.isFinite(n));
    const peak = values.length ? Math.max(...values) : null;
    return {
      id: (e.gstID as string) ?? null,
      start_time: (e.startTime as string) ?? null,
      peak_kp: peak,
      // The storm scale a reader recognises; DONKI itself publishes only Kp.
      noaa_scale: peak == null ? null : peak >= 9 ? 'G5 (extreme)' : peak >= 8 ? 'G4 (severe)' : peak >= 7 ? 'G3 (strong)' : peak >= 6 ? 'G2 (moderate)' : peak >= 5 ? 'G1 (minor)' : 'below storm level',
      kp_readings: kp.map((k) => ({
        observed_time: (k.observedTime as string) ?? null,
        kp_index: (k.kpIndex as number) ?? null,
        source: (k.source as string) ?? null,
      })),
      linked_events: linkedIds(e.linkedEvents),
      link: (e.link as string) ?? null,
    };
  });

  const minKp = args.min_kp == null ? null : Number(args.min_kp);
  const filtered = minKp == null
    ? storms
    : storms.filter((s) => s.peak_kp != null && (s.peak_kp as number) >= minKp);

  return {
    window,
    min_kp: minKp,
    total_matching: filtered.length,
    count: Math.min(filtered.length, limit),
    strongest_kp: filtered.reduce<number | null>((m, s) => {
      const k = s.peak_kp as number | null;
      return k != null && (m == null || k > m) ? k : m;
    }, null),
    storms: filtered.slice(0, limit),
  };
}

async function getDonkiSep(args: Record<string, unknown>, apiKey: string) {
  const limit = donkiLimit(args.limit, 50, 200);
  const { data, window } = await donkiList('SEP', args, apiKey);

  return {
    window,
    total_matching: data.length,
    count: Math.min(data.length, limit),
    events: data.slice(0, limit).map((e) => ({
      id: (e.sepID as string) ?? null,
      event_time: (e.eventTime as string) ?? null,
      instruments: instrumentNames(e.instruments),
      submission_time: (e.submissionTime as string) ?? null,
      linked_events: linkedIds(e.linkedEvents),
      link: (e.link as string) ?? null,
    })),
  };
}

const DONKI_NOTIFICATION_TYPES = ['all', 'FLR', 'SEP', 'CME', 'IPS', 'MPC', 'GST', 'RBE', 'report'];

async function getDonkiNotifications(args: Record<string, unknown>, apiKey: string) {
  const limit = donkiLimit(args.limit, 20, 100);
  const includeBody = args.include_body !== false;

  const rawType = String(args.type ?? 'all').trim();
  const type = DONKI_NOTIFICATION_TYPES.find((t) => t.toLowerCase() === rawType.toLowerCase());
  if (!type) {
    throw new Error(
      `user_error: unknown type "${rawType}". DONKI notification types are: ${DONKI_NOTIFICATION_TYPES.join(', ')}.`,
    );
  }

  const { data, window } = await donkiList('notifications', args, apiKey, { type });

  const wanted = args.message_type == null ? null : String(args.message_type).trim().toLowerCase();
  const rows = data
    .filter((m) => wanted == null || String(m.messageType ?? '').toLowerCase() === wanted)
    .map((m) => {
      const body = String(m.messageBody ?? '');
      return {
        id: (m.messageID as string) ?? null,
        message_type: (m.messageType as string) ?? null,
        issue_time: (m.messageIssueTime as string) ?? null,
        url: (m.messageURL as string) ?? null,
        body: includeBody ? body : null,
        // Even with bodies suppressed, the first line is what makes a row
        // identifiable — an index of opaque ids is not usable.
        summary:
          body.split('\n').find((l) => l.startsWith('## Message Type:'))?.replace('## Message Type:', '').trim()
          ?? (body.replace(/\s+/g, ' ').slice(0, 200) || null),
      };
    });

  return {
    window,
    type,
    message_type_filter: wanted,
    total_matching: rows.length,
    count: Math.min(rows.length, limit),
    messages: rows.slice(0, limit),
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
