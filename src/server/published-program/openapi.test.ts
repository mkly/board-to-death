import { test } from "vitest";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("published-program OpenAPI contract describes all public routes without private speaker fields", async () => {
  const contractUrl = new URL("../../../public/openapi/published-program-v1.json", import.meta.url);
  const contract = JSON.parse(await readFile(contractUrl, "utf8"));
  const paths = ["/api/v1/events/{id}/sessions", "/api/v1/events/{id}/speakers", "/api/v1/events/{id}/agenda"];

  assert.equal(contract.openapi, "3.1.0");
  assert.deepEqual(Object.keys(contract.paths), paths);
  assert.deepEqual(contract.security, [{}, { ApiKeyAuth: [] }]);
  for (const path of paths) {
    assert.deepEqual(Object.keys(contract.paths[path].get.responses), ["200", "304", "400", "404", "410"]);
  }

  const speakerProperties = contract.components.schemas.Speaker.properties;
  assert.equal(speakerProperties.email, undefined);
  assert.equal(speakerProperties.phone, undefined);
  assert.equal(speakerProperties.photoObjectKey, undefined);
  assert.match(contract.info.description, /never expands fields or access/);
  assert.match(contract.components.responses.NotFound.description, /EVENT_NOT_FOUND.*PROGRAM_NOT_PUBLISHED/);
});
