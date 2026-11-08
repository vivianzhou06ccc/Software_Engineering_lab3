/** Customer discovery, live room details, booking and post-booking requests. */

import {
  art, ask, badge, banner, bindDates, bindForm, button, card, empty, field, formError,
  h, icon, kv, link, numberId, pricesTable, requestStates, roomStates, select, shiftDate,
  statusBadge, statuses, tabs, textarea, timeText, url, yuan,
} from "./ui.js";

const dateParams = values => ({ arrival: values.arrival, departure: values.departure, guests: values.guests });
const requestStorage = id => `stay-request-${id}`;

function readRequest(id) {
  return JSON.parse(sessionStorage.getItem(requestStorage(id)) || "{}");
}

function writeRequest(id, value) {
  sessionStorage.setItem(requestStorage(id), JSON.stringify(value));
}

function stayFields(values, action = "") {
  return `<div class="fields dates ${action ? "with-action" : ""}">
    ${field("arrival", "入住日期", values.arrival, "date", "required")}
    ${field("departure", "退房日期", values.departure, "date", "required")}
    ${field("guests", "入住人数", values.guests, "number", 'min="1" max="20" required')}${action}
    </div>`;
}

function stayText(values) {
  return `${values.arrival} 入住 · ${values.departure} 退房 · ${values.guests} 人 / 1 间`;
}

function bookingTag(room) {
  if (room.bookable) return badge(`全程最少剩 ${room.remaining} 间`);
  const states = new Set(room.nights.map(n => n.status));
  const label = states.size === 1 ? roomStates[room.nights[0].status] : "部分日期不可订";
  return badge(room.nights.every(n => n.status === "available") ? "超出人数上限" : label, "amber");
}

async function find(ctx) {
  const values = ctx.filters(ctx.params);
  let hotels = [];
  let error = "";
  try {
    hotels = await ctx.api("/search", values);
  } catch (problem) {
    error = problem.message;
  }
  if (!error) ctx.saveFilters(values);
  const matching = hotels.filter(hotel => hotel.rooms.some(room => room.bookable)).length;
  const results = hotels.length ? hotels.map(hotel => hotelCard(hotel, values)).join("") :
    empty("没有符合条件的酒店", "可尝试调整城市、房型、价格或入住人数。");
  const body = `<div class="search-layout">
    ${card(`<form id="find-form"><div class="section-head"><h2>输入行程</h2>
      <button type="button" class="text-button" id="one-night">只查一晚</button></div>
      <div class="fields two">${field("city", "目的地 / 城市", values.city, "text", 'placeholder="例如 南京" maxlength="70"')}
      ${field("name", "酒店名称", values.name, "search", 'placeholder="选填" maxlength="70"')}</div>
      ${stayFields(values)}
      <div class="fields two">${field("room", "房型关键词", values.room, "search", 'placeholder="例如 大床，选填" maxlength="70"')}
      ${field("maximum", "每晚最高价（元）", values.maximum, "number", 'min="0" max="99999.99" step="0.01" placeholder="不限"')}</div>
      ${error ? banner("检查查询条件", error, "amber") : ""}
      ${formError()}${button("查询酒店和房态", "primary wide", 'type="submit"')}</form>`, "search-card")}
    <section id="results" aria-labelledby="results-title"><div class="section-head">
      <h2 id="results-title" tabindex="-1">${matching ? `找到 ${matching} 家可预订酒店` : "查询结果"}</h2>
      <span class="muted">${h(values.arrival)} 至 ${h(values.departure)}</span>
      <button class="text-button" id="edit-search" type="button">修改查询条件</button></div>
      ${error ? "" : results}
      <p class="hint">剩余量随订单实时变化。最终以提交时逐晚复核为准。</p>
    </section></div>`;
  if (!ctx.show("找一家合适的酒店", "选择入住和退房日期，查看每天的房型、余量和房价。", body)) return true;
  const form = document.querySelector("#find-form");
  bindDates(form);
  document.querySelector("#edit-search").addEventListener("click", () => {
    form.scrollIntoView({ block: "start" });
    form.elements.arrival.focus({ preventScroll: true });
  });
  form.querySelector("#one-night").addEventListener("click", () => {
    if (form.elements.arrival.value) form.elements.departure.value = shiftDate(form.elements.arrival.value, 1);
  });
  bindForm(form, async filters => {
    ctx.saveFilters(filters);
    sessionStorage.setItem("stay-focus-results", "1");
    ctx.go("/find", filters);
  });
  if (sessionStorage.getItem("stay-focus-results")) {
    sessionStorage.removeItem("stay-focus-results");
    if (!error) {
      const heading = document.querySelector("#results-title");
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: "start" });
    }
  }
  return true;
}

