; "Open with Codepad" in the Explorer right-click menu for every file.
; Everything goes under one key per context, written to SHCTX (HKCU for a per-user install),
; and is removed again by the uninstaller.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\*\shell\Codepad" "" "Open with Codepad"
  WriteRegStr SHCTX "Software\Classes\*\shell\Codepad" "Icon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\*\shell\Codepad\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\*\shell\Codepad"
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
