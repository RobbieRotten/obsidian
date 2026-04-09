// quartz/components/semantic/cosine.ts
export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i]
    s += x * y
    na += x * x
    nb += y * y
  }
  const d = Math.sqrt(na) * Math.sqrt(nb) || 1
  return s / d
}