function hotelCard(hotel, values) {
  return card(`<div class="hotel-heading">${art(hotel.id % 2 === 0)}<div><h3>${h(hotel.name)}</h3>
      <p class="muted location">${icon("location")} ${h(hotel.city)} · ${h(hotel.address)}</p>
    </div></div>
    <ul class="room-summaries">${hotel.rooms.map(room => `<li><div><strong>${h(room.name)}</strong>
      <small>最多 ${room.capacity} 人 · ${room.bookable ? `剩 ${room.remaining} 间` :
        room.nights.length === 1 ? h(roomStates[room.nights[0].status]) : "部分日期不可订"}</small></div>
      <span><strong>${yuan(room.from_price)}</strong>${room.from_price !== null ?
        `<small>/ 晚${room.nights.length > 1 ? "起" : ""}</small>` : ""}</span></li>`).join("")}</ul>
    <div class="actions end">${link("查看房型和逐日房态", `/hotel/${hotel.id}`, dateParams(values), "primary")}</div>`, "hotel-card");
}

async function hotel(ctx, id) {
  const values = dateParams(ctx.filters(ctx.params));
  const item = await ctx.api(`/hotel/${id}`, values);
  const body = `${card(`<form id="stay-form"><div class="section-head"><h2>查看指定日期</h2>
    <span class="muted">每单一间房</span></div>
    ${stayFields(values, button("查看这段日期的房态", "primary", 'type="submit"'))}
    ${formError()}</form>`)}
    <div class="section-head"><h2>房型与逐日房态</h2><span class="muted">${h(stayText(values))}</span></div>
    <div class="room-grid">${item.rooms.map(room => card(`<div class="hotel-heading">${art(room.id % 2 === 0)}
      <div><h3>${h(room.name)}</h3><p class="muted">${h(room.bed)} · 最多 ${room.capacity} 人</p>
      ${bookingTag(room)}</div></div><p class="room-desc">${h(room.description)}</p>
      ${pricesTable(room.nights, { inventory: true, last: values.departure, total: room.total })}
      <div class="actions end">${room.bookable ?
        link("核对报价并预订", `/quote/${room.id}`, { ...values, hotel: item.id }, "primary") :
        button("此行程不可预订", "outline", 'type="button" disabled')}</div>`)).join("")}</div>
    ${item.rooms.length ? "" : empty("暂无在售房型", "可返回查询其他酒店。")}`;
  if (!ctx.show(item.name, `${item.city} · ${item.address} · ${item.phone}`, body, url("/find", ctx.filters()))) return true;
  const form = document.querySelector("#stay-form");
  bindDates(form);
  bindForm(form, async inputs => ctx.go(`/hotel/${id}`, inputs));
  return true;
}

function quoteSummary(offer) {
  return card(`<div class="hotel-heading">${art(offer.room.id % 2 === 0)}<div>
    <h2>${h(offer.room.hotel)}</h2><p>${h(offer.room.name)}</p>
    <p class="muted">${h(stayText(offer))}</p></div></div>`);
}

