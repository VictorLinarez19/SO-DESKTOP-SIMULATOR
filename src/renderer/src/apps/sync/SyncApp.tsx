import { AnimatePresence, motion } from 'framer-motion'
import type {
  BufferInfo,
  MutexInfo,
  ProcessInfo,
  SemaphoreInfo,
  SyncGroupInfo,
  VariableInfo
} from '@shared/kernelTypes'
import type { KernelSnapshot } from '@shared/ipc'
import { useKernel } from '../../store/kernel'
import { useUi } from '../../store/ui'
import { PidBadge, StateChip } from '../../components/Chips'
import { ProgramListing } from '../../components/ProgramListing'
import { pidColor } from '../../lib/colors'

/** Procesos cuyo programa contiene la instrucción indicada (p. ej. "PUT buffer"). */
function usersOf(processes: ProcessInfo[], instruction: string): ProcessInfo[] {
  return processes.filter(
    (p) => p.state !== 'TERMINATED' && p.program.some((l) => l.text === instruction)
  )
}

/** Líneas entre LOCK m y UNLOCK m del programa (la sección crítica). */
function criticalRange(p: ProcessInfo, mutex: string): { from: number; to: number } | null {
  const from = p.program.findIndex((l) => l.text === `LOCK ${mutex}`)
  const to = p.program.findIndex((l) => l.text === `UNLOCK ${mutex}`)
  return from >= 0 && to > from ? { from, to } : null
}

/** ¿Está ejecutando su sección crítica? (pasó el LOCK y aún no ejecuta el UNLOCK). */
function insideCritical(p: ProcessInfo, mutex: string): boolean {
  const r = criticalRange(p, mutex)
  if (!r || p.state === 'TERMINATED') return false
  const waitingLock = p.waitingOn?.kind === 'sync' && p.waitingOn.object === mutex
  return p.pc > r.from && p.pc <= r.to && !waitingLock
}

export function SyncApp(): React.JSX.Element {
  const snapshot = useKernel((s) => s.snapshot)
  if (!snapshot) return <div className="empty">Conectando con el kernel…</div>
  const { sync } = snapshot
  return (
    <div className="sync-app">
      <div className="sync-scroll">
        {sync.groups.map((g) => {
          const buffers = sync.buffers.filter((b) => b.group === g.id)
          const vars = sync.variables.filter((v) => v.group === g.id)
          if (buffers.length > 0)
            return <ProducerConsumer key={g.id} group={g} snapshot={snapshot} />
          if (vars.length > 0) return <CriticalSection key={g.id} group={g} snapshot={snapshot} />
          return null
        })}
        <SyncLog snapshot={snapshot} />
      </div>
    </div>
  )
}

function GroupToggle({ group, label }: { group: SyncGroupInfo; label: string }): React.JSX.Element {
  const send = useKernel((s) => s.send)
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={group.enabled}
        onChange={(e) =>
          send({ type: 'setSyncEnabled', group: group.id, enabled: e.target.checked })
        }
      />
      <span className="switch-track" />
      <span>{label}</span>
    </label>
  )
}

// ───────────────────────── productor–consumidor ─────────────────────────

