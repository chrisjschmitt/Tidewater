import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import {
  folderNameFromPath,
  offerFromFiles,
  type ExportFingerprint,
  type NewerExport,
} from '../../lib/etm/watchFolder'

export interface WatchFolderState {
  folderName?: string
  csvCount?: number
  newestName?: string
  notice?: string
  offer: NewerExport | null
  inputRef: RefObject<HTMLInputElement | null>
  openPicker: () => void
  onInputChange: (event: ChangeEvent<HTMLInputElement>) => void
  forgetFolder: () => Promise<void>
  dismissOffer: () => void
}

/**
 * Choose a folder via the browser’s directory file input (the Mac Open
 * dialog). Files are listed immediately. The folder is not watched in the
 * background — after the next unlock, Check asks for the same folder again.
 */
export function useWatchFolder(
  lastExport: ExportFingerprint | undefined,
  lastImportedName: string | undefined,
  savedName: string | undefined,
  onRememberName: (name: string | undefined) => Promise<void>,
): WatchFolderState {
  const inputRef = useRef<HTMLInputElement>(null)
  const [folderName, setFolderName] = useState(savedName)
  const [csvCount, setCsvCount] = useState<number | undefined>()
  const [newestName, setNewestName] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const [offer, setOffer] = useState<NewerExport | null>(null)

  useEffect(() => {
    if (savedName && !folderName) setFolderName(savedName)
  }, [savedName, folderName])

  const openPicker = useCallback(() => {
    setNotice(undefined)
    inputRef.current?.click()
  }, [])

  const onInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = [...(event.target.files ?? [])]
      event.target.value = ''
      if (files.length === 0) {
        setNotice('No folder was chosen.')
        return
      }
      const name = folderNameFromPath(files[0]?.webkitRelativePath ?? '', files[0]?.name)
      setFolderName(name)
      const scanned = offerFromFiles(files, lastExport, lastImportedName)
      setCsvCount(scanned.csvCount)
      setNewestName(scanned.newest?.name)
      setOffer(scanned.offer ?? null)
      void onRememberName(name).catch(() => {
        setNotice('The folder is in use this session, but it could not be remembered.')
      })
    },
    [lastExport, lastImportedName, onRememberName],
  )

  const forgetFolder = useCallback(async () => {
    setFolderName(undefined)
    setCsvCount(undefined)
    setNewestName(undefined)
    setNotice(undefined)
    setOffer(null)
    await onRememberName(undefined)
  }, [onRememberName])

  const dismissOffer = useCallback(() => {
    setOffer(null)
  }, [])

  return {
    folderName,
    csvCount,
    newestName,
    notice,
    offer,
    inputRef,
    openPicker,
    onInputChange,
    forgetFolder,
    dismissOffer,
  }
}