async function quotePage(ctx, id) {
  const values = dateParams(ctx.filters(ctx.params));
  let offer = await ctx.api(`/quote/${id}`, values);
  const roomUrl = url(`/hotel/${offer.room.hotel_id}`, values);
  const summary = body => `<div class="checkout-layout">
    <div>${quoteSummary(offer)}${card(`<h2>逐晚报价</h2><div id="price-block">
      ${pricesTable(offer.nights, { inventory: true, last: values.departure, total: offer.total })}
      </div>`)}</div><div>${body}</div></div>`;
  const form = card(`<form id="quote-form"><h2>入住人 / 联系人</h2>
    <div class="fields two">${field("contact", "联系人", "", "text", 'required maxlength="60" autocomplete="name"')}
    ${field("phone", "联系电话（选填）", "", "tel", 'maxlength="30" autocomplete="tel"')}</div>
    <details><summary>查看退改规则</summary><p>${h(offer.policy)}</p></details>
    <p class="hint">提交后进入待确认，由酒店处理。金额为本次住宿应付金额。</p>
    <p id="booking-key" class="hint" hidden></p>${formError()}
    ${button("确认报价并提交预订", "primary wide", 'type="submit"')}</form>`);
  if (!ctx.show("确认你的入住安排", "核对住宿安排、逐晚报价和联系人。", summary(form), roomUrl)) return true;
  bindForm(document.querySelector("#quote-form"), async (inputs, submit) => {
    const signature = JSON.stringify({ ...values, ...inputs, id });
    const old = readRequest(ctx.account.id);
    const current = old.signature === signature && old.pending ? old : {
      signature, key: crypto.randomUUID(), prices: offer.nights.map(row => row.price), pending: true,
    };
    writeRequest(ctx.account.id, current);
    const keyLabel = document.querySelector("#booking-key");
    keyLabel.textContent = "请求编号 " + current.key;
    keyLabel.hidden = false;
    const result = await ctx.api("/orders", {}, { ...values, ...inputs, room_id: id,
      key: current.key, prices: current.prices });
    writeRequest(ctx.account.id, { ...current, pending: false });
    if (result.kind === "booked") {
      ctx.message("已提交预订，等待酒店确认。");
      ctx.go(`/order/${result.id}`, { key: current.key });
    } else if (result.kind === "requote") {
      offer = result.quote;
      document.querySelector("#price-block").innerHTML = pricesTable(
        offer.nights, { inventory: true, last: values.departure, total: offer.total },
      );
      submit.textContent = "确认新报价并提交";
      throw new Error(result.message);
    } else {
      throw new Error(result.message);
    }
  });
  return true;
}

function orderSummary(row, path) {
  return card(`<div class="section-head"><h3>${h(row.hotel)}</h3>${statusBadge(row.status)}</div>
    <p>${h(row.room)} · ${row.guests} 人 / 1 间</p><p class="muted">${h(row.arrival)} 至 ${h(row.departure)}</p>
    <div class="actions spread"><small>${numberId("ST", row.id)}</small><strong>${yuan(row.total)}</strong>
    ${link("查看订单", path + row.id)}</div>`);
}

async function orders(ctx) {
  const selected = ctx.params.status || "";
  const rows = await ctx.api("/orders", { status: selected });
  const body = `<div class="section-head"><h2>订单列表</h2>${link("查询请求结果", "/request", {}, "quiet")}</div>
    ${tabs([["", "全部"], ...Object.entries(statuses)], "/orders", {}, "status", selected)}
    <div class="room-grid">${rows.map(row => orderSummary(row, "/order/")).join("")}</div>
    ${rows.length ? "" : empty("当前没有订单", "查询酒店并核对报价后，即可提交预订。",
      link("去找酒店", "/find", ctx.filters(), "primary"))}`;
  ctx.show("我的订单", "查看预订进度、住宿明细和退改申请。", body);
  return true;
}

