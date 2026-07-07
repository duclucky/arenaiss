import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const exe = process.env.PW_CHROME
  || (() => { const b='C:/Users/TBC/AppData/Local/ms-playwright'; const d=`${b}/chromium_headless_shell-1228/chrome-headless-shell-win/chrome-headless-shell.exe`; return existsSync(d)?d:undefined; })();

const OUT = 'D:/renaiss-arena/.e2e-output';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:3000';

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('text=Enter the', { timeout: 15000 });
  await page.waitForSelector('text=Log in to sync progress on the server.', { timeout: 5000 });
  if (await page.locator('header >> text=Read-only').count()) throw new Error('Header still shows Read-only chip');
  if (await page.locator('header >> text=Local save').count()) throw new Error('Header still shows Local save chip');
  // Wait for pool load and enabled first-pack button.
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Open first pack/.test(x.textContent || ''));
    return b && !b.disabled;
  }, { timeout: 20000 });
  await page.screenshot({ path: `${OUT}/01-intro.png` });
  log('✓ intro rendered, pool loaded');

  // Open pack.
  await page.click('text=Open first pack');
  await page.waitForSelector('text=SIMULATED PACK RESULT', { timeout: 15000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/02-pack.png` });
  const slabCount = await page.locator('.slab').count();
  if (await page.locator('.slab-info').count()) throw new Error('Slab info icon should not be rendered');
  if (await page.locator('.slab-passport-overlay').count()) throw new Error('Hover-only Passport overlay should not be rendered');
  const fixedPassportButtons = await page.locator('.slab-passport-button', { hasText: 'View Passport' }).count();
  if (fixedPassportButtons < slabCount) throw new Error(`Expected fixed View Passport buttons on every slab, got ${fixedPassportButtons}/${slabCount}`);
  log(`✓ pack opened, ${slabCount} slabs revealed`);

  // Open a few more packs so the deck can fill.
  await page.click('text=Add to collection');
  await page.waitForSelector('text=Collection', { timeout: 10000 });
  for (let i = 0; i < 2; i++) {
    const btn = page.locator('button', { hasText: /^Open pack · / }).first();
    if (await btn.isEnabled()) { await btn.click(); await page.waitForTimeout(3200); await page.click('text=Add to collection').catch(()=>{}); await page.waitForTimeout(500); }
  }
  const rosterCount = await page.locator('.slab').count();
  log(`✓ roster has ${rosterCount} cards`);
  await page.screenshot({ path: `${OUT}/03-roster.png` });

  // Deck builder: choose 5 cards.
  await page.click('nav >> text=Deck').catch(async () => { await page.click('text=Build deck →'); });
  await page.waitForSelector('text=Build deck', { timeout: 10000 });
  await page.waitForTimeout(500);
  // Click 5 slabs in the collection grid to add them to the deck.
  const collectionSlabs = page.locator('.card-grid .slab');
  const n = Math.min(5, await collectionSlabs.count());
  for (let i = 0; i < n; i++) { await collectionSlabs.nth(i).click(); await page.waitForTimeout(150); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/04-deck.png` });
  if (await page.locator('.card-grid button', { hasText: /^Passport$/ }).count()) {
    throw new Error('Deck collection should not render the extra Passport button');
  }
  log(`✓ deck: clicked ${n} cards`);

  // Start battle.
  const goBattle = page.locator('button', { hasText: 'Start battle' });
  if (await goBattle.isEnabled()) {
    await goBattle.click();
    await page.waitForSelector('text=BATTLE LOG', { timeout: 10000 });
    log('✓ battle started');
    // Play until the end: click the first stat button on each player turn.
    for (let turn = 0; turn < 20; turn++) {
      if (await page.locator('text=View result').count()) break;
      const statBtns = page.locator('button', { hasText: /(wins|loses) round/ });
      if (await statBtns.count()) { await statBtns.first().click(); await page.waitForTimeout(1200); }
      else await page.waitForTimeout(1100);
    }
    await page.screenshot({ path: `${OUT}/05-battle.png` });
    const resultBtn = page.locator('text=View result');
    if (await resultBtn.count()) { await resultBtn.click(); await page.waitForSelector('text=REWARD', { timeout: 8000 }); await page.screenshot({ path: `${OUT}/06-result.png` }); log('✓ battle finished, result shown'); }
  } else { log('! deck not full, skipping battle'); }

  // Passport drawer: go back to collection and click one card.
  await page.click('text=Collection').catch(()=>{});
  await page.waitForTimeout(600);
  const anySlab = page.locator('.card-grid .slab').first();
  if (await anySlab.count()) {
    await anySlab.click();
    await page.waitForSelector('text=Card Passport', { timeout: 8000 });
    await page.waitForTimeout(2500);
    const passportText = await page.locator('aside').innerText();
    if (passportText.includes('7d: —') && passportText.includes('30d: —') && passportText.includes('365d: —')) {
      throw new Error('Reference deltas should not render empty dash-only values');
    }
    await page.screenshot({ path: `${OUT}/07-passport.png` });
    // Open the real-ownership funnel.
    const ownBtn = page.locator('text=How to own it for real');
    if (await ownBtn.count()) {
      await ownBtn.click();
      await page.waitForTimeout(1500);
      if (await page.locator('text=150000000000000000000').count()) throw new Error('Pack price should be formatted, not raw base units');
      const packLinkCount = await page.locator('a[href*="/gacha/"]').count();
      if (packLinkCount < 1) throw new Error('Real pack links should target the specific Renaiss gacha pack');
      const cardLinks = await page.locator('aside a[href*="/card/"]').count();
      if (cardLinks < 1) throw new Error('Direct marketplace action should target the exact Renaiss card page');
      const homepageOnlyLinks = await page.locator('aside a[href="https://www.renaiss.xyz"], aside a[href="https://renaiss.xyz"]').count();
      if (homepageOnlyLinks > 0) throw new Error('Ownership links should not point to the Renaiss homepage');
      await page.screenshot({ path: `${OUT}/08-own-real.png` });
    }
    log('✓ passport drawer opened');
  }

  log('\nCONSOLE ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
} catch (e) {
  process.exitCode = 1;
  log('E2E ERROR:', e.message);
  await page.screenshot({ path: `${OUT}/ERROR.png` }).catch(()=>{});
  log('CONSOLE ERRORS:', errors.slice(0, 10));
} finally {
  await browser.close();
}
