import fs from "node:fs";

const manifestFiles = [
  "package.json",
  "apps/api/package.json",
  "apps/web/package.json",
  "packages/shared/package.json",
];

const depSections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundleDependencies",
  "bundledDependencies",
  "overrides",
  "resolutions",
];

let failed = false;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function walk(value, path) {
  if (value === "") {
    console.log(`EMPTY STRING at ${path}`);
    failed = true;
  }
  if (value === null) {
    console.log(`NULL at ${path}`);
    failed = true;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walk(child, `${path}.${key}`);
    }
  }
}

for (const file of manifestFiles) {
  const pkg = readJson(file);
  console.log(`\n=== ${file} ===`);
  console.log("name:", JSON.stringify(pkg.name));
  console.log("version:", JSON.stringify(pkg.version));
  console.log("packageManager:", JSON.stringify(pkg.packageManager));
  console.log("engines:", JSON.stringify(pkg.engines));
  console.log("devEngines:", JSON.stringify(pkg.devEngines));
  console.log("dependencies:", JSON.stringify(pkg.dependencies));
  console.log("devDependencies:", JSON.stringify(pkg.devDependencies));
  console.log("peerDependencies:", JSON.stringify(pkg.peerDependencies));
  console.log("optionalDependencies:", JSON.stringify(pkg.optionalDependencies));
  console.log("overrides:", JSON.stringify(pkg.overrides));

  walk(pkg, file);

  for (const section of depSections) {
    const deps = pkg[section];
    if (!deps) continue;

    if (section === "bundleDependencies" || section === "bundledDependencies") {
      if (!Array.isArray(deps) && typeof deps !== "boolean") {
        console.log(`INVALID ${file}.${section}: expected array or boolean`);
        failed = true;
      }
      continue;
    }

    if (typeof deps !== "object" || Array.isArray(deps)) {
      console.log(`INVALID ${file}.${section}: expected object`);
      failed = true;
      continue;
    }

    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== "string") {
        console.log(`INVALID SPEC TYPE ${file}.${section}.${name}: ${typeof spec}`);
        failed = true;
      } else if (spec.trim() === "") {
        console.log(`EMPTY DEP SPEC ${file}.${section}.${name}`);
        failed = true;
      }
    }
  }
}

const lock = readJson("package-lock.json");
console.log(`\n=== package-lock.json ===`);
console.log("lockfileVersion:", lock.lockfileVersion);
console.log("root version:", lock.packages?.[""]?.version);

walk(lock, "package-lock.json");

for (const [pkgPath, pkg] of Object.entries(lock.packages || {})) {
  if ("version" in pkg && (typeof pkg.version !== "string" || pkg.version.trim() === "")) {
    console.log(`INVALID LOCK VERSION at packages[${pkgPath}]: ${JSON.stringify(pkg.version)}`);
    failed = true;
  }

  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== "string" || spec.trim() === "") {
        console.log(`INVALID LOCK DEP SPEC packages[${pkgPath}].${section}.${name}: ${JSON.stringify(spec)}`);
        failed = true;
      }
    }
  }
}

if (failed) {
  console.error("\nPackage metadata diagnostic found invalid values.");
  process.exit(1);
}

console.log("\nPackage metadata diagnostic found no obvious empty/invalid metadata values.");