function progress(state) {
  if (state === "cancelled") return banner("订单已取消", "可在下方查看取消原因。", "amber");
  const steps = Object.keys(statuses).slice(0, 4);
  return `<ol class="timeline" aria-label="订单进度">${steps.map((step, i) =>
    `<li class="${i <= steps.indexOf(state) ? "done" : ""}" ${step === state ? 'aria-current="step"' : ""}>
    <span class="dot">${step === state ? icon("check") : ""}</span>${h(statuses[step])}</li>`).join("")}</ol>`;
}

export function amendmentList(rows) {
  if (!rows.length) return '<p class="muted">暂无退改申请。</p>';
  return rows.map(entry => `<div class="record"><div class="section-head"><strong>
    ${entry.kind === "change" ? "改单" : "取消"}申请 #${entry.id}</strong>${badge(requestStates[entry.status])}</div>
    <p>${h(entry.reason)}</p>${entry.kind === "change" ? `<p class="muted">${h(entry.plan.room)} ·
      ${h(entry.plan.arrival)} 至 ${h(entry.plan.departure)} · ${yuan(entry.plan.total)}</p>` : ""}
    ${entry.resolution ? `<p class="muted">处理结果 · ${h(entry.resolution)}</p>` : ""}</div>`).join("");
}

export function stayRecords(rows) {
  return rows.map(row => kv(row.kind === "check_in" ? "实际入住" : "实际退房",
                            `${timeText(row.occurred)} · ${row.staff}`)).join("");
}

async function detail(ctx, id) {
  const order = await ctx.api(`/orders/${id}`);
  const actions = ["pending", "confirmed"].includes(order.status) ?
    `<div class="actions equal">${button("申请取消", "outline", 'type="button" id="cancel-order"')}
      ${link("申请改单", `/change/${id}`, {}, "primary")}</div>` : "";
  const body = `<div class="detail-column"><div class="section-head"><strong>${numberId("ST", id)}</strong>
    ${statusBadge(order.status)}</div>${progress(order.status)}
    ${card(`<h2>${h(order.hotel)}</h2><p>${h(order.room)}</p><p class="muted">${h(stayText(order))}</p>
      <dl>${kv("入住人 / 联系人", order.contact)}${order.phone ? kv("联系电话", order.phone) : ""}
      ${stayRecords(order.stays)}</dl>`)}
    ${card(`<h2>成交逐晚明细</h2>${pricesTable(order.nights, { last: order.departure, total: order.total })}
      <details><summary>成交时的退改规则</summary><p>${h(order.policy)}</p></details>`)}
    ${order.reason ? banner("取消原因", order.reason, "amber") : ""}${actions}
    ${card(`<h2>申请记录</h2>${amendmentList(order.amendments)}
      ${ctx.params.key ? `<p class="hint break">请求编号 ${h(ctx.params.key)}</p>` : ""}`)}</div>`;
  if (!ctx.show("我的订单", "查看住宿安排与处理进度。", body, url("/orders"))) return true;
  document.querySelector("#cancel-order")?.addEventListener("click", () => {
    ask("申请取消", textarea("reason", "申请原因"), async data => {
      await ctx.api(`/orders/${id}/cancel`, {}, data);
      ctx.message("取消申请已登记，原订单当前仍有效。");
      ctx.go(`/order/${id}`);
    }, "提交取消申请", banner("申请处理", "申请提交后由酒店按适用政策处理。"));
  });
  return true;
}

