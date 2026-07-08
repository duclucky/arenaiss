import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const exe = process.env.PW_CHROME
  || (() => {
    const b = 'C:/Users/TBC/AppData/Local/ms-playwright';
    const d = `${b}/chromium_headless_shell-1228/chrome-headless-shell-win/chrome-headless-shell.exe`;
    return existsSync(d) ? d : undefined;
  })();

const OUT = 'D:/renaiss-arena/.e2e-output';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:3000';

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

async function visibleSlabCount() {
  return page.locator('.slab:visible').count();
}

async function openPackByName(name) {
  const button = page.locator('button', { hasText: name }).first();
  await button.waitFor({ timeout: 20000 });
  await page.waitForFunction((label) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(label));
    return b && !b.disabled;
  }, name, { timeout: 20000 });
  await button.click();
  await page.waitForSelector('text=RESULT', { timeout: 15000 });
  await page.waitForTimeout(3600);
}

async function addCurrentPackToRoster() {
  await page.locator('button', { hasText: 'Add to roster' }).click();
  await page.waitForSelector('text=Roster', { timeout: 10000 });
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('text=Enter the', { timeout: 15000 });
  await page.waitForSelector('text=Log in to sync progress on the server.', { timeout: 5000 });
  if (await page.locator('header >> text=Read-only').count()) throw new Error('Header still shows Read-only chip');
  if (await page.locator('header >> text=Local save').count()) throw new Error('Header still shows Local save chip');
  if (await page.locator('nav >> text=Vault').count()) throw new Error('Nav should not show Vault');
  if (await page.locator('nav >> text=Collection').count()) throw new Error('Nav should not show Collection');
  if (await page.locator('nav >> text=Deck').count()) throw new Error('Nav should not show Deck');
  await page.locator('nav >> text=Gacha').waitFor({ timeout: 5000 });
  await page.locator('nav >> text=Roster').waitFor({ timeout: 5000 });
  await page.locator('nav >> text=Lineup').waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${OUT}/01-intro.png` });
  log('ok intro rendered with new nav');

  // Welcome Pack is free, one-time, and reveals 5 cards.
  await openPackByName('Welcome Pack');
  await page.screenshot({ path: `${OUT}/02-welcome-pack.png` });
  const welcomeSlabs = await visibleSlabCount();
  if (welcomeSlabs !== 5) throw new Error(`Welcome Pack should reveal 5 visible slabs, got ${welcomeSlabs}`);
  if (await page.locator('.slab-info').count()) throw new Error('Slab info icon should not be rendered');
  if (await page.locator('.slab-passport-overlay').count()) throw new Error('Hover-only Passport overlay should not be rendered');
  const fixedPassportButtons = await page.locator('.slab-passport-button', { hasText: 'View Passport' }).count();
  if (fixedPassportButtons < welcomeSlabs) throw new Error(`Expected fixed View Passport buttons on every slab, got ${fixedPassportButtons}/${welcomeSlabs}`);
  const firstInteractiveSlab = page.locator('.slab.interactive').first();
  await firstInteractiveSlab.hover();
  await page.waitForTimeout(250);
  const rainbowHover = await firstInteractiveSlab.evaluate((el) => {
    const before = window.getComputedStyle(el, '::before');
    return { backgroundImage: before.backgroundImage, opacity: before.opacity };
  });
  if (!/(linear|conic)-gradient/.test(rainbowHover.backgroundImage) || Number(rainbowHover.opacity) < 0.95) {
    throw new Error('Interactive slab hover should show a visible rainbow border');
  }
  log('ok Welcome Pack reveals 5 cards');

  await addCurrentPackToRoster();
  if (await page.locator('button', { hasText: 'Welcome Pack' }).count()) {
    throw new Error('Welcome Pack should disappear after it has been opened once');
  }
  await page.locator('button', { hasText: 'Eden Pack' }).waitFor({ timeout: 5000 });
  await page.locator('button', { hasText: '300 credits' }).waitFor({ timeout: 5000 });
  await page.locator('button', { hasText: 'OMEGA Pack' }).waitFor({ timeout: 5000 });
  await page.locator('button', { hasText: '500 credits' }).waitFor({ timeout: 5000 });
  await page.locator('button', { hasText: 'RenaCrypt Pack' }).waitFor({ timeout: 5000 });
  await page.locator('button', { hasText: '800 credits' }).waitFor({ timeout: 5000 });

  // Paid packs cost credits and reveal exactly 1 card.
  await page.locator('button', { hasText: 'Eden Pack' }).click();
  await page.waitForSelector('text=RESULT', { timeout: 15000 });
  await page.waitForTimeout(2600);
  const edenSlabs = await visibleSlabCount();
  if (edenSlabs !== 1) throw new Error(`Paid Eden Pack should reveal 1 visible slab, got ${edenSlabs}`);
  await page.waitForSelector('text=9700', { timeout: 5000 });
  await page.screenshot({ path: `${OUT}/03-eden-pack.png` });
  await addCurrentPackToRoster();
  log('ok paid pack price and 1-card reveal verified');

  const rosterCount = await page.locator('.card-grid .slab').count();
  if (rosterCount < 6) throw new Error(`Roster should have at least 6 cards after two packs, got ${rosterCount}`);
  await page.screenshot({ path: `${OUT}/04-roster.png` });

  // Lineup builder: choose 5 cards and verify battle stake copy.
  await page.click('nav >> text=Lineup').catch(async () => { await page.click('text=Build lineup'); });
  await page.waitForSelector('text=Build lineup', { timeout: 10000 });
  await page.waitForTimeout(500);
  const rosterSlabs = page.locator('.card-grid .slab');
  const n = Math.min(5, await rosterSlabs.count());
  for (let i = 0; i < n; i++) {
    await rosterSlabs.nth(i).click();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/05-lineup.png` });
  if (await page.locator('.card-grid button', { hasText: /^Passport$/ }).count()) {
    throw new Error('Lineup roster should not render the extra Passport button');
  }
  const goBattle = page.locator('button', { hasText: 'Start battle - stake 100' });
  await goBattle.waitFor({ timeout: 8000 });
  if (!(await goBattle.isEnabled())) throw new Error('Battle start button should be enabled after selecting 5 cards');
  log(`ok lineup: clicked ${n} cards`);

  // Start battle and play to result. Credit balance should deduct stake before payout.
  await goBattle.click();
  await page.waitForSelector('text=BATTLE LOG', { timeout: 10000 });
  await page.waitForSelector('text=ROUND', { timeout: 5000 });
  await page.waitForSelector('text=9600', { timeout: 5000 });
  log('ok battle started and 100-credit stake deducted');
  for (let turn = 0; turn < 20; turn++) {
    if (await page.locator('text=View result').count()) break;
    const statBtns = page.locator('button', { hasText: /(wins|loses) round/ });
    if (await statBtns.count()) {
      await statBtns.first().click();
      await page.waitForTimeout(1200);
    } else {
      await page.waitForTimeout(1100);
    }
  }
  await page.screenshot({ path: `${OUT}/06-battle.png` });
  const resultBtn = page.locator('text=View result');
  if (await resultBtn.count()) {
    await resultBtn.click();
    await page.waitForSelector('text=BATTLE PAYOUT', { timeout: 8000 });
    await page.waitForSelector('text=Winner payout:', { timeout: 5000 });
    await page.screenshot({ path: `${OUT}/07-result.png` });
    log('ok battle finished, result shown');
  } else {
    throw new Error('Battle did not reach View result');
  }

  // Passport modal: go back to Roster and click one card.
  await page.click('text=Roster').catch(() => {});
  await page.waitForSelector('text=Roster', { timeout: 10000 });
  await page.waitForTimeout(600);
  const anySlab = page.locator('.card-grid .slab').first();
  if (await anySlab.count()) {
    await anySlab.click();
    await page.waitForSelector('text=Card Passport', { timeout: 8000 });
    await page.waitForTimeout(2500);
    const passportDialog = page.locator('[role="dialog"][aria-label="Card Passport"]');
    const dialogBox = await passportDialog.boundingBox();
    if (!dialogBox || dialogBox.width < 780 || dialogBox.x < 120) {
      throw new Error(`Passport should render as a centered wide modal, got ${dialogBox ? JSON.stringify(dialogBox) : 'no box'}`);
    }
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Card Passport"]');
      return !!dialog?.textContent?.includes('not this token listing price');
    }, { timeout: 20000 });
    const passportText = await passportDialog.innerText();
    if (!/reference estimate/i.test(passportText)) {
      throw new Error('Passport should label the index value as a Reference estimate');
    }
    if (!passportText.includes('not this token listing price')) {
      throw new Error('Passport should explain that index estimate is not the exact token listing price');
    }
    if (passportText.includes('ANTHROPIC_API_KEY') || passportText.includes('PASSPORT_AI_API_KEY')) {
      throw new Error('Passport UI should not expose technical environment variable names');
    }
    if (passportText.includes('Index estimates are based on')) {
      throw new Error('Passport should not repeat the index/listing explanation outside the reference panel');
    }
    if (!/passport ai/i.test(passportText)) {
      throw new Error('Passport should render the AI insight section');
    }
    if (passportText.includes('Reference price:') || passportText.includes('Custody:') || passportText.includes('Provenance:')) {
      throw new Error('Passport AI section should not repeat reference, custody, or provenance labels already shown elsewhere');
    }
    if (passportText.includes('How to own it for real')) {
      throw new Error('Passport ownership CTA should use the new marketplace copy');
    }
    const ownButtonBox = await passportDialog.locator('text=Check on Renaiss Marketplace').first().boundingBox();
    const bodyBox = await passportDialog.locator('.passport-body').boundingBox();
    if (!ownButtonBox || !bodyBox || ownButtonBox.y > bodyBox.y + 260) {
      throw new Error('Ownership CTA should be visible near the top of the Passport modal body');
    }
    const referenceBulletCount = await passportDialog.locator('[data-testid="reference-meta-list"] li').count();
    if (referenceBulletCount < 3) {
      throw new Error('Reference estimate metadata should be rendered as bullet lines');
    }
    await passportDialog.locator('[data-testid="passport-ai-list"] li').first().waitFor({ timeout: 30000 });
    const aiBulletCount = await passportDialog.locator('[data-testid="passport-ai-list"] li').count();
    if (aiBulletCount < 2) {
      throw new Error('Passport AI insight should be rendered as bullet lines');
    }
    if (passportText.includes('7d: --') && passportText.includes('30d: --') && passportText.includes('365d: --')) {
      throw new Error('Reference deltas should not render empty dash-only values');
    }
    await page.screenshot({ path: `${OUT}/08-passport.png` });

    const ownBtn = page.locator('text=Check on Renaiss Marketplace');
    if (await ownBtn.count()) {
      await ownBtn.click();
      await page.waitForTimeout(1500);
      if (await page.locator('text=150000000000000000000').count()) throw new Error('Pack price should be formatted, not raw base units');
      const packLinkCount = await page.locator('a[href*="/gacha/"]').count();
      if (packLinkCount < 1) throw new Error('Real pack links should target the specific Renaiss gacha pack');
      if (await passportDialog.locator('text=View all Renaiss packs').count()) {
        throw new Error('Expanded marketplace panel should not render the View all Renaiss packs link');
      }
      const collapseBtn = passportDialog.locator('button', { hasText: 'Collapse marketplace' });
      if (await collapseBtn.count() < 1) {
        throw new Error('Expanded marketplace panel should provide a collapse button');
      }
      const listedCardBuy = await passportDialog.locator('a', { hasText: 'Buy exact listed card' }).count();
      const unlistedCardOpen = await passportDialog.locator('a', { hasText: 'Open exact card page' }).count();
      if (listedCardBuy + unlistedCardOpen < 1) throw new Error('Ownership CTA should distinguish exact-token ask price from index estimate');
      const cardLinks = await page.locator('[role="dialog"][aria-label="Card Passport"] a[href*="/card/"]').count();
      if (cardLinks < 1) throw new Error('Direct marketplace action should target the exact Renaiss card page');
      const homepageOnlyLinks = await page.locator('[role="dialog"][aria-label="Card Passport"] a[href="https://www.renaiss.xyz"], [role="dialog"][aria-label="Card Passport"] a[href="https://renaiss.xyz"]').count();
      if (homepageOnlyLinks > 0) throw new Error('Ownership links should not point to the Renaiss homepage');
      await collapseBtn.click();
      await page.waitForTimeout(300);
      if (await passportDialog.locator('a', { hasText: 'Buy exact listed card' }).count()) {
        throw new Error('Collapse marketplace should hide the expanded marketplace panel');
      }
      if (await passportDialog.locator('button', { hasText: 'Check on Renaiss Marketplace' }).count() < 1) {
        throw new Error('Collapse marketplace should restore the primary marketplace CTA');
      }
      await passportDialog.locator('[data-testid="passport-ai-list"] li').first().waitFor({ timeout: 5000 });
      await page.screenshot({ path: `${OUT}/09-own-real.png` });
    }
    log('ok passport modal opened');
  }

  log('\nCONSOLE ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
} catch (e) {
  process.exitCode = 1;
  log('E2E ERROR:', e.message);
  await page.screenshot({ path: `${OUT}/ERROR.png` }).catch(() => {});
  log('CONSOLE ERRORS:', errors.slice(0, 10));
} finally {
  await browser.close();
}
