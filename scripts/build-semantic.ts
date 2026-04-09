/* eslint-disable no-console */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from "fs"
import { join, basename } from "path"
import { pipeline } from "@xenova/transformers"

// ---------- Config ----------
const CONTENT_DIR = join(process.cwd(), "content")
const PUBLIC_DIR  = join(process.cwd(), "public")
const SEM_DIR     = join(PUBLIC_DIR, "static", "sem")
// good general model; stays on CPU for small corpora
const MODEL_ID    = "Xenova/all-MiniLM-L6-v2"

// chunking
const MAX_CHARS = 7000
const OVERLAP   = 900

const slugify = (s: string) => s.trim().toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-")

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

function chunkMarkdown(md: string) {
  const lines = md.split(/\r?\n/)
  const chunks: { text:string; anchor?:string; hPath:string[] }[] = []
  let cur: string[] = []
  let hPath: string[] = []
  let lastAnchor: string | undefined

  const push = () => {
    if (cur.length === 0) return
    let section = cur.join("\n").trim()
    if (section.length > MAX_CHARS) {
      let start = 0
      const add = () => {
        const slice = section.slice(start, Math.min(section.length, start + MAX_CHARS))
        chunks.push({ text: slice, anchor: lastAnchor, hPath: [...hPath] })
      }
      add()
      while (start + MAX_CHARS < section.length) {
        start = Math.max(0, start + MAX_CHARS - OVERLAP)
        add()
      }
    } else {
      chunks.push({ text: section, anchor: lastAnchor, hPath: [...hPath] })
    }
    cur = []
  }

  for (const line of lines) {
    const m = /^(#{2,3})\s+(.*)$/.exec(line)
    if (m) {
      push()
      const level = m[1].length
      const title = m[2].trim()
      const anc = slugify(title)
      if (level === 2) hPath = [title], lastAnchor = `#${anc}`
      else hPath = [hPath[0] || "", title], lastAnchor = `#${anc}`
      cur.push(line)
    } else {
      cur.push(line)
    }
  }
  push()
  return chunks
}

function meanL2(vectors: number[][]): Float32Array {
  const d = vectors[0].length
  const out = new Float32Array(d)
  for (const v of vectors) for (let i=0;i<d;i++) out[i] += v[i]
  const inv = 1 / vectors.length
  for (let i=0;i<d;i++) out[i] *= inv
  let norm = 0; for (let i=0;i<d;i++) norm += out[i]*out[i]
  norm = Math.sqrt(norm) || 1
  for (let i=0;i<d;i++) out[i] /= norm
  return out
}

async function main() {
  mkdirSync(SEM_DIR, { recursive: true })
  console.log("Loading embedding pipeline:", MODEL_ID)
  const embed = await pipeline("feature-extraction", MODEL_ID)

  const files = listMarkdownFiles(CONTENT_DIR)
  const centroids: { slug:string; title:string; vec:number[]; n:number }[] = []

  for (const f of files) {
    const raw = readFileSync(f, "utf8")
    if (!raw.trim()) continue

   const base = basename(f).replace(/\.(md|mdx)$/i, "")
  // Quartz turns spaces into hyphens for page slugs — mirror that here
   const slug = encodeURI(base.replace(/\s+/g, "-"))
    const m = /^#\s+(.+)$/.exec(raw) || /^title:\s*["']?(.+?)["']?\s*$/mi.exec(raw)
    const title = m ? m[1].trim() : base

    const chunks = chunkMarkdown(raw)
    if (chunks.length === 0) continue

    const allVecs: number[][] = []
    const BATCH = 8
    for (let i=0; i<chunks.length; i+=BATCH) {
      const texts = chunks.slice(i, i+BATCH).map(c => c.text)
      const outputs = await embed(texts, { pooling: "mean", normalize: true })
      // @ts-ignore transformers returns nested arrays
      const arr: number[][] = Array.isArray(outputs.data[0]) ? outputs.data : [outputs.data]
      allVecs.push(...arr)
      process.stdout.write(`\r${base}: ${Math.min(i+BATCH, chunks.length)}/${chunks.length}`)
    }
    process.stdout.write("\n")

    // shard
    const d = allVecs[0].length
    const bin = new Float32Array(allVecs.length * d)
    for (let i=0;i<allVecs.length;i++) bin.set(allVecs[i], i*d)
    writeFileSync(join(SEM_DIR, `${slug}.bin`), Buffer.from(bin.buffer))

    // idx
    const idx = chunks.map(c => ({
      anchor: c.anchor || "",
      hPath: c.hPath,
      preview: c.text.slice(0, 360).replace(/\s+/g," ").replace(/[#*_`>]+/g,"").trim()
    }))
    writeFileSync(join(SEM_DIR, `${slug}.idx.json`), JSON.stringify(idx))

    // centroid
    const centroid = meanL2(allVecs)
    centroids.push({ slug, title, vec: Array.from(centroid), n: allVecs.length })
  }

  writeFileSync(join(SEM_DIR, "doc-centroids.json"), JSON.stringify(centroids))
  console.log(`Wrote ${centroids.length} doc centroids and shards to ${SEM_DIR}`)
}

main().catch(e => { console.error(e); process.exit(1) })
