/** Iconos de archivo al estilo macOS según el tipo y la extensión. */
export function FileIcon({ name, dir, size = 18 }: { name: string; dir: boolean; size?: number }) {
  if (dir) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v1H2z" fill="#3a8ee6" />
        <path d="M2 9h20v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill="#5aa9f7" />
      </svg>
    )
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const color =
    ext === 'txt' || ext === 'c' || ext === 'md'
      ? '#e5e5ea'
      : ext === 'app'
        ? '#0a84ff'
        : ext === 'mp3'
          ? '#ff375f'
          : ext === 'png'
            ? '#30d158'
            : ext === 'ovl' || ext === 'so' || ext === 'img'
              ? '#8e8e93'
              : '#ffd60a'
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill={color} />
      <path d="M14 2v5h5" fill="rgba(0,0,0,0.18)" />
      {(ext === 'txt' || ext === 'c') && (
        <g stroke="rgba(0,0,0,0.35)" strokeWidth="1.2">
          <path d="M7 11h9M7 14h9M7 17h6" />
        </g>
      )}
    </svg>
  )
}
