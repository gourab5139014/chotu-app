import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { stringify } from "yaml";

import { buildOpenApiDocument } from "../src/contract/build";

const target = fileURLToPath(new URL("../../../openapi.yaml", import.meta.url));
const yaml = stringify(buildOpenApiDocument(), { sortMapEntries: false });
writeFileSync(target, yaml.endsWith("\n") ? yaml : `${yaml}\n`);
process.stdout.write(`wrote ${target}\n`);
