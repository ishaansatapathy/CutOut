/**
 * Zero-dependency in-browser ZIP file creator.
 * Encodes files using store method (uncompressed) with standard CRC32.
 */

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipFile = { name: string; data: Uint8Array };

export function createZip(files: ZipFile[]): Blob {
  const fileRecords: {
    header: Uint8Array;
    nameBytes: Uint8Array;
    data: Uint8Array;
    offset: number;
    crc: number;
  }[] = [];

  let currentOffset = 0;

  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    // Local file header (30 bytes)
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // Local header signature
    view.setUint16(4, 20, true); // Version needed (2.0)
    view.setUint16(6, 0, true); // General flags
    view.setUint16(8, 0, true); // Compression = store (0)
    view.setUint16(10, 0, true); // Last mod time
    view.setUint16(12, 0, true); // Last mod date
    view.setUint32(14, crc, true); // CRC32
    view.setUint32(18, size, true); // Compressed size
    view.setUint32(22, size, true); // Uncompressed size
    view.setUint16(26, nameBytes.length, true); // Filename length
    view.setUint16(28, 0, true); // Extra field length

    fileRecords.push({ header, nameBytes, data: f.data, offset: currentOffset, crc });
    currentOffset += header.length + nameBytes.length + f.data.length;
  }

  // Central directory
  const cdOffset = currentOffset;
  const cdChunks: Uint8Array[] = [];

  for (const r of fileRecords) {
    // Central directory header (46 bytes)
    const cdHeader = new Uint8Array(46);
    const view = new DataView(cdHeader.buffer);
    view.setUint32(0, 0x02014b50, true); // Central header signature
    view.setUint16(4, 20, true); // Version made by
    view.setUint16(6, 20, true); // Version needed
    view.setUint16(8, 0, true); // Flags
    view.setUint16(10, 0, true); // Compression = store (0)
    view.setUint16(12, 0, true); // Mod time
    view.setUint16(14, 0, true); // Mod date
    view.setUint32(16, r.crc, true); // CRC32
    view.setUint32(20, r.data.length, true); // Compressed size
    view.setUint32(24, r.data.length, true); // Uncompressed size
    view.setUint16(28, r.nameBytes.length, true); // Filename length
    view.setUint16(30, 0, true); // Extra field length
    view.setUint16(32, 0, true); // Comment length
    view.setUint16(34, 0, true); // Disk number
    view.setUint16(36, 0, true); // Internal attributes
    view.setUint32(38, 0, true); // External attributes
    view.setUint32(42, r.offset, true); // Relative offset of local header

    cdChunks.push(cdHeader, r.nameBytes);
    currentOffset += cdHeader.length + r.nameBytes.length;
  }

  const cdSize = currentOffset - cdOffset;

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
  eocdView.setUint16(4, 0, true); // Disk number
  eocdView.setUint16(6, 0, true); // Start disk
  eocdView.setUint16(8, files.length, true); // Total entries on this disk
  eocdView.setUint16(10, files.length, true); // Total entries
  eocdView.setUint32(12, cdSize, true); // Central directory size
  eocdView.setUint32(16, cdOffset, true); // Central directory offset
  eocdView.setUint16(20, 0, true); // Comment length

  const totalLength = currentOffset + 22;
  const out = new Uint8Array(totalLength);
  let pos = 0;
  for (const r of fileRecords) {
    out.set(r.header, pos);
    pos += r.header.length;
    out.set(r.nameBytes, pos);
    pos += r.nameBytes.length;
    out.set(r.data, pos);
    pos += r.data.length;
  }
  for (const c of cdChunks) {
    out.set(c, pos);
    pos += c.length;
  }
  out.set(eocd, pos);

  return new Blob([out.buffer as ArrayBuffer], { type: "application/zip" });
}
