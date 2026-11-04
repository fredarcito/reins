#!/usr/bin/env bash
# Tests @harness/core peerDependencies with pnpm using tarballs (unpublished).
set -uo pipefail
S="$1"; mkdir -p "$S/src" && cd "$S/src"

mk(){ mkdir -p "$1"; cat > "$1/package.json"; }

mk core <<'EOF'
{ "name": "@harness/core", "version": "0.1.0", "type": "module",
  "exports": { ".": "./index.js", "./contract": "./contract.js" } }
EOF
echo 'export const CONTRACT_VERSION = 1; export const instance = Symbol("core-instance");' > core/contract.js
echo 'export * from "./contract.js"; export const internal = true;' > core/index.js

mk adapter <<'EOF'
{ "name": "@harness/adapter-js", "version": "0.1.0", "type": "module", "main": "index.js",
  "peerDependencies": { "@harness/core": "^0.1.0" }, "harness": { "contract": 1 } }
EOF
echo 'import { instance, CONTRACT_VERSION } from "@harness/core/contract"; export default { name: "js", contract: CONTRACT_VERSION, coreInstance: instance };' > adapter/index.js
cat > adapter/deep.js <<'EOF'
// tries to import something core does NOT export: must fail because of "exports"
export const tryInternal = async () => { try { await import("@harness/core/index.js"); return "ACCESIBLE"; } catch (e) { return e.code; } };
EOF

mk cli <<'EOF'
{ "name": "@harness/cli", "version": "0.1.0", "type": "module", "main": "index.js",
  "dependencies": { "@harness/core": "^0.1.0" } }
EOF
cat > cli/index.js <<'EOF'
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { instance } from '@harness/core/contract';
export async function load(projectRoot) {
  const out = {};
  // 1) direct import from the CLI (strict pnpm: the CLI does not declare the adapter)
  try { await import('@harness/adapter-js'); out.direct = 'OK'; } catch (e) { out.direct = e.code; }
  // 2) resolve from the consumer project root
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const mod = (await import(pathToFileURL(req.resolve('@harness/adapter-js')).href)).default;
  out.fromProject = 'OK';
  out.sameCoreInstance = mod.coreInstance === instance;
  out.contract = mod.contract;
  return out;
}
EOF

cd "$S/src" && for p in core adapter cli; do (cd $p && npm pack -s --pack-destination "$S" >/dev/null); done
ls "$S"/*.tgz

consumer(){ # name, deps json, overrides json
  local d="$S/$1"; mkdir -p "$d"
  cat > "$d/package.json" <<EOF
{ "name": "$1", "private": true, "type": "module", "devDependencies": $2 }
EOF
  printf 'overrides: %s\n' "$3" > "$d/pnpm-workspace.yaml"
  echo "### $1"; (cd "$d" && pnpm install 2>&1 | grep -v -E '^(Progress|Packages:|\+|$)' | tail -8; echo "install exit=${PIPESTATUS[0]}")
  (cd "$d" && node --input-type=module -e 'import { createRequire } from "node:module"; const r=createRequire(process.cwd()+"/package.json"); const {load}=await import(r.resolve("@harness/cli")); console.log(JSON.stringify(await load(process.cwd())))' 2>&1 | tail -3 || true)
  (cd "$d" && node --input-type=module -e 'import { createRequire } from "node:module"; const r=createRequire(process.cwd()+"/package.json"); const p=r.resolve("@harness/adapter-js"); const m=await import(p.replace("index.js","deep.js")); console.log("adapter import of non-exported path:", await m.tryInternal())' 2>&1 || true)
}
T="file:$S"
OV="{ \"@harness/core\": \"$T/harness-core-0.1.0.tgz\" }"
consumer A-explicit "{ \"@harness/core\": \"$T/harness-core-0.1.0.tgz\", \"@harness/cli\": \"$T/harness-cli-0.1.0.tgz\", \"@harness/adapter-js\": \"$T/harness-adapter-js-0.1.0.tgz\" }" "$OV"
consumer B-no-core "{ \"@harness/cli\": \"$T/harness-cli-0.1.0.tgz\", \"@harness/adapter-js\": \"$T/harness-adapter-js-0.1.0.tgz\" }" "$OV"

# C: core with a version incompatible with the peer (^0.1.0)
cd "$S/src/core" && node -e 'const f="package.json",p=JSON.parse(require("fs").readFileSync(f));p.version="0.2.0";require("fs").writeFileSync(f,JSON.stringify(p))' && npm pack -s --pack-destination "$S" >/dev/null
consumer C-incompatible-version "{ \"@harness/core\": \"$T/harness-core-0.2.0.tgz\", \"@harness/cli\": \"$T/harness-cli-0.1.0.tgz\", \"@harness/adapter-js\": \"$T/harness-adapter-js-0.1.0.tgz\" }" "{ \"@harness/core\": \"$T/harness-core-0.2.0.tgz\" }"
(cd "$S/C-incompatible-version" && pnpm install 2>&1 | grep -i -A3 "peer" | head -8)
