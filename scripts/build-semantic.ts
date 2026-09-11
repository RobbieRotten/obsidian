/* eslint-disable no-console */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs"
import { basename, join, relative, sep } from "path"
import { pipeline } from "@xenova/transformers"

const CONTENT_DIR = join(process.cwd(), "content")
// Generate into Quartz's static source tree so a normal Quartz build copies the
// semantic assets to /static/sem in the published site.
const SEM_DIR = join(process.cwd(), "quartz", "static", "sem")
const MODEL_ID = "Xenova/all-MiniLM-L6-v2"
const DIM = 384

const MAX_CHARS = 7000
const OVERLAP = 900

const slugify = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")

function listMarkdownFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...listMarkdownFiles(full))
    else if (/\.(md|mdx)$/i.test(entry)) out.push(full)
  }
  return out
}

function quartzSlug(file: string): string {
  const rel = relative(CONTENT_DIR, file)
    .split(sep)
    .join("/")
    .replace(/\.(md|mdx)$/i, "")
    .replace(/\s+/g, "-")

  return encodeURI(rel)
}

function chunkMarkdown(md: string) {
  const lines = md.split(/\r?\n/)
  const chunks: { text: string; anchor?: string; hPath: string[] }[] = []
  let cur: string[] = []
  let hPath: string[] = []
  let lastAnchor: string | undefined

  const push = () => {
    if (cur.length === 0) return
    const section = cur.join("\n").trim()
    if (!section) {
      cur = []
      return
    }

    if (section.length > MAX_CHARS) {
      let start = 0
      while (start < section.length) {
        const slice = section.slice(start, Math.min(section.length, start + MAX_CHARS))
        chunks.push({ text: slice, anchor: lastAnchor, hPath: [...hPath] })
        if (start + MAX_CHARS >= section.length) break
        start = Math.max(0, start + MAX_CHARS - OVERLAP)
      }
    } else {
      chunks.push({ text: section, anchor: lastAnchor, hPath: [...hPath] })
    }
    cur = []
  }

  for (const line of lines) {
    const match = /^(#{2,3})\s+(.*)$/.exec(line)
    if (!match) {
      cur.push(line)
      continue
    }

    push()
    const level = match[1].length
    const title = match[2].trim()
    lastAnchor = `#${slugify(title)}`
    hPath = level === 2 ? [title] : [hPath[0] || "", title]
    cur.push(line)
  }

  push()
  return chunks
}

function tensorRows(output: unknown, expectedRows: number): number[][] {
  const tensor = output as { data?: ArrayLike<number>; dims?: number[] }
  if (!tensor.data) throw new Error("Embedding pipeline returned no tensor data")

  const flat = Array.from(tensor.data)
  const dims = tensor.dims ?? []
  const width = dims.length > 0 ? dims[dims.length - 1] : DIM
  if (width !== DIM) throw new Error(`Expected ${DIM}-dimensional embeddings, received ${width}`)
  if (flat.length !== expectedRows * DIM) {
    throw new Error(
      `Expected ${expectedRows * DIM} embedding values, received ${flat.length}`,
    )
  }

  const rows: number[][] = []
  for (let i = 0; i < expectedRows; i++) {
    rows.push(flat.slice(i * DIM, (i + 1) * DIM))
  }
  return rows
}

function meanL2(vectors: number[][]): Float32Array {
  const out = new Float32Array(DIM)
  for (const vector of vectors) {
    for (let i = 0; i < DIM; i++) out[i] += vector[i]
  }

  const inv = 1 / vectors.length
  for (let i = 0; i < DIM; i++) out[i] *= inv

  let norm = 0
  for (let i = 0; i < DIM; i++) norm += out[i] * out[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < DIM; i++) out[i] /= norm
  return out
}

async function main() {
  rmSync(SEM_DIR, { recursive: true, force: true })
  mkdirSync(SEM_DIR, { recursive: true })

  console.log("Loading embedding pipeline:", MODEL_ID)
  const embed = await pipeline("feature-extraction", MODEL_ID, { quantized: true })

  const files = listMarkdownFiles(CONTENT_DIR)
  const centroids: { slug: string; title: string; vec: number[]; n: number }[] = []

  for (const file of files) {
    const raw = readFileSync(file, "utf8")
    if (!raw.trim()) continue

    const base = basename(file).replace(/\.(md|mdx)$/i, "")
    const slug = quartzSlug(file)
    const titleMatch = /^#\s+(.+)$/m.exec(raw) || /^title:\s*["']?(.+?)["']?\s*$/im.exec(raw)
    const title = titleMatch ? titleMatch[1].trim() : base
    const chunks = chunkMarkdown(raw)
    if (chunks.length === 0) continue

    const allVecs: number[][] = []
    const BATCH = 8
    for (let i = 0; i < chunks.length; i += BATCH) {
      const texts = chunks.slice(i, i + BATCH).map((chunk) => chunk.text)
      const output = await embed(texts, { pooling: "mean", normalize: true })
      allVecs.push(...tensorRows(output, texts.length))
      process.stdout.write(`\r${slug}: ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`)
    }
    process.stdout.write("\n")

    const bin = new Float32Array(allVecs.length * DIM)
    for (let i = 0; i < allVecs.length; i++) bin.set(allVecs[i], i * DIM)
    writeFileSync(join(SEM_DIR, `${slug.replaceAll("/", "__")}.bin`), Buffer.from(bin.buffer))

    const idx = chunks.map((chunk) => ({
      anchor: chunk.anchor || "",
      hPath: chunk.hPath,
      preview: chunk.text
        .slice(0, 360)
        .replace(/\s+/g, " ")
        .replace(/[#*_`>]+/g, "")
        .trim(),
    }))
    writeFileSync(join(SEM_DIR, `${slug.replaceAll("/", "__")}.idx.json`), JSON.stringify(idx))

    const centroid = meanL2(allVecs)
    centroids.push({ slug, title, vec: Array.from(centroid), n: allVecs.length })
  }

  writeFileSync(join(SEM_DIR, "doc-centroids.json"), JSON.stringify(centroids))
  console.log(`Wrote ${centroids.length} semantic documents to ${SEM_DIR}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
