import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_ROOT = "https://api.discogs.com";
const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_RETRIES = 5;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function retryDelay(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  const reset = response.headers.get("x-discogs-ratelimit-reset");
  if (reset && /^\d+$/.test(reset)) return Math.max(1000, Number(reset) * 1000);
  return Math.min(30_000, 1000 * 2 ** attempt);
}

async function requestJson(url, { token, userAgent, maxRetries, fetchImpl, sleepImpl }) {
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Authorization: `Discogs token=${token}`,
          Accept: "application/vnd.discogs.v2.discogs+json",
          "User-Agent": userAgent
        },
        signal: AbortSignal.timeout(30_000)
      });
    } catch (error) {
      if (attempt >= maxRetries) throw new Error(`Discogs request failed after ${attempt + 1} attempts: ${error.message}`);
      await sleepImpl(Math.min(30_000, 1000 * 2 ** attempt));
      continue;
    }

    if (response.ok) return response.json();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= maxRetries) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(`Discogs returned HTTP ${response.status}: ${body}`);
    }
    await sleepImpl(retryDelay(response, attempt));
  }
}

function compactRelease(item) {
  const basic = item.basic_information ?? {};
  return {
    instance_id: item.instance_id,
    release_id: item.id,
    folder_id: item.folder_id,
    artist: (basic.artists ?? []).map((artist) => artist.name).join(", "),
    title: basic.title ?? "",
    year: basic.year || null,
    genres: basic.genres ?? [],
    styles: basic.styles ?? [],
    formats: (basic.formats ?? []).map(({ name, qty, descriptions }) => ({
      name,
      quantity: qty ? Number(qty) : 1,
      descriptions: descriptions ?? []
    })),
    labels: (basic.labels ?? []).map(({ name, catno }) => ({ name, catalog_number: catno ?? "" }))
  };
}

export async function fetchCollection(options = {}) {
  const username = options.username ?? process.env.DISCOGS_USERNAME ?? "wookie61";
  const token = options.token ?? process.env.DISCOGS_TOKEN;
  const perPage = positiveInteger(options.perPage ?? process.env.PER_PAGE, DEFAULT_PER_PAGE, "PER_PAGE");
  const maxRetries = positiveInteger(options.maxRetries ?? process.env.MAX_RETRIES, DEFAULT_MAX_RETRIES, "MAX_RETRIES");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  const userAgent = options.userAgent ?? process.env.DISCOGS_USER_AGENT ?? "discogs-album-feed/1.0";
  if (!token) throw new Error("DISCOGS_TOKEN is required");
  if (!username) throw new Error("DISCOGS_USERNAME is required");

  let expectedPages;
  let expectedItems;
  const releases = [];
  let page = 1;

  while (expectedPages === undefined || page <= expectedPages) {
    const url = new URL(`/users/${encodeURIComponent(username)}/collection/folders/0/releases`, API_ROOT);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    const payload = await requestJson(url, { token, userAgent, maxRetries, fetchImpl, sleepImpl });
    const pagination = payload.pagination;
    if (!pagination || !Number.isInteger(pagination.pages) || !Number.isInteger(pagination.items)) {
      throw new Error(`Page ${page} did not include valid pagination metadata`);
    }
    if (page === 1) {
      expectedPages = pagination.pages;
      expectedItems = pagination.items;
    } else if (pagination.pages !== expectedPages || pagination.items !== expectedItems) {
      throw new Error(`Collection changed during pagination (page ${page} metadata differs from page 1); retry the workflow`);
    }
    if (pagination.page !== page) throw new Error(`Expected page ${page}, received page ${pagination.page}`);
    if (!Array.isArray(payload.releases)) throw new Error(`Page ${page} has no releases array`);
    releases.push(...payload.releases.map(compactRelease));
    page += 1;
  }

  if (releases.length !== expectedItems) {
    throw new Error(`Pagination verification failed: fetched ${releases.length}, Discogs reported ${expectedItems}`);
  }
  const instanceIds = releases.map((release) => release.instance_id);
  if (new Set(instanceIds).size !== instanceIds.length) throw new Error("Pagination verification failed: duplicate instance IDs found");

  return {
    schema_version: 1,
    source: "Discogs collection",
    username,
    generated_at: new Date().toISOString(),
    verification: {
      complete: true,
      reported_items: expectedItems,
      fetched_items: releases.length,
      fetched_pages: expectedPages,
      per_page: perPage
    },
    releases
  };
}

async function main() {
  const output = resolve(process.env.OUTPUT_PATH ?? "public/collection.json");
  const temporary = `${output}.tmp`;
  const collection = await fetchCollection();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(collection, null, 2)}\n`, { mode: 0o644 });
  await rename(temporary, output);
  console.log(`Verified and wrote ${collection.verification.fetched_items} collection items across ${collection.verification.fetched_pages} pages.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
