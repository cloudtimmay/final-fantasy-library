import zlib from 'node:zlib'

// A small PNG in random colours, different every call. Sanity gives identical files the same
// asset id, so tests running in parallel that upload the same image share one asset — and one
// test's clean-up (fixtures.ts uploadedAssets) can delete it while another is still using it.
// Random pixels (not just random metadata) so a photo resized in the page (a JPEG of the same
// pixels) is unique too.
export function uniquePng(size = 8): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const rows: Buffer[] = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3) // filter byte 0, then RGB
    for (let i = 1; i < row.length; i++) row[i] = Math.floor(Math.random() * 256)
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// The same, as a file for page.setInputFiles().
export const uniquePngFile = (name = 'photo.png') => ({ name, mimeType: 'image/png', buffer: uniquePng() })
