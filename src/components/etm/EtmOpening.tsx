interface Props {
  onClose: () => void
  /** Shown while the expenses screens are downloading after the key is accepted. */
  afterUnlock?: boolean
}

/**
 * Set up used to paint a full-screen sand sheet with tiny copy, which read as a
 * blank page while the expenses (and now forecast) code downloaded. Keep the
 * dashboard visible behind a dialog so it is obvious something is happening.
 */
export default function EtmOpening({ onClose, afterUnlock }: Props) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/25 backdrop-blur-[3px]" />
      <div
        role="dialog"
        aria-labelledby="etm-opening-title"
        aria-busy="true"
        className="relative w-full max-w-md rounded-2xl bg-sand-50 p-5 shadow-lg ring-1 ring-ink-900/10"
      >
        <h2 id="etm-opening-title" className="font-serif text-xl text-ink-900">
          {afterUnlock ? 'Opening expenses' : 'Enable expense tracking'}
        </h2>
        <p className="mt-2 text-sm text-ink-700">
          {afterUnlock
            ? 'Decrypting this device. Stay on this page.'
            : 'Opening the setup form. This can take a moment the first time.'}
        </p>
        <button type="button" className="btn-ghost mt-5" onClick={onClose}>
          Not now
        </button>
      </div>
    </div>
  )
}
