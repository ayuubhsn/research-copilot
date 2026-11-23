"""Takes the landing page screenshots from the static demo build.

    python web/scripts/screenshots.py http://localhost:8811/research-copilot/app/ site/img

Needs Playwright (pip install playwright && playwright install chromium).
"""

import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

W, H = 1440, 900


async def main(url: str, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(**({"executable_path": sys.argv[4]} if len(sys.argv) > 4 else {}))
        page = await browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1.5)
        await page.goto(url)
        await page.wait_for_timeout(2500)

        # Ask the first suggested question
        await page.locator("main button").filter(has_text="?").first.click()
        await page.wait_for_timeout(4000)
        await page.screenshot(path=out / "hero.png")
        await page.screenshot(path=out / "pdf.png", clip={"x": 806, "y": 104, "width": 634, "height": 400})

        # Expand the fact-check
        show = page.get_by_role("button", name="Show")
        if await show.count():
            await show.first.click()
            await page.wait_for_timeout(500)
        await page.screenshot(path=out / "factcheck.png", clip={"x": 256, "y": 120, "width": 550, "height": 292})

        # Save the top passage so the notebook has something in it
        star = page.locator("button[title*='notebook' i], button[aria-label*='notebook' i]")
        if await star.count():
            await star.first.click()
            await page.wait_for_timeout(500)

        await page.get_by_role("button", name="Find again").click()
        query = sys.argv[3] if len(sys.argv) > 3 else "results"
        box = page.locator("input").first
        await box.fill(query)
        await box.press("Enter")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=out / "demo.png")
        await page.screenshot(path=out / "find.png", clip={"x": 256, "y": 104, "width": 550, "height": 292})

        await page.get_by_role("button", name="Notebook").click()
        await page.wait_for_timeout(800)
        await page.screenshot(path=out / "notebook.png", clip={"x": 256, "y": 170, "width": 550, "height": 292})

        await browser.close()
    print("Saved to", out)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], Path(sys.argv[2])))
