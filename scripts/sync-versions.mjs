#!/usr/bin/env node
/**
 * Propagate the release version from packages/desktop/package.json into every
 * Rust workspace in crates/.
 *
 * packages/desktop/package.json is the single source of truth for a release:
 * desktop-release.yml tags `v${version}` from it, and the daemons' build.rs
 * already stamps their reported `client_version` from that same file. Before
 * this script the Rust manifests carried unrelated pinned numbers (stdiod
 * 0.0.1, detectord 0.1.0), so `sealgate-stdiod --version` reported the app
 * version while its Cargo.toml said something else entirely. Now the manifests
 * agree, and build.rs's package.json walk is a belt-and-braces fallback rather
 * than the mechanism.
 *
 * Usage:
 *   npm run version:sync     # rewrite manifests + lockfiles
 *   npm run version:check    # exit 1 on drift, change nothing (what CI runs)
 *
 * ALWAYS run version:sync right after bumping packages/desktop/package.json and
 * commit what it touches - CI fails the build otherwise.
 *
 * NOT synced: packages/shared. It is a separately versioned library that the
 * desktop app consumes via a semver range (`^0.1.0`), so tying it to the app's
 * release number would make every app bump a fake breaking change downstream.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SOURCE = join(ROOT, 'packages/desktop/package.json')

// Every Rust workspace whose version follows the app. Each one must carry the
// version at the [workspace.package] level, with members on
// `version.workspace = true` - a member that pins its own version would be
// silently missed here, which is part of what `--check` in CI catches.
const RUST_WORKSPACES = ['crates/stdiod', 'crates/detectord']

const CHECK = process.argv.includes('--check')
const drift = []

function fail(msg) {
  console.error(`sync-versions: ${msg}`)
  process.exit(1)
}

/** The release version: the desktop app's package.json `version`. */
function sourceVersion() {
  const v = JSON.parse(readFileSync(SOURCE, 'utf8')).version
  // Cargo accepts a superset of semver but the release tag is v${version}, so
  // anything not semver-shaped is a mistake worth catching at the source.
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v)) {
    fail(`packages/desktop/package.json has no usable semver version (got ${JSON.stringify(v)})`)
  }
  return v
}

/** Absolute paths of a workspace's member Cargo.toml files. */
function memberManifests(rootManifest) {
  const text = readFileSync(rootManifest, 'utf8')
  const block = text.match(/^members\s*=\s*\[([\s\S]*?)\]/m)
  if (!block) return []
  return [...block[1].matchAll(/"([^"]+)"/g)]
    .map((m) => join(dirname(rootManifest), m[1], 'Cargo.toml'))
    .filter((p) => existsSync(p))
}

/**
 * Rewrite the `version` key of a Cargo manifest's [workspace.package] table.
 * Scoped to that one table so a `version` under [workspace.dependencies] or a
 * [patch] section can never be hit by accident.
 */
function retargetWorkspaceVersion(text, version) {
  const header = '[workspace.package]'
  const start = text.indexOf(header)
  if (start === -1) return { missing: true }
  // The table ends at the next top-level table header, or EOF.
  const rest = text.slice(start + header.length)
  const endRel = rest.search(/^\[/m)
  const body = endRel === -1 ? rest : rest.slice(0, endRel)
  const m = body.match(/^version\s*=\s*"([^"]*)"/m)
  if (!m) return { missing: true }
  if (m[1] === version) return { current: m[1], next: null }
  const newBody = body.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`)
  const tail = endRel === -1 ? '' : rest.slice(endRel)
  return { current: m[1], next: text.slice(0, start + header.length) + newBody + tail }
}

/**
 * Rewrite the `version` pin on dependency entries pointing at a crate inside
 * this same workspace, e.g.
 *
 *   sealgate-tunnel-protocol = { path = "crates/sealgate-tunnel-protocol", version = "0.0.1" }
 *
 * Such a pin is only consulted when publishing (a path dep resolves locally
 * otherwise), but cargo still refuses to resolve the workspace once the pin
 * stops matching the member's version - so bumping [workspace.package] without
 * this leaves the tree unbuildable. Only entries whose `path` resolves to a
 * real Cargo.toml are touched, so an external dep carrying both keys is safe.
 */
function retargetPathDepPins(manifestPath, text, version) {
  const dir = dirname(manifestPath)
  const hits = []
  const next = text.replace(
    /^([ \t]*)([A-Za-z0-9_-]+)([ \t]*=[ \t]*\{)([^}\n]*)\}/gm,
    (whole, indent, name, eq, body) => {
      const path = body.match(/\bpath[ \t]*=[ \t]*"([^"]+)"/)
      const ver = body.match(/\bversion[ \t]*=[ \t]*"([^"]*)"/)
      if (!path || !ver) return whole
      if (!existsSync(join(dir, path[1], 'Cargo.toml'))) return whole
      if (ver[1] === version) return whole
      hits.push(`${name} ${ver[1]}`)
      return `${indent}${name}${eq}${body.replace(/\bversion([ \t]*=[ \t]*)"[^"]*"/, `version$1"${version}"`)}}`
    },
  )
  return { next: hits.length > 0 ? next : null, hits }
}

