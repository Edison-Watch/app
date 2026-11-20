import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// build/installer.nsh defines customUnInstallCheck(CurrentUser), which makes
// electron-builder's handleUninstallResult skip its default handling. The
// sgHandleOldUninstallResult macro reproduces that default by hand (log on a
// launch error; on a non-zero exit code show uninstallFailed, SetErrorLevel 2,
// Quit) and only adds /SD IDOK. This test pins the upstream function, so an
// electron-builder upgrade that changes it fails here and the copy gets
// reviewed. Whitespace is normalised.
const PINNED = `Function handleUninstallResult
Var /GLOBAL rootKey_uninstallResult
Exch $rootKey_uninstallResult
\${if} "$rootKey_uninstallResult" == "SHELL_CONTEXT"
!ifmacrodef customUnInstallCheck
!insertmacro customUnInstallCheck
Return
!endif
\${elseif} "$rootKey_uninstallResult" == "HKEY_CURRENT_USER"
!ifmacrodef customUnInstallCheckCurrentUser
!insertmacro customUnInstallCheckCurrentUser
Return
!endif
\${endif}
IfErrors 0 +3
DetailPrint \`Uninstall was not successful. Not able to launch uninstaller!\`
Return
\${if} $R0 != 0
MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
DetailPrint \`Uninstall was not successful. Uninstaller error code: $R0.\`
SetErrorLevel 2
Quit
\${endif}
FunctionEnd`

const normalise = (s: string): string =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')

describe('electron-builder handleUninstallResult', () => {
  it('still matches the default that installer.nsh reproduces', () => {
    const file = require.resolve('app-builder-lib/templates/nsis/include/installUtil.nsh', {
      paths: [join(__dirname, '..', '..', '..')]
    })
    const text = readFileSync(file, 'utf8')
    const start = text.indexOf('Function handleUninstallResult')
    const end = text.indexOf('FunctionEnd', start) + 'FunctionEnd'.length
    expect(start).toBeGreaterThan(-1)
    expect(normalise(text.slice(start, end))).toBe(normalise(PINNED))
  })
})
