import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

// binary.ts imports `app` at module scope; the candidate math itself never
// touches it.
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))

import { devDetectordCandidates } from '../detectord/binary'

// Where electron-vite emits the main bundle, i.e. the __dirname the real caller
// passes in.
const OUT_MAIN = '/repo/packages/desktop/out/main'

describe('devDetectordCandidates', () => {
  it('looks in the monorepo crates/ location first', () => {
    // The daemon moved to crates/detectord; this list pointed at the old
    // packages/detectord for long enough that every dev build showed
    // "Degraded: the agent and MCP detection daemon is missing".
    expect(devDetectordCandidates(OUT_MAIN, false)[0]).toBe(
      '/repo/crates/detectord/target/release/mcp_detector_daemon'
    )
  })

  it('includes the path scripts/build-detectord.sh stages to', () => {
    expect(devDetectordCandidates(OUT_MAIN, false)).toContain(
      '/repo/packages/desktop/bin/edison-detectord'
    )
  })

  it('keeps the pre-monorepo sibling checkout as a fallback', () => {
    expect(devDetectordCandidates(OUT_MAIN, false)).toContain(
      '/repo/packages/detectord/target/release/mcp_detector_daemon'
    )
  })

  it('uses cargo\'s binary name under target/ and the shipped name under bin/', () => {
    const [cargo, staged] = devDetectordCandidates(OUT_MAIN, false)
    expect(path.basename(cargo!)).toBe('mcp_detector_daemon')
    expect(path.basename(staged!)).toBe('edison-detectord')
  })

  it('appends .exe on Windows', () => {
    for (const candidate of devDetectordCandidates(OUT_MAIN, true)) {
      expect(candidate.endsWith('.exe')).toBe(true)
    }
  })

  it('never resolves outside the repo root', () => {
    for (const candidate of devDetectordCandidates(OUT_MAIN, false)) {
      expect(candidate.startsWith('/repo/')).toBe(true)
    }
  })

  // Binds "where cargo writes the binary" to "where the app looks for it"
  // through a real filesystem, which is the check the shipped bug failed.
  it('resolves a cargo-built binary laid out on disk', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'detectord-paths-'))
    const outMain = path.join(root, 'packages', 'desktop', 'out', 'main')
    const cargoOut = path.join(root, 'crates', 'detectord', 'target', 'release')
    mkdirSync(outMain, { recursive: true })
    mkdirSync(cargoOut, { recursive: true })
    const binary = path.join(cargoOut, 'mcp_detector_daemon')
    writeFileSync(binary, '')

    expect(devDetectordCandidates(outMain, false).find(existsSync)).toBe(binary)
  })
})
