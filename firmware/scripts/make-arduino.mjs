import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname, basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FW = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(FW, "arduino");
const check = process.argv.includes("--check");

const SKETCHES = [
  { name: "HisnPuck", env: "puck", dirs: ["src/common", "src/puck"], main: "hisn_puck.cpp" },
  { name: "HisnLight", env: "light", dirs: ["src/common", "src/light"], main: "hisn_light.cpp" },
];
const SHARED = ["lib/hisn_crypto/src", "third_party/micro-ecc"];
const SKIP_DEFINES = new Set(["CORE_DEBUG_LEVEL"]);

function iniSections(text) {
  const out = {};
  let cur = null;
  let key = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    const sec = line.match(/^\[(.+)\]\s*$/);
    if (sec) {
      cur = out[sec[1]] = {};
      key = null;
      continue;
    }
    if (!cur || !line.trim()) continue;
    const kv = line.match(/^([A-Za-z_][\w.]*)\s*=\s*(.*)$/);
    if (kv && !/^\s/.test(line)) {
      key = kv[1];
      cur[key] = kv[2];
    } else if (key) {
      cur[key] += " " + line.trim();
    }
  }
  return out;
}

function defines(sections, env) {
  const expand = (v) => v.replace(/\$\{([\w:]+)\.(\w+)\}/g, (_, s, k) => expand(sections[s]?.[k] ?? ""));
  const flags = expand(sections[`env:${env}`].build_flags ?? "");
  const out = new Map();
  for (const tok of flags.match(/-D\S+/g) ?? []) {
    const [name, ...rest] = tok.slice(2).split("=");
    if (SKIP_DEFINES.has(name)) continue;
    out.set(name, rest.length ? rest.join("=").replace(/\\"/g, '"') : "1");
  }
  return out;
}

function flatName(file) {
  if (extname(file) === ".inc") return "uECC_" + basename(file, ".inc").replace(/-/g, "_") + ".h";
  return basename(file);
}

function rewrite(text, names) {
  return text.replace(/#include\s+"([^"]+)"/g, (whole, inc) => {
    const flat = flatName(inc);
    return names.has(flat) ? `#include "${flat}"` : whole;
  });
}

function build(sketch, sections) {
  const files = new Map();
  for (const dir of [...sketch.dirs, ...SHARED]) {
    for (const f of readdirSync(resolve(FW, dir))) {
      if (!/\.(c|cpp|h|inc)$/.test(f)) continue;
      const name = f === "main.cpp" ? sketch.main : flatName(f);
      if (files.has(name)) throw new Error(`${sketch.name}: two files named ${name}`);
      files.set(name, readFileSync(resolve(FW, dir, f), "utf8").replace(/\r\n/g, "\n"));
    }
  }
  const names = new Set([...files.keys(), "hisn_build.h"]);
  const out = new Map();
  for (const [name, text] of files) {
    const body = rewrite(text, names);
    out.set(`src/${name}`, /\.(c|cpp)$/.test(name) ? `#include "hisn_build.h"\n${body}` : body);
  }
  const defs = [...defines(sections, sketch.env)].map(([k, v]) => `#define ${k} ${v}`);
  out.set(
    "src/hisn_build.h",
    ["#pragma once", '#if __has_include("../secrets.h")', '#include "../secrets.h"', "#endif", ...defs, ""].join("\n"),
  );
  out.set(`${sketch.name}.ino`, '#include "src/hisn_build.h"\n');
  out.set(
    "secrets.example.h",
    [
      "#pragma once",
      '#define HISN_WIFI_SSID ""',
      '#define HISN_WIFI_PASS ""',
      '#define HISN_WIFI2_SSID ""',
      '#define HISN_WIFI2_PASS ""',
      '#define HISN_RELAYER_HOST ""',
      "#define HISN_RELAYER_PORT 8787",
      '#define HISN_RELAYER_TOKEN ""',
      '#define HISN_VAULT_ADDRESS ""',
      "#define HISN_CHAIN_ID 296",
      '#define HISN_USDC_ADDRESS ""',
      "",
    ].join("\n"),
  );
  return out;
}

function listTree(root, rel = "") {
  if (!existsSync(join(root, rel))) return [];
  const out = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listTree(root, p));
    else out.push(p);
  }
  return out;
}

const sections = iniSections(readFileSync(resolve(FW, "platformio.ini"), "utf8"));
let stale = [];
for (const sketch of SKETCHES) {
  const dir = resolve(OUT, sketch.name);
  const want = build(sketch, sections);
  if (check) {
    const have = listTree(dir).filter((p) => p !== "secrets.h");
    for (const p of new Set([...have, ...want.keys()])) {
      const cur = existsSync(join(dir, p)) ? readFileSync(join(dir, p), "utf8").replace(/\r\n/g, "\n") : null;
      if (cur !== want.get(p)) stale.push(`${sketch.name}/${p}`);
    }
    continue;
  }
  rmSync(resolve(dir, "src"), { recursive: true, force: true });
  for (const [p, text] of want) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  console.log(`${sketch.name}: ${want.size} files`);
}
if (check) {
  if (stale.length) {
    console.error(`Arduino sketches are out of date, run: node firmware/scripts/make-arduino.mjs\n  ${stale.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Arduino sketches match the PlatformIO sources");
}
