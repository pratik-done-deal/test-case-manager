import type { Tally } from './tally'

export function ProgressBar({ tally }: { tally: Tally }) {
  const percent = (count: number) => (tally.total ? `${(count / tally.total) * 100}%` : '0%')
  return (
    <div
      className="progress"
      role="img"
      aria-label={`${tally.pass} passed, ${tally.fail} failed, ${tally.total - tally.pass - tally.fail} not run`}
    >
      <span className="progress-pass" style={{ width: percent(tally.pass) }} />
      <span className="progress-fail" style={{ width: percent(tally.fail) }} />
    </div>
  )
}
