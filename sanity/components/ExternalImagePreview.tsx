export function ExternalImagePreview(props: any) {
  const { title, subtitle, externalImageUrl } = props

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {externalImageUrl ? (
        <img
          src={externalImageUrl}
          alt={title || 'Album cover'}
          style={{
            width: 36,
            height: 36,
            objectFit: 'cover',
            borderRadius: 4,
          }}
        />
      ) : (
        <div
          style={{
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          🎵
        </div>
      )}

      <div>
        <div>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{subtitle}</div>
      </div>
    </div>
  )
}