async function change(ctx, id) {
  const [order, rooms] = await Promise.all([ctx.api(`/orders/${id}`), ctx.api(`/orders/${id}/rooms`)]);
  const back = url(`/order/${id}`);
  if (!["pending", "confirmed"].includes(order.status)) {
    ctx.show("申请修改入住安排", "", empty("当前订单不可改单", "订单状态已经改变。"), back);
    return true;
  }
  const body = `<div class="detail-column">${card(`<div class="section-head"><h2>原方案 · ${numberId("ST", id)}</h2>
    ${statusBadge(order.status)}</div><p>${h(order.hotel)} · ${h(order.room)}</p>
    <p class="muted">${h(stayText(order))}</p><strong>${yuan(order.total)}</strong>`)}
    ${card(`<form id="change-form"><h2>新入住方案</h2>${stayFields(order)}
      ${select("room_id", "房型", rooms.map(r => [r.id, `${r.name}（最多 ${r.capacity} 人）`]), order.room_id)}
      <div class="fields two">${field("contact", "联系人", order.contact, "text", 'required maxlength="60"')}
      ${field("phone", "联系电话（选填）", order.phone, "tel", 'maxlength="30"')}</div>
      ${textarea("reason", "改单原因")}${formError()}${button("核对新报价", "primary wide", 'type="submit"')}</form>`)}
    <div id="change-price" aria-live="polite"></div>
    ${banner("原订单继续有效", "审批期间保留原订单和库存。审批失败时原订单保持有效。")}</div>`;
  if (!ctx.show("申请修改入住安排", "同一家酒店可调整日期、房型、人数和联系人。", body, back)) return true;
  const form = document.querySelector("#change-form");
  const result = document.querySelector("#change-price");
  bindDates(form);
  form.addEventListener("input", () => { result.replaceChildren(); });
  bindForm(form, async inputs => {
    const snapshot = JSON.stringify(inputs);
    const offer = await ctx.api(`/orders/${id}/quote`, { ...dateParams(inputs), room_id: inputs.room_id });
    if (snapshot !== JSON.stringify(Object.fromEntries(new FormData(form)))) return;
    const diff = (offer.difference < 0 ? "−" : "+") + yuan(Math.abs(offer.difference));
    result.innerHTML = card(`<form><h2>新方案报价</h2>${pricesTable(offer.nights, { total: offer.total })}
      <dl>${kv("与原订单差价", diff)}</dl>${formError()}
      ${button("确认报价并提交改单", "primary wide", 'type="submit"')}</form>`);
    bindForm(result.querySelector("form"), async () => {
      await ctx.api(`/orders/${id}/change`, {}, { ...inputs, prices: offer.nights.map(row => row.price) });
      ctx.message("改单申请已提交，等待酒店处理。");
      ctx.go(`/order/${id}`);
    });
    result.scrollIntoView({ block: "nearest" });
  });
  return true;
}

function requests(ctx) {
  const latest = readRequest(ctx.account.id);
  const body = card(`<form id="request-form"><h2>按请求编号查询</h2>
    ${field("key", "请求编号", latest.key || "", "text", 'required maxlength="100"')}
    ${formError()}${button("查询", "primary", 'type="submit"')}</form><div id="request-result"></div>`);
  if (!ctx.show("预订请求结果", "可核对断线或重复提交后的原处理结果。", body, url("/orders"))) return true;
  bindForm(document.querySelector("#request-form"), async inputs => {
    const result = await ctx.api("/request", inputs);
    document.querySelector("#request-result").innerHTML = result.kind === "booked" ?
      banner("已生成订单", numberId("ST", result.id)) + link("打开订单", `/order/${result.id}`) :
      banner(result.kind === "requote" ? "需要确认最新报价" : "预订未生效", result.message, "amber");
  });
  return true;
}

async function notices(ctx) {
  const items = await ctx.api("/notices");
  const body = items.length ? items.map(item => card(`<h2>${numberId("ST", item.order_id)}</h2>
    <p>${h(item.message)}</p>${link("查看订单", `/order/${item.order_id}`)}`)).join("") :
    empty("暂无通知", "有业务通知送达后，会在这里显示。");
  ctx.show("我的通知", "查看订单相关站内通知。", body);
  return true;
}

export function customer(ctx) {
  const [page, id] = ctx.parts;
  const handlers = { find, hotel, quote: quotePage, orders, order: detail, change, request: requests, notices };
  return Object.hasOwn(handlers, page) ? handlers[page](ctx, id) : false;
}
