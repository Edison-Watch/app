import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The tray dialogs render from inline template-string JavaScript, so neither
 * the compiler nor a render test sees these branches - the strings are only
 * parsed inside a BrowserWindow at runtime. That is exactly how `alreadyPending`
 * came to be routed to the rename box: `showAlreadyPendingBadge` was defined in
 * both dialogs, named in the CREDENTIAL_REVIEW_JS contract, and called nowhere.
 *
 * The two 409s the backend returns are not the same conflict:
 *
 *   "a server with that name is already registered" - keyed on the NAME, so a
 *      rename resolves it and the user gets a distinct server.
 *   "you already have a pending request for this server" - keyed on the SERVER,
 *      so a rename does not resolve anything. It files a second request for the
 *      same server and the admin sees the queue twice.
 *
 * Asserting on source text is the cheapest guard that survives the template
 * string, so it is what this does.
 */

const DIALOGS = ['mcpServerActionDialog.ts', 'mcpServerRegistrationDialog.ts']

function read(file: string): string {
  return readFileSync(join(__dirname, '..', 'dialogs', file), 'utf8')
}

/** The statement(s) guarded by each `result.<flag>` test, up to the `return`. */
function branchBodies(src: string, flag: string): string[] {
  const bodies: string[] = []
  const re = new RegExp(`result\\.${flag}\\)\\s*\\{([\\s\\S]{0,240}?)return`, 'g')
  for (const m of src.matchAll(re)) if (m[1]) bodies.push(m[1])
  return bodies
}

describe.each(DIALOGS)('%s conflict routing', (file) => {
  const src = read(file)

  it('sends a pending request to the waiting badge, never to the rename box', () => {
    const bodies = branchBodies(src, 'alreadyPending')
    expect(bodies.length, 'no alreadyPending branch found - did the flag get renamed?').toBeGreaterThan(0)

    for (const body of bodies) {
      expect(body, `pending branch offers a rename:\n${body}`).not.toMatch(/showConflictRename/)
      expect(body, `pending branch has no waiting badge:\n${body}`).toMatch(/showAlreadyPendingBadge/)
    }
  })

  it('still offers a rename for a name that is already taken', () => {
    const bodies = branchBodies(src, 'alreadyExists')
    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) {
      expect(body, `name conflict lost its rename box:\n${body}`).toMatch(/showConflictRename/)
    }
  })

  it('defines every helper it calls, since each dialog is its own script context', () => {
    for (const helper of ['showAlreadyPendingBadge', 'showConflictRename']) {
      if (!src.includes(`${helper}(`)) continue
      expect(src, `${helper} is called but not defined - ReferenceError at runtime`).toMatch(
        new RegExp(`function\\s+${helper}\\s*\\(`)
      )
    }
  })
})