function ProducerConsumer({
  group,
  snapshot
}: {
  group: SyncGroupInfo
  snapshot: KernelSnapshot
}): React.JSX.Element {
  const { sync, processes } = snapshot
  const buffer = sync.buffers.find((b) => b.group === group.id)!
  const sems = sync.semaphores.filter((s) => s.group === group.id)
  const mutexes = sync.mutexes.filter((m) => m.group === group.id)
  const producers = usersOf(processes, `PUT ${buffer.name}`)
  const consumers = usersOf(processes, `GET ${buffer.name}`)

  return (
    <section className={`sync-card${group.enabled ? '' : ' unsafe'}`}>
      <header>
        <div>
          <h2>{group.name}</h2>
          <p className="muted small">
            El productor deposita bloques en un búfer de {buffer.capacity} casillas y el consumidor
            los retira. <code>vacios</code> cuenta las casillas libres, <code>llenos</code> las
            ocupadas y el mutex protege el acceso al búfer.
          </p>
        </div>
        <GroupToggle group={group} label="Sincronización" />
      </header>

      {!group.enabled && (
        <div className="unsafe-banner">
          Sincronización desactivada: WAIT, SIGNAL, LOCK y UNLOCK se ignoran. El productor puede
          escribir con el búfer lleno (se pierden datos) y el consumidor leer con el búfer vacío.
        </div>
      )}

      <div className="pc-flow">
        <ActorColumn title="Productor" procs={producers} />
        <BufferView buffer={buffer} />
        <ActorColumn title="Consumidor" procs={consumers} />
      </div>

      <div className="sync-objects">
        {sems.map((s) => (
          <SemaphoreView key={s.name} s={s} enabled={group.enabled} />
        ))}
        {mutexes.map((m) => (
          <MutexView key={m.name} m={m} enabled={group.enabled} />
        ))}
        <div className="sync-counters">
          <Counter label="Producidos" value={buffer.produced} />
          <Counter label="Consumidos" value={buffer.consumed} />
          <Counter label="Desbordamientos" value={buffer.overflows} bad />
          <Counter label="Lecturas vacías" value={buffer.underflows} bad />
        </div>
      </div>

      <div className="code-pair">
        {[...producers, ...consumers].map((p) => (
          <CodeCard key={p.pid} p={p} />
        ))}
      </div>
    </section>
  )
}

