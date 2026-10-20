// Algoritmos clásicos sobre el estado de asignación de recursos (Silberschatz, cap. 8).

/** Vector de cantidades por tipo de recurso. */
export type Vec = Record<string, number>

export interface AllocationState {
  resources: string[]
  available: Vec
  /** Lo que cada proceso tiene asignado. */
  allocation: Map<number, Vec>
  /** Lo que cada proceso está pidiendo y no se le ha concedido. */
  request: Map<number, Vec>
}

const get = (v: Vec | undefined, r: string): number => v?.[r] ?? 0

function leq(a: Vec | undefined, b: Vec, resources: string[]): boolean {
  return resources.every((r) => get(a, r) <= get(b, r))
}

function isEmpty(v: Vec | undefined, resources: string[]): boolean {
  return resources.every((r) => get(v, r) === 0)
}

/**
 * Algoritmo de detección para recursos con varias instancias.
 * Simula que cada proceso cuya solicitud puede satisfacerse termina y devuelve lo
 * que tiene. Los que nunca pueden terminar están en interbloqueo.
 */
export function detectDeadlock(s: AllocationState): number[] {
  const work: Vec = { ...s.available }
  const pids = [...new Set([...s.allocation.keys(), ...s.request.keys()])]
  // Un proceso sin recursos asignados no puede formar parte de un interbloqueo.
  const finish = new Map(pids.map((p) => [p, isEmpty(s.allocation.get(p), s.resources)]))
  let progress = true
  while (progress) {
    progress = false
    for (const p of pids) {
      if (finish.get(p) || !leq(s.request.get(p), work, s.resources)) continue
      for (const r of s.resources) work[r] = get(work, r) + get(s.allocation.get(p), r)
      finish.set(p, true)
      progress = true
    }
  }
  return pids.filter((p) => !finish.get(p)).sort((a, b) => a - b)
}

/**
 * Algoritmo de seguridad del banquero: busca un orden en que todos los procesos
 * puedan obtener su necesidad máxima restante (Necesidad = Máximo − Asignado) y terminar.
 */
export function safetyCheck(
  resources: string[],
  available: Vec,
  allocation: Map<number, Vec>,
  need: Map<number, Vec>
): { safe: boolean; sequence: number[] } {
  const work: Vec = { ...available }
  const pending = new Set([...allocation.keys(), ...need.keys()])
  const sequence: number[] = []
  let progress = true
  while (progress && pending.size > 0) {
    progress = false
    for (const p of [...pending].sort((a, b) => a - b)) {
      if (!leq(need.get(p), work, resources)) continue
      for (const r of resources) work[r] = get(work, r) + get(allocation.get(p), r)
      sequence.push(p)
      pending.delete(p)
      progress = true
    }
  }
  return { safe: pending.size === 0, sequence }
}

/** Busca un ciclo en un grafo dirigido (para resaltarlo en el grafo de asignación). */
export function findCycle(edges: [string, string][]): string[] | null {
  const adj = new Map<string, string[]>()
  for (const [a, b] of edges) adj.set(a, [...(adj.get(a) ?? []), b])
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  const visit = (n: string): string[] | null => {
    state.set(n, 'visiting')
    stack.push(n)
    for (const m of adj.get(n) ?? []) {
      if (state.get(m) === 'visiting') return stack.slice(stack.indexOf(m))
      if (!state.has(m)) {
        const c = visit(m)
        if (c) return c
      }
    }
    stack.pop()
    state.set(n, 'done')
    return null
  }
  for (const n of adj.keys()) {
    if (!state.has(n)) {
      const c = visit(n)
      if (c) return c
    }
  }
  return null
}
