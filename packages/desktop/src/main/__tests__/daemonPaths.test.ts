import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DETECTORD,
  STDIOD,
  devDaemonCandidates,
  shippedExeName
} from '../runtime/daemonPaths'

// Where electron-vite emits the main bundle, i.e. the __dirname the real
// callers pass in.
const OUT_MAIN = '/repo/packages/desktop/out/main'

const DAEMONS = [STDIOD, DETECTORD]

describe.each(DAEMONS)('devDaemonCandidates($crate)', (spec) => {
  it('looks in the monorepo crates/ location first', () => {
    // detectord kept pointing at packages/detectord for long enough after the
    // move to crates/ that every dev build reported "Degraded: the agent and
    // MCP detection daemon is missing".
    expect(devDaemonCandidates(spec, OUT_MAIN, false)[0]).toBe(
      `/repo/crates/${spec.crate}/target/release/${spec.cargoBin}`
    )
  })

  it('includes the path scripts/build-<daemon>.sh stages to', () => {
    expect(devDaemonCandidates(spec, OUT_MAIN, false)).toContain(
      `/repo/packages/desktop/bin/${spec.shippedName}`
    )
  })

  it('keeps the pre-monorepo sibling checkout as a fallback', () => {
    expect(devDaemonCandidates(spec, OUT_MAIN, false)).toContain(
      `/repo/packages/${spec.crate}/target/release/${spec.cargoBin}`
    )
  })

  it("uses cargo's binary name under target/ and the shipped name under bin/", () => {
    const [cargo, staged] = devDaemonCandidates(spec, OUT_MAIN, false)
    expect(path.basename(cargo!)).toBe(spec.cargoBin)
    expect(path.basename(staged!)).toBe(spec.shippedName)
  })

  it('appends .exe on Windows, including the packaged name', () => {
    for (const candidate of devDaemonCandidates(spec, OUT_MAIN, true)) {
      expect(candidate.endsWith('.exe')).toBe(true)
    }
    expect(shippedExeName(spec, true)).toBe(`${spec.shippedName}.exe`)
    expect(shippedExeName(spec, false)).toBe(spec.shippedName)
  })

  it('never resolves outside the repo root', () => {
    for (const candidate of devDaemonCandidates(spec, OUT_MAIN, false)) {
      expect(candidate.startsWith('/repo/')).toBe(true)
    }
  })

  // Binds "where cargo writes the binary" to "where the app looks for it"
  // through a real filesystem, which is the check the shipped bug failed.
  it('resolves a cargo-built binary laid out on disk', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'daemon-paths-'))
    const outMain = path.join(root, 'packages', 'desktop', 'out', 'main')
    const cargoOut = path.join(root, 'crates', spec.crate, 'target', 'release')
    mkdirSync(outMain, { recursive: true })
    mkdirSync(cargoOut, { recursive: true })
    const binary = path.join(cargoOut, spec.cargoBin)
    writeFileSync(binary, '')

    expect(devDaemonCandidates(spec, outMain, false).find(existsSync)).toBe(binary)
  })
})

describe('daemon specs', () => {
  it('gives each daemon a distinct crate directory', () => {
    expect(new Set(DAEMONS.map((d) => d.crate)).size).toBe(DAEMONS.length)
  })
})
