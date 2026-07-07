import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const exe = process.env.PW_CHROME
  || (() => { const b='C:/Users/TBC/AppData/Local/ms-playwright'; const d=`${b}/chromium_headless_shell-1228/chrome-headless-shell-win/chrome-headless-shell.exe`; return existsSync(d)?d:undefined; })();

const OUT = 'C:/Users/TBC/AppData/Local/Temp/claude/d--renaiss-arena/46fa948b-79cf-448b-a68b-351930c4a11e/scratchpad';
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

try {
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('text=Vào phòng chờ', { timeout: 15000 });
  // đợi pool load (nút mở gói bật)
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Mở gói đầu tiên/.test(x.textContent || ''));
    return b && !b.disabled;
  }, { timeout: 20000 });
  await page.screenshot({ path: `${OUT}/01-intro.png` });
  log('✓ intro rendered, pool loaded');

  // Mở gói
  await page.click('text=Mở gói đầu tiên');
  await page.waitForSelector('text=KẾT QUẢ MỞ GÓI', { timeout: 15000 });
  await page.waitForTimeout(3500); // để reveal chạy xong
  await page.screenshot({ path: `${OUT}/02-pack.png` });
  const slabCount = await page.locator('.slab').count();
  log(`✓ pack opened, ${slabCount} slabs revealed`);

  // Mở thêm vài gói để đủ 5 thẻ cho deck
  await page.click('text=Vào bộ sưu tập');
  await page.waitForSelector('text=Bộ sưu tập', { timeout: 10000 });
  for (let i = 0; i < 2; i++) {
    const btn = page.locator('button', { hasText: /^Mở gói · / }).first();
    if (await btn.isEnabled()) { await btn.click(); await page.waitForTimeout(3200); await page.click('text=Vào bộ sưu tập').catch(()=>{}); await page.waitForTimeout(500); }
  }
  const rosterCount = await page.locator('.slab').count();
  log(`✓ roster has ${rosterCount} cards`);
  await page.screenshot({ path: `${OUT}/03-roster.png` });

  // Deck builder — chọn 5 thẻ
  await page.click('nav >> text=Deck').catch(async () => { await page.click('text=Lắp deck →'); });
  await page.waitForSelector('text=Lắp deck', { timeout: 10000 });
  await page.waitForTimeout(500);
  // click 5 slab trong khu bộ sưu tập (dưới) để thêm vào deck
  const collectionSlabs = page.locator('.card-grid .slab');
  const n = Math.min(5, await collectionSlabs.count());
  for (let i = 0; i < n; i++) { await collectionSlabs.nth(i).click(); await page.waitForTimeout(150); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/04-deck.png` });
  log(`✓ deck: clicked ${n} cards`);

  // Vào trận
  const goBattle = page.locator('button', { hasText: 'Vào trận' });
  if (await goBattle.isEnabled()) {
    await goBattle.click();
    await page.waitForSelector('text=NHẬT KÝ TRẬN', { timeout: 10000 });
    log('✓ battle started');
    // chơi tới khi kết thúc: bấm nút stat đầu tiên mỗi lượt của người chơi
    for (let turn = 0; turn < 20; turn++) {
      if (await page.locator('text=Xem kết quả').count()) break;
      const statBtns = page.locator('button', { hasText: /(thắng|thua) lượt/ });
      if (await statBtns.count()) { await statBtns.first().click(); await page.waitForTimeout(1200); }
      else await page.waitForTimeout(1100); // lượt đối thủ
    }
    await page.screenshot({ path: `${OUT}/05-battle.png` });
    const resultBtn = page.locator('text=Xem kết quả');
    if (await resultBtn.count()) { await resultBtn.click(); await page.waitForSelector('text=PHẦN THƯỞNG', { timeout: 8000 }); await page.screenshot({ path: `${OUT}/06-result.png` }); log('✓ battle finished, result shown'); }
  } else { log('! deck not full, skipping battle'); }

  // Passport drawer — mở từ result? Quay lại roster rồi click 1 lá
  await page.click('text=Bộ sưu tập').catch(()=>{});
  await page.waitForTimeout(600);
  const anySlab = page.locator('.card-grid .slab').first();
  if (await anySlab.count()) {
    await anySlab.click();
    await page.waitForSelector('text=Card Passport', { timeout: 8000 });
    await page.waitForTimeout(2500); // đợi index + narration
    await page.screenshot({ path: `${OUT}/07-passport.png` });
    // mở "sở hữu thật"
    const ownBtn = page.locator('text=Làm sao sở hữu lá THẬT');
    if (await ownBtn.count()) { await ownBtn.click(); await page.waitForTimeout(1500); await page.screenshot({ path: `${OUT}/08-own-real.png` }); }
    log('✓ passport drawer opened');
  }

  log('\nCONSOLE ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
} catch (e) {
  log('E2E ERROR:', e.message);
  await page.screenshot({ path: `${OUT}/ERROR.png` }).catch(()=>{});
  log('CONSOLE ERRORS:', errors.slice(0, 10));
} finally {
  await browser.close();
}
