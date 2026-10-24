import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const pages = [
  { name: 'Dashboard', path: '/' },
  { name: 'Cases', path: '/cases' },
  { name: 'Overlaps', path: '/overlaps' },
  { name: 'Register complaint', path: '/register' },
  { name: 'Reports', path: '/reports' },
]

for (const entry of pages) {
  test(`${entry.name}: no serious or critical accessibility violations`, async ({ page }) => {
    await page.goto(`http://localhost:5173${entry.path}`)
    await page.locator('main').waitFor()
    // Avoid auditing the initial loading state; wait for page content or errors.
    await expect(page.locator('main')).not.toBeEmpty()

    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const severe = result.violations.filter(v =>
      v.impact === 'serious' || v.impact === 'critical'
    )

    expect(severe, JSON.stringify(severe, null, 2)).toEqual([])
  })
}