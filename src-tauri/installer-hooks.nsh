; "Open with Codepad" in Explorer's right-click menu is optional. Codepad itself adds and removes the
; entries (see src/shell.rs); the installer just asks once, on a fresh interactive install.
; Updates and silent installs leave whatever the user already chose.

!macro NSIS_HOOK_POSTINSTALL
  ${If} $UpdateMode <> 1
  ${AndIfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION "Add $\"Open with Codepad$\" to the right-click menu of text and code files?$\r$\n$\r$\nYou can change this later from the command palette." IDNO skip_menu
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --register-context-menu'
    skip_menu:
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister-context-menu'
  ${EndIf}
!macroend

; Uninstalling forgets the install folder, so the next install suggests the default again.
; (Updates keep it, so a custom folder survives them. Tauri's own cleanup only runs when
; "delete app data" is ticked.)
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue SHCTX "${MANUPRODUCTKEY}" ""
    DeleteRegKey /ifempty SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"
  ${EndIf}
!macroend
