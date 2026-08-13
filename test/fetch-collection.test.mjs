import test from "node:test";
import assert from "node:assert/strict";
import { fetchCollection } from "../scripts/fetch-collection.mjs";

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const item = (id) => ({
  id: id + 100,
  instance_id: id,
  folder_id: 1,
  basic_information: {
    title: `Album ${id}`,
    year: 2000 + id,
    artists: [{ name: `Artist ${id}` }],
    genres: ["Rock"],
    styles: ["Indie Rock"],
    formats: [{ name: "Vinyl", qty: "1", descriptions: ["LP"] }],
    labels: [{ name: "Example", catno: `CAT-${id}` }]
  }
});

test("fetches all pages and emits only compact fields", async () => {
  const pages = [
    { pagination: { page: 1, pages: 2, items: 3 }, releases: [item(1), item(2)] },
    { pagination: { page: 2, pages: 2, items: 3 }, releases: [item(3)] }
  ];
  const result = await fetchCollection({ token: "secret", perPage: 2, fetchImpl: async () => response(200, pages.shift()) });
  assert.equal(result.verification.complete, true);
  assert.equal(result.releases.length, 3);
  assert.deepEqual(Object.keys(result.releases[0]), ["instance_id", "release_id", "folder_id", "artist", "title", "year", "genres", "styles", "formats", "labels"]);
});

test("rejects a mismatched total", async () => {
  await assert.rejects(
    fetchCollection({ token: "secret", fetchImpl: async () => response(200, { pagination: { page: 1, pages: 1, items: 2 }, releases: [item(1)] }) }),
    /fetched 1, Discogs reported 2/
  );
});

test("retries rate limits", async () => {
  let calls = 0;
  const result = await fetchCollection({
    token: "secret",
    sleepImpl: async () => {},
    fetchImpl: async () => ++calls === 1
      ? response(429, { message: "slow down" }, { "retry-after": "0" })
      : response(200, { pagination: { page: 1, pages: 1, items: 1 }, releases: [item(1)] })
  });
  assert.equal(calls, 2);
  assert.equal(result.releases.length, 1);
});
