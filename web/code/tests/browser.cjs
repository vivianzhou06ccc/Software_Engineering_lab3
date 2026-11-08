/* Real Chromium interaction test. Run with PLAYWRIGHT_MODULE pointing to Playwright. */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const { createInterface } = require("node:readline");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const directory = mkdtempSync(join(tmpdir(), "stay-browser-"));
const server = spawn(process.env.STAY_PYTHON || "python3", [
  resolve(__dirname, "../main.py"), "--port", "0", "--no-browser",
  "--db", join(directory, "test.sqlite3"),
], { stdio: ["ignore", "pipe", "inherit"] });

function address() {
  return new Promise((ok, fail) => {
    const stdout = createInterface({ input: server.stdout });
    stdout.on("line", line => {
      if (line.startsWith("http://")) ok(line);
    });
    server.once("exit", code => fail(new Error("HTTP server exited: " + code)));
    server.once("error", fail);
  });
}

function shifted(value, offset) {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function test() {
  const base = await address();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => {
      if (response.status() >= 500) errors.push(response.status() + " " + response.url());
    });
    const title = text => page.getByRole("heading", { name: text, level: 1, exact: true }).waitFor();
    const nav = text => page.getByRole("navigation", { name: "页面导航" }).getByRole("link", { name: text, exact: true });
    const button = text => page.getByRole("button", { name: text, exact: true });
    const dialog = () => page.getByRole("dialog");
    async function role(id, expected) {
      await page.getByLabel("切换演示身份").selectOption(String(id));
      await title(expected);
    }
    async function snapshot(name) {
      if (process.env.STAY_SCREENSHOTS) {
        await page.screenshot({ path: join(process.env.STAY_SCREENSHOTS, name + ".png") });
      }
    }
    await page.goto(base);
    await title("找一家合适的酒店");
    const today = await page.getByLabel("入住日期").inputValue();
    const tomorrow = shifted(today, 1);
    const dayAfter = shifted(today, 2);
    const later = shifted(today, 3);

    await page.mouse.move(190, 440);
    await page.mouse.wheel(0, 660);
    await page.waitForFunction(() => window.scrollY > 100);
    await page.mouse.wheel(0, -900);
    await page.waitForFunction(() => window.scrollY === 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await page.setViewportSize({ width: 1280, height: 860 });
    await snapshot("01-新版顾客查询");
    await page.setViewportSize({ width: 390, height: 760 });

    await page.getByLabel("入住日期").fill(tomorrow);
    await page.getByLabel("退房日期").fill(later);
    await button("只查一晚").click();
    assert.equal(await page.getByLabel("退房日期").inputValue(), dayAfter);
    await button("查询酒店和房态").click();
    await page.waitForURL(new RegExp(tomorrow));
    await page.getByRole("heading", { name: "找到 2 家可预订酒店" }).waitFor();
    await page.locator("#results").getByText(tomorrow + " 至 " + dayAfter, { exact: true }).waitFor();
    const card = page.locator(".hotel-card").filter({ hasText: "金陵酒店" });
    assert.match(await card.innerText(), /剩 4 间/);
    assert.match(await card.innerText(), /¥428/);
    await card.getByRole("link", { name: "查看房型和逐日房态" }).click();
    await title("栖居 · 金陵酒店");
    let room = page.locator(".room-grid > .card").filter({ hasText: "雅致大床房" });
    assert.match(await room.getByRole("row").nth(1).innerText(), new RegExp(tomorrow + ".*4.*428", "s"));
    assert.equal(await room.getByRole("row").count(), 2);
    await snapshot("02-单晚房型与库存");

    await page.getByLabel("入住日期").fill(today);
    await page.getByLabel("退房日期").fill(dayAfter);
    await button("查看这段日期的房态").click();
    await page.waitForURL(/hotel\/1/);
    await room.getByRole("row").nth(2).waitFor();
    assert.match(await room.getByRole("row").nth(1).innerText(), /5.*368/s);
    await room.getByRole("link", { name: "核对报价并预订" }).click();
    await title("确认你的入住安排");
    await page.getByLabel("联系人", { exact: true }).fill("浏览器验收顾客");
    await page.getByLabel("联系电话（选填）").fill("13800000000");
    await button("确认报价并提交预订").click();
    await title("我的订单");
    await page.getByText("ST-000001", { exact: true }).waitFor();
    assert.match(await page.locator("main").innerText(), /¥796/);
    await snapshot("03-订单成交明细");

    await role(3, "订单工作台");
    await button("确认订单").click();
    await dialog().getByRole("button", { name: "确认订单", exact: true }).click();
    await button("办理入住").waitFor();
    await nav("房态日历").click();
    await title("房态日历");
    assert.match(await page.getByText("当前物理余量").locator("..").innerText(), /4 间/);
    await page.getByLabel("当晚售价（元）").fill("389.50");
    await button("保存当日房态").click();
    await page.getByRole("status").filter({ hasText: "当日房态已保存" }).waitFor();
    await page.getByRole("heading", { name: /房态设置/ }).waitFor();
    await snapshot("06-员工房态日历");
    await nav("酒店与房型").click();
    await title("酒店与房型");
    await button("新增房型").click();
    await dialog().getByLabel("房型名称").fill("验收双床房");
    await dialog().getByLabel("床型").fill("双床");
    await dialog().getByRole("button", { name: "确认提交" }).click();
    await page.getByRole("heading", { name: "验收双床房" }).waitFor();

    await role(1, "找一家合适的酒店");
    await nav("我的订单").click();
    await title("我的订单");
    await page.getByRole("link", { name: "查看订单" }).click();
    await page.getByRole("link", { name: "申请改单" }).click();
    await title("申请修改入住安排");
    await page.getByLabel("退房日期").fill(later);
    await page.getByLabel("改单原因").fill("增加一晚");
    await button("核对新报价").click();
    await page.getByRole("heading", { name: "新方案报价" }).waitFor();
    await button("确认报价并提交改单").click();
    await title("我的订单");
    await page.getByText("改单申请 #1", { exact: true }).waitFor();

    await role(3, "订单工作台");
    await page.getByRole("link", { name: "查看并处理" }).click();
    await title("订单详情");
    await button("处理申请").click();
    await dialog().getByLabel("处理原因").fill("同意延住");
    await dialog().getByRole("button", { name: "保存处理结果" }).click();
    await page.getByText("已批准", { exact: true }).waitFor();

    await nav("停业申请").click();
    await title("申请临时停业");
    await page.getByLabel("停业原因").fill("消防检修");
    await button("提交停业申请").click();
    await title("停业申请详情");
    await page.getByRole("heading", { name: "ST-000001" }).waitFor();

    await role(5, "酒店资料审核");
    await page.getByLabel("审核意见").fill("核验通过");
    await button("审核通过").click();
    await page.getByRole("heading", { name: "当前列表没有酒店" }).waitFor();
    await nav("停业审批").click();
    await page.getByRole("link", { name: "查看申请与受影响订单" }).click();
    await page.getByLabel("审核意见").fill("同意检修");
    await button("批准停业").click();
    await page.getByText("已批准", { exact: true }).waitFor();
    await button("登记处置").click();
    await dialog().getByLabel("处置情况").fill("联系顾客，保留订单");
    await dialog().getByRole("button", { name: "保存记录" }).click();
    await page.getByText("联系顾客，保留订单", { exact: true }).waitFor();
    await nav("业务统计").click();
    await title("业务统计");
    await button("查询统计").click();
    await page.locator("#stats-result").getByText("待确认", { exact: true }).first().waitFor();
    assert.match(await page.locator("#stats-result").innerText(), /待确认/);
    await nav("通知与审计").click();
    await title("通知与审计");
    assert.match(await page.locator("main").innerText(), /closure\.review/);
    await nav("全平台订单").click();
    await title("全平台订单");
    await page.getByRole("link", { name: "查看详情" }).click();
    await title("订单详情");
    assert.doesNotMatch(await page.locator("main").innerText(), /13800000000/);

    await role(1, "找一家合适的酒店");
    await page.getByLabel("入住日期").fill(today);
    await button("只查一晚").click();
    await button("查询酒店和房态").click();
    await page.locator(".hotel-card").filter({ hasText: "金陵酒店" }).getByText("酒店临时停业").first().waitFor();
    assert.deepEqual(errors, []);
    console.log("浏览器验证通过：390px 原生滚动、日期和单晚房态、逐晚报价、下单、改单、房态维护、酒店审核、停业与审计。");
  } finally {
    await browser.close();
  }
}

test().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  server.once("close", () => rmSync(directory, { recursive: true, force: true }));
  server.kill();
});
