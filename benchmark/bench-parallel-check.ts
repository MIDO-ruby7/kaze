import { performance } from 'node:perf_hooks'
import { BrowserPool } from '/Users/midori/workspace/kaze/src/pool/BrowserPool.js'
import { Scheduler } from '/Users/midori/workspace/kaze/src/scheduler/Scheduler.js'
import { test as kazeTest, collectTestCases, _resetRegistry } from '/Users/midori/workspace/kaze/src/api/test.js'

const FIXTURE = new URL('/Users/midori/workspace/kaze/examples/fixtures/index.html', 'file:').href.replace('file://', 'file:///')
const pool = new BrowserPool()
await pool.init({ workers: 20 })

// Warm up
_resetRegistry()
for (let i = 0; i < 5; i++) {
  kazeTest(`warmup${i}`, async (page) => {
    await page.goto(FIXTURE)
    await page.click('#btn')
  })
}
const scheduler0 = new Scheduler(pool)
scheduler0.enqueue(collectTestCases(pool))
await scheduler0.run()
await new Promise(r => setTimeout(r, 1000))
console.log('warmup done')

// Real test - measure individual test start/end times
const testLog: {name: string, start: number, end: number}[] = []
const t0ref = performance.now()

_resetRegistry()
for (let i = 0; i < 20; i++) {
  const name = `t${i}`
  kazeTest(name, async (page) => {
    const s = performance.now() - t0ref
    await page.goto(FIXTURE)
    await page.click('#btn')
    testLog.push({ name, start: s, end: performance.now() - t0ref })
  })
}
const scheduler = new Scheduler(pool)
scheduler.enqueue(collectTestCases(pool))
const t0 = performance.now()
await scheduler.run()
const total = performance.now() - t0

testLog.sort((a, b) => a.start - b.start)
console.log(`\n20 tests total: ${total.toFixed(0)}ms`)
console.log('Test timings:')
testLog.forEach(t => console.log(`  ${t.name}: +${t.start.toFixed(0)}ms → +${t.end.toFixed(0)}ms (${(t.end - t.start).toFixed(0)}ms)`))

const minStart = Math.min(...testLog.map(t => t.start))
const maxEnd = Math.max(...testLog.map(t => t.end))
console.log(`\nActive window: +${minStart.toFixed(0)}ms → +${maxEnd.toFixed(0)}ms = ${(maxEnd - minStart).toFixed(0)}ms`)
const avgDuration = testLog.reduce((s, t) => s + (t.end - t.start), 0) / testLog.length
console.log(`Avg test duration: ${avgDuration.toFixed(0)}ms`)
console.log(`Theoretical minimum (perfect parallel): ${avgDuration.toFixed(0)}ms`)
console.log(`Actual / theoretical: ${((maxEnd - minStart) / avgDuration).toFixed(2)}x`)

await pool.close()
process.exit(0)
