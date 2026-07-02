import { performance } from 'node:perf_hooks'
import { BrowserPool } from '../src/pool/BrowserPool.js'
import { Scheduler } from '../src/scheduler/Scheduler.js'
import { test as kazeTest, collectTestCases, _resetRegistry } from '../src/api/test.js'

const FIXTURE = new URL('../examples/fixtures/index.html', import.meta.url).href
const pool = new BrowserPool()
await pool.init()
const stats = pool.stats()
console.log(`pool: ${stats.processes}×${stats.totalContexts/stats.processes}ctx = ${stats.totalContexts}`)

for (const count of [20, 5, 50]) {
  _resetRegistry()
  for (let i = 0; i < count; i++) {
    kazeTest(`t${i}`, async (page) => {
      await page.goto(FIXTURE)
      await page.click('#btn')
      await page.textContent('#result')
    })
  }
  const scheduler = new Scheduler(pool)
  scheduler.enqueue(collectTestCases(pool))
  const t0 = performance.now()
  await scheduler.run()
  const ms = performance.now() - t0
  console.log(`${count} tests: ${ms.toFixed(0)}ms (${(ms/count).toFixed(0)}ms/test)`)
  await new Promise(r => setTimeout(r, 500))
}
await pool.close()
process.exit(0)
