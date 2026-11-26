// The desktop app trusts state.json's keep_awake state only while the daemon
// that wrote it runs. On Windows the PID must belong to sealgate-stdiod.exe,
// because Windows reuses PIDs.

import { describe, expect, it } from 'vitest'

import { processExists, tasklistShowsStdiod } from '../stdiod/daemonProcess'

describe('daemon process check', () => {
  it('finds this test process and not a PID that is not in use', () => {
    expect(processExists(process.pid)).toBe(true)
    expect(processExists(2 ** 31 - 2)).toBe(false)
  })

  it('reads tasklist CSV output', () => {
    expect(
      tasklistShowsStdiod('"sealgate-stdiod.exe","1688","Console","1","12,340 K"\r\n')
    ).toBe(true)
    // PID reused by another program.
    expect(tasklistShowsStdiod('"notepad.exe","1688","Console","1","9,120 K"\r\n')).toBe(false)
    // No match: a translated notice, not CSV.
    expect(
      tasklistShowsStdiod('INFORMATION: Es werden keine Aufgaben mit den angegebenen Kriterien ausgef\u00fchrt.\r\n')
    ).toBe(false)
  })
})
