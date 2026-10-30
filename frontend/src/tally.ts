import type { Results, TestCase } from './types'

export type Tally = { total: number; pass: number; fail: number }

export function tally(cases: TestCase[], results: Results): Tally {
  let pass = 0
  let fail = 0
  for (const testCase of cases) {
    if (results[testCase.key] === 'pass') pass++
    else if (results[testCase.key] === 'fail') fail++
  }
  return { total: cases.length, pass, fail }
}