/** Apply one manifest rewrite: record the drift, and write unless --check. */
function apply(manifest, text, note) {
  drift.push(`${relative(ROOT, manifest)}: ${note}`)
  if (CHECK) return
  writeFileSync(manifest, text)
  console.log(`  wrote ${relative(ROOT, manifest)}`)
}

/**
 * Lockfile drift for one workspace. Lockfiles are checked in, so a stale one
 * breaks `--locked` builds just as loudly as a stale manifest - and it can be
 * stale even when Cargo.toml is right (someone hand-edited the manifest and
 * never re-ran cargo).
 */
function lockDrift(ws, version) {
  const lock = join(ROOT, ws, 'Cargo.lock')
  if (!existsSync(lock)) return []
  const text = readFileSync(lock, 'utf8')
  const out = []
  for (const manifest of memberManifests(join(ROOT, ws, 'Cargo.toml'))) {
    const name = readFileSync(manifest, 'utf8').match(/^name\s*=\s*"([^"]+)"/m)?.[1]
    if (!name) continue
    const m = text.match(new RegExp(`^name = "${name}"\\nversion = "([^"]*)"`, 'm'))
    if (!m) fail(`${ws}/Cargo.lock has no entry for workspace member '${name}'`)
    if (m[1] !== version) out.push(`${ws}/Cargo.lock: ${name} ${m[1]} != ${version}`)
  }
  return out
}

const version = sourceVersion()

for (const ws of RUST_WORKSPACES) {
  const root = join(ROOT, ws, 'Cargo.toml')
  if (!existsSync(root)) fail(`${relative(ROOT, root)} not found`)

  // Root manifest: the inherited version, plus any path-dep pins living in
  // [workspace.dependencies].
  const before = readFileSync(root, 'utf8')
  const ws_ = retargetWorkspaceVersion(before, version)
  if (ws_.missing) {
    fail(`${ws}/Cargo.toml has no version under [workspace.package]; add one and put its members on 'version.workspace = true'`)
  }
  let text = ws_.next ?? before
  const rootPins = retargetPathDepPins(root, text, version)
  text = rootPins.next ?? text

  if (text !== before) {
    const notes = []
    if (ws_.next) notes.push(`[workspace.package] ${ws_.current} != ${version}`)
    if (rootPins.hits.length) notes.push(`path-dep pin ${rootPins.hits.join(', ')} != ${version}`)
    apply(root, text, notes.join('; '))
  } else {
    console.log(`  ok    ${relative(ROOT, root)} (${version})`)
  }

  // Member manifests: path-dep pins only - their own version is inherited.
  for (const manifest of memberManifests(root)) {
    const pins = retargetPathDepPins(manifest, readFileSync(manifest, 'utf8'), version)
    if (pins.next) apply(manifest, pins.next, `path-dep pin ${pins.hits.join(', ')} != ${version}`)
  }
}

// Refresh any lockfile whose members no longer match. `--offline` keeps this
// off the network: re-resolving a local member's version needs no registry
// lookup, and a sync that silently updated unrelated dependencies would be a
// much bigger change than it looks. `--workspace` restricts it to our crates
// for the same reason.
for (const ws of RUST_WORKSPACES) {
  const stale = lockDrift(ws, version)
  if (stale.length === 0) {
    console.log(`  ok    ${ws}/Cargo.lock (${version})`)
    continue
  }
  if (CHECK) {
    drift.push(...stale)
    continue
  }
  console.log(`  lock  ${ws}/Cargo.lock`)
  try {
    execFileSync('cargo', ['update', '--workspace', '--offline'], {
      cwd: join(ROOT, ws),
      stdio: 'inherit',
    })
  } catch {
    fail(`cargo update failed in ${ws}; run 'cargo update --workspace --offline' there by hand and commit the lockfile`)
  }
  const still = lockDrift(ws, version)
  if (still.length > 0) {
    fail(`${ws}/Cargo.lock still stale after cargo update:\n  - ${still.join('\n  - ')}`)
  }
}

if (CHECK && drift.length > 0) {
  console.error(`\nsync-versions: version drift against packages/desktop/package.json (${version}):`)
  for (const d of drift) console.error(`  - ${d}`)
  console.error(`\nfix: npm run version:sync   (then commit the manifests and lockfiles)`)
  process.exit(1)
}
console.log(`sync-versions: ${CHECK ? 'all workspaces at' : 'synced to'} ${version}`)
