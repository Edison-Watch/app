!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Stop the background daemons BEFORE any files are written.
;
; Both daemons live in $INSTDIR\resources\bin and run under their own Scheduled
; Tasks, with lifetimes independent of the app. Windows locks a running
; executable's image, so if they are alive when the installer extracts, their
; .exe files are silently left at the OLD version - electron-builder's NSIS only
; knows how to stop the *app*. That is how an install ends up with a new UI
; talking to a months-old daemon, which then rejects newer IPC ops with
; "bad request: unknown variant ..." (see ipc.rs) while the app reports the
; daemon as unresponsive.
;
; customInit runs at the end of the installer's .onInit - before the install
; section extracts files and before the old version's uninstaller is invoked -
; and it runs on SILENT auto-update installs too, which is the path that hits
; this on every single update. (customInstall would be too late: it fires after
; extraction.)
;
; Asymmetric on purpose:
;   - detectord: fully remove the task. `service uninstall` (no --purge) keeps
;     enrollment/state/logs and knows its own SID-suffixed + legacy task names.
;     Safe because ensureDetectord() re-runs `service install` unconditionally on
;     every app start, so the task comes back on next launch.
;   - stdiod: kill the process only, do NOT remove its task. Its self-heal
;     (maybeRefreshStdiodInstall) only re-installs when the task is ALREADY
;     registered, so removing it here would strand the daemon until the user
;     re-enabled it by hand.
;
; Best-effort throughout: every call is ignored on failure, so a fresh install
; (nothing running, no $INSTDIR yet) just no-ops through it.
!macro customInit
  ; We are inside .onInit, so leave the registers as we found them.
  Push $0

  ; Remove detectord's scheduled task + stop it. Empty/absent $INSTDIR on a
  ; first install simply makes this fail harmlessly; the taskkill below is the
  ; backstop that actually guarantees the lock is released.
  nsExec::Exec '"$INSTDIR\resources\bin\sealgate-detectord.exe" service uninstall'
  Pop $0

  ; Backstop for both: releases the file lock even if the task removal above
  ; failed, the task name was unexpected, or the process outlived its task.
  nsExec::Exec 'taskkill /f /im sealgate-detectord.exe'
  Pop $0
  nsExec::Exec 'taskkill /f /im sealgate-stdiod.exe'
  Pop $0

  Pop $0

  ; Give Windows a moment to drop the image handles before extraction starts.
  ; NOTE: stdiod's task keeps <RestartOnFailure> (PT1M), so a very slow
  ; extraction could see it respawn and re-lock its own binary. That is the
  ; pre-existing behaviour, not a regression - detectord, the one that actually
  ; broke, is fully stopped above.
  Sleep 1500
!macroend

; SealGate uninstall hook. Two independent opt-in prompts (default No = keep).
; No-op on silent runs so auto-update keeps everything. Runs before the app files
; are removed, so the daemon binary is still present for `uninstall --purge`.
!macro customUnInstall
  IfSilent sg_skip

  ; Transient startup log - always removed on a real uninstall.
  Delete "$TEMP\sg-startup.log"

  ; Stop + remove the stdiod daemon (scheduled task + its credentials/logs).
  ; `uninstall --purge` handles the SID-named task (and the legacy name).
  MessageBox MB_YESNO|MB_ICONQUESTION "Stop and remove the SealGate stdiod daemon (background tunnel + its saved credentials)?" /SD IDNO IDNO sg_skipDaemon
    nsExec::ExecToLog '"$INSTDIR\resources\bin\sealgate-stdiod.exe" uninstall --purge'
    RMDir /r "$PROFILE\.config\sealgate-stdiod"
    RMDir /r "$PROFILE\.local\state\sealgate-stdiod"
  sg_skipDaemon:

  ; Stop + remove the detector daemon (scheduled task + its enrollment,
  ; seen-store, quarantine records, logs). `service uninstall --purge` handles
  ; the SID-named task (and the legacy name) and wipes its data dir.
  MessageBox MB_YESNO|MB_ICONQUESTION "Stop and remove the SealGate detector daemon (background MCP monitor + its quarantine records)?" /SD IDNO IDNO sg_skipDetectord
    nsExec::ExecToLog '"$INSTDIR\resources\bin\sealgate-detectord.exe" service uninstall --purge'
    RMDir /r "$APPDATA\sealgate-detectord"
  sg_skipDetectord:

  ; Remove all app data (userData under both name variants + the per-user dir).
  MessageBox MB_YESNO|MB_ICONQUESTION "Remove all SealGate data (settings and logs)?" /SD IDNO IDNO sg_skipData
    RMDir /r "$APPDATA\sealgate-client-2"
    RMDir /r "$LOCALAPPDATA\sealgate-client-2"
    RMDir /r "$APPDATA\SealGate"
    RMDir /r "$LOCALAPPDATA\SealGate"
    RMDir /r "$PROFILE\.sealgate"
  sg_skipData:

  sg_skip:
!macroend
