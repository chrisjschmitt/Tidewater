/** Vite raw-import of Markdown. */
declare module '*.md?raw' {
  const content: string
  export default content
}

/**
 * Compile-time constant from vite.config.ts. False in `--mode public` builds,
 * which ship without the expense tracking module — no entry point, and the
 * ETM chunk is never emitted.
 */
declare const __ETM_AVAILABLE__: boolean