function BufferView({ buffer }: { buffer: BufferInfo }): React.JSX.Element {
  const slots = Array.from({ length: buffer.capacity }, (_, i) => buffer.items[i] ?? null)
  return (
    <div className="buffer-view">
      <div className="buffer-title">
        <code>{buffer.name}</code> · {buffer.items.length}/{buffer.capacity}
      </div>
      <div className="buffer-slots">
        {slots.map((_, i) => (
          <div key={i} className="buffer-slot" />
        ))}
        <div className="buffer-items">
          <AnimatePresence initial={false}>
            {buffer.items.map((item) => (
              <motion.div
                key={item.seq}
                layout
                className="buffer-item"
                style={{ background: pidColor(item.producer) }}
                initial={{ opacity: 0, x: -30, scale: 0.6 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 30, scale: 0.6 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                title={`Elemento #${item.seq} de PID ${item.producer} (t=${item.tick})`}
              >
                #{item.seq}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
      <div className="buffer-arrows muted small">PUT → entra · GET → sale (FIFO)</div>
    </div>
  )
}

function ActorColumn({ title, procs }: { title: string; procs: ProcessInfo[] }): React.JSX.Element {
  const selectPid = useUi((s) => s.selectPid)
  return (
    <div className="actor-col">
      <div className="section-title">{title}</div>
      {procs.map((p) => (
        <div key={p.pid} className="actor" onClick={() => selectPid(p.pid)}>
          <PidBadge pid={p.pid} />
          <div>
            <div className="actor-name">{p.name}</div>
            <StateChip state={p.state} />
            {p.waitingOn?.kind === 'sync' && (
              <div className="actor-wait">
                bloqueado en {p.waitingOn.op} <code>{p.waitingOn.object}</code>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function SemaphoreView({ s, enabled }: { s: SemaphoreInfo; enabled: boolean }): React.JSX.Element {
  return (
    <div className={`sync-obj${enabled ? '' : ' off'}`}>
      <div className="obj-kind">Semáforo</div>
      <div className="obj-name">
        <code>{s.name}</code>
      </div>
      <div className="obj-value">{s.value}</div>
      <div className="obj-queue">
        {s.queue.length === 0 ? (
          <span className="muted small">sin procesos en espera</span>
        ) : (
          <>
            <span className="muted small">en espera:</span>
            {s.queue.map((pid) => (
              <PidBadge key={pid} pid={pid} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function MutexView({ m, enabled }: { m: MutexInfo; enabled: boolean }): React.JSX.Element {
  return (
    <div className={`sync-obj${enabled ? '' : ' off'}`}>
      <div className="obj-kind">Mutex</div>
      <div className="obj-name">
        <code>{m.name}</code>
      </div>
      <div className="obj-value">{m.owner === null ? '🔓' : '🔒'}</div>
      <div className="obj-queue">
        {m.owner !== null && (
          <>
            <span className="muted small">dueño:</span>
            <PidBadge pid={m.owner} />
          </>
        )}
        {m.queue.length > 0 && (
          <>
            <span className="muted small">en espera:</span>
            {m.queue.map((pid) => (
              <PidBadge key={pid} pid={pid} />
            ))}
          </>
        )}
        {m.owner === null && m.queue.length === 0 && <span className="muted small">libre</span>}
      </div>
    </div>
  )
}

function Counter({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className={`counter${bad && value > 0 ? ' bad' : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

function CodeCard({ p, mutex }: { p: ProcessInfo; mutex?: string }): React.JSX.Element {
  const range = mutex ? criticalRange(p, mutex) : null
  return (
    <div className="code-card">
      <div className="code-card-title">
        <PidBadge pid={p.pid} /> {p.name} <StateChip state={p.state} />
      </div>
      <ProgramListing p={p} highlight={range ? { ...range, className: 'critical' } : undefined} />
    </div>
  )
}

// ───────────────────────── sección crítica ─────────────────────────

function CriticalSection({
  group,
  snapshot
}: {
  group: SyncGroupInfo
  snapshot: KernelSnapshot
}): React.JSX.Element {
  const { sync, processes } = snapshot
  const v: VariableInfo = sync.variables.find((x) => x.group === group.id)!
  const m = sync.mutexes.find((x) => x.group === group.id)!
  const users = usersOf(processes, `LOAD ${v.name}`)
  const inside = users.filter((p) => insideCritical(p, m.name))
  const lost = v.expected - v.value

  return (
    <section className={`sync-card${group.enabled ? '' : ' unsafe'}`}>
      <header>
        <div>
          <h2>{group.name}: condición de carrera</h2>
          <p className="muted small">
            Varios procesos actualizan la variable compartida <code>{v.name}</code> con LOAD → ADDI
            → STORE. Si uno es expropiado entre su LOAD y su STORE y otro escribe en medio, su STORE
            sobrescribe ese valor y se pierde una actualización.
          </p>
        </div>
        <GroupToggle group={group} label={`Exclusión mutua (${m.name})`} />
      </header>

      <div className="cs-row">
        <div className="var-card">
          <div className="obj-kind">Variable compartida</div>
          <div className="obj-name">
            <code>{v.name}</code>
          </div>
          <div className="var-values">
            <div>
              <span>valor real</span>
              <b>{v.value}</b>
            </div>
            <div>
              <span>esperado</span>
              <b>{v.expected}</b>
            </div>
            <div className={lost > 0 ? 'bad' : 'good'}>
              <span>actualizaciones perdidas</span>
              <b>{lost}</b>
            </div>
          </div>
        </div>

        <MutexView m={m} enabled={group.enabled} />

        <div className={`cs-inside${inside.length > 1 ? ' violation' : ''}`}>
          <div className="obj-kind">Dentro de la sección crítica</div>
          {inside.length === 0 ? (
            <div className="muted">nadie</div>
          ) : (
            inside.map((p) => (
              <div key={p.pid} className="inside-proc">
                <PidBadge pid={p.pid} /> {p.name}
                <span className="muted small"> · registro = {p.reg ?? '—'}</span>
              </div>
            ))
          )}
          {inside.length > 1 && <div className="violation-text">¡Exclusión mutua violada!</div>}
        </div>
      </div>

      <div className="code-pair">
        {users.map((p) => (
          <CodeCard key={p.pid} p={p} mutex={m.name} />
        ))}
      </div>
    </section>
  )
}

// ───────────────────────── bitácora ─────────────────────────

function SyncLog({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element {
  const events = snapshot.events
    .filter((e) => e.kind === 'sync')
    .slice(-14)
    .reverse()
  return (
    <section className="sync-card">
      <header>
        <h2>Operaciones recientes</h2>
      </header>
      <ul className="sync-log">
        {events.map((e) => (
          <li
            key={e.id}
            className={
              /Condición de carrera|Desbordamiento|vacío|inválido/.test(e.message)
                ? 'bad'
                : undefined
            }
          >
            <span className="muted">t={e.tick}</span>
            {e.pid ? <PidBadge pid={e.pid} /> : <span />}
            <span>{e.message}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
