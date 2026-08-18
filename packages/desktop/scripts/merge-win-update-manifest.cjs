#!/usr/bin/env node
/**
 * Merge the two Windows electron-updater manifests (x64 + arm64) into ONE
 * manifest that lists BOTH installers.
 *
 * WHY: electron-builder never arch-suffixes the Windows update manifest
 * (getArchPrefixForUpdateFile is Linux-only), so the two single-arch Windows
 * release legs both want to publish `latest.yml`. They dodge the collision by
 * building on separate channels (`latest-x64` / `latest-arm64` on stable,
 * `beta` / `beta-arm64` on demo), which produces two manifests - but at runtime
 * electron-updater does NOT reliably ask for the arch-suffixed one:
 *   - updateManager.ts pins autoUpdater.channel to the build's environment
 *     ('latest' / 'beta'), and GitHubProvider prefers updater.channel over the
 *     channel baked into app-update.yml.
 *   - even without that, on the beta channel GitHubProvider *derives* the
 *     channel from the resolved tag's prerelease id (`0.6.5-beta.7` -> `beta`),
 *     so `beta-arm64.yml` is unreachable by design.
 * So the shared manifest has to describe both arches. That is safe because
 * electron-updater picks the download by matching process.arch against the file
 * URL (Provider.findFile), and nsis.artifactName carries the arch:
 * EdisonWatch-<version>-x64-setup.exe / -arm64-setup.exe.
 *
 * The per-arch manifests are left on the release untouched - they are correct
 * for their own arch, so whichever one an installed build ends up polling hands
 * it the right installer.
 *
 * Usage:
 *   node merge-win-update-manifest.cjs <x64.yml> <arm64.yml> <out.yml> <version>
 *
 * Idempotent: re-merging an already-merged manifest is a no-op (files are
 * deduped by url), so a re-run of the CI job cannot pile up duplicate entries.
 */

const { readFileSync, writeFileSync, mkdirSync } = require('fs')
const { dirname } = require('path')
const yaml = require('js-yaml')

const ARCHES = ['x64', 'arm64']

function fail(msg) {
  console.error(`::error::${msg}`)
  process.exit(1)
}

const [x64Path, arm64Path, outPath, version] = process.argv.slice(2)
if (!x64Path || !arm64Path || !outPath || !version) {
  fail('usage: merge-win-update-manifest.cjs <x64.yml> <arm64.yml> <out.yml> <version>')
}

function loadManifest(path) {
  let doc
  try {
    doc = yaml.load(readFileSync(path, 'utf-8'))
  } catch (err) {
    fail(`cannot parse ${path}: ${err.message}`)
  }
  if (!doc || typeof doc !== 'object') fail(`${path} is not a manifest object`)
  if (doc.version !== version) fail(`${path} version '${doc.version}' != release version '${version}'`)
  if (!Array.isArray(doc.files) || doc.files.length === 0) fail(`${path} has no files[]`)
  return doc
}

const x64 = loadManifest(x64Path)
const arm64 = loadManifest(arm64Path)

// x64 first: it also stays the legacy top-level `path`/`sha512`, and it is what
// electron-updater falls back to if it ever fails to match process.arch.
const files = []
for (const file of [...x64.files, ...arm64.files]) {
  if (typeof file.url !== 'string' || !file.url) fail(`file entry without url: ${JSON.stringify(file)}`)
  if (!file.sha512) fail(`file entry without sha512: ${file.url}`)
  if (!file.url.toLowerCase().endsWith('.exe')) fail(`unexpected non-.exe file entry: ${file.url}`)
  if (!file.url.includes(version)) fail(`file entry '${file.url}' does not carry version '${version}'`)
  if (!files.some((seen) => seen.url === file.url)) files.push(file)
}

// electron-updater matches process.arch against the url, so exactly one entry
// per arch has to be present - and no entry may match two arches. Bucket each
// file by its (single) arch rather than counting matches per arch: a url
// carrying BOTH tokens would otherwise satisfy the per-arch count twice and
// publish a manifest where one installer is served to both arches while the
// other is unreachable.
const byArch = new Map(ARCHES.map((arch) => [arch, []]))
for (const file of files) {
  const matched = ARCHES.filter((arch) => file.url.includes(arch))
  if (matched.length !== 1) {
    fail(`file entry '${file.url}' matches ${matched.length} arches (${matched.join(', ') || 'none'}), ` +
      `expected exactly 1 of: ${ARCHES.join(', ')}`)
  }
  byArch.get(matched[0]).push(file)
}
for (const arch of ARCHES) {
  const matches = byArch.get(arch)
  if (matches.length !== 1) {
    fail(`expected exactly 1 ${arch} installer in the merged manifest, found ${matches.length}: ` +
      files.map((f) => f.url).join(', '))
  }
}
if (files.length !== ARCHES.length) {
  fail(`merged manifest has ${files.length} files, expected ${ARCHES.length}: ` +
    files.map((f) => f.url).join(', '))
}

const merged = { ...x64, files }
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, yaml.dump(merged, { lineWidth: -1 }), 'utf-8')
console.log(`merged ${files.length} installers into ${outPath}: ${files.map((f) => f.url).join(', ')}`)
