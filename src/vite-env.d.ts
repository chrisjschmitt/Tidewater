/** Vite raw-import of Markdown. */
declare module '*.md?raw' {
  const content: string
  export default content
}
