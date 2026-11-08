/** Hotel operations and platform administration. */

import { amendmentList, stayRecords } from "./customer.js";
import {
  amountInput, ask, badge, banner, bindForm, button, card, check, empty, field, formError,
  h, kv, link, monday, monthDay, numberId, pricesTable, roomStates, select, shiftDate,
  statusBadge, statuses, tabs, textarea, timeText, url, yuan,
} from "./ui.js";

const closureStates = { pending: "待平台审批", approved: "已批准", rejected: "已拒绝" };
const isStaff = ctx => ctx.role === "staff";
const orderStates = [["", "全部"], ...Object.entries(statuses)];
const numeric = 'min="0" max="10000" required';
const priceField = 'min="0" max="99999.99" step="0.01" required';

function statusActions(row) {
  if (row.status === "pending") {
    return `${button("填写原因并拒绝", "outline", `data-action="refuse" data-id="${row.id}"`)}
      ${button("确认订单", "primary", `data-action="confirm" data-id="${row.id}"`)}`;
  }
  if (row.status === "confirmed") return button("办理入住", "primary", `data-action="check_in" data-id="${row.id}"`);
  if (row.status === "in_house") return button("办理退房", "outline", `data-action="check_out" data-id="${row.id}"`);
  return "";
}

function attachOrderActions(ctx) {
  const actions = {
    confirm: ["确认订单", "确认后沿用该订单已占用的全部房晚。"],
    refuse: ["拒绝订单", "拒绝后订单取消，库存会释放一次。"],
    check_in: ["办理入住", "核对身份后办理计划日期的入住。"],
    check_out: ["办理退房", "正常退房会保留已消费的历史房晚。"],
  };
  document.querySelectorAll("[data-action]").forEach(control => {
    control.addEventListener("click", () => {
      const { action, id } = control.dataset;
      const [title, detail] = actions[action];
      ask(title, action === "refuse" ? textarea("reason", "拒绝原因") : "", async data => {
        await ctx.api(`/orders/${id}/action`, {}, { ...data, action });
        ctx.message(title + "已保存。");
        ctx.go(ctx.path, ctx.params, true);
      }, title, banner(numberId("ST", id), detail));
    });
  });
}

async function work(ctx) {
  const filter = ctx.params.status || "";
  const rows = await ctx.api("/orders", { status: filter });
  const staff = isStaff(ctx);
  const pending = staff ? (await Promise.all(rows
    .filter(row => ["pending", "confirmed"].includes(row.status))
    .map(row => ctx.api(`/orders/${row.id}`))))
    .flatMap(row => row.amendments.filter(entry => entry.status === "pending")
      .map(entry => ({ ...entry, order: row.id }))) : [];
  const body = `${tabs(orderStates, "/work", {}, "status", filter)}
    <div class="room-grid">${rows.map(row => card(`<div class="section-head">
      <h2>${numberId("ST", row.id)}</h2>${statusBadge(row.status)}</div>
      <p>${h(row.hotel)} · ${h(row.room)} · ${row.guests} 人</p>
      <p class="muted">${h(row.arrival)} 至 ${h(row.departure)}</p>
      <div class="total"><span>总应付</span><strong>${yuan(row.total)}</strong></div>
      <div class="actions">${link("查看详情", `/order/${row.id}`)}${staff ? statusActions(row) : ""}</div>`)).join("")}</div>
    ${rows.length ? "" : empty("当前没有符合条件的订单", "提交新预订后，订单将出现在本店工作台。")}
    ${staff ? card(`<div class="section-head"><h2>待处理退改</h2>${badge(pending.length + " 条")}</div>
      ${pending.map(entry => `<div class="record actions spread"><strong>${numberId("ST", entry.order)}
      · ${entry.kind === "change" ? "改单申请" : "取消申请"}</strong>
      ${link("查看并处理", `/order/${entry.order}`)}</div>`).join("") || '<p class="muted">暂无待处理申请。</p>'}`) : ""}`;
  if (ctx.show(staff ? "订单工作台" : "全平台订单", staff ? ctx.account.hotel + " · 本店订单" : "查看全平台订单及状态。", body)) {
    attachOrderActions(ctx);
  }
  return true;
}

async function order(ctx, id) {
  const row = await ctx.api(`/orders/${id}`);
  const staff = isStaff(ctx);
  const requests = row.amendments.filter(entry =>
    entry.status === "pending" && (entry.kind === "change" || ctx.demo));
  const body = `<div class="detail-column">
    ${card(`<div class="section-head"><h2>${h(row.hotel)}</h2>${statusBadge(row.status)}</div>
      <dl>${kv("订单编号", numberId("ST", id))}${kv("房型", row.room)}
      ${kv("入住 / 退房", `${row.arrival} 至 ${row.departure}`)}${kv("人数", row.guests)}
      ${row.contact ? kv("联系人", row.contact) : ""}${row.phone ? kv("联系电话", row.phone) : ""}
      ${stayRecords(row.stays)}</dl>
      ${staff ? `<div class="actions">${statusActions(row)}</div>` : ""}`)}
    ${card(`<h2>成交逐晚明细</h2>${pricesTable(row.nights, { last: row.departure, total: row.total })}`)}
    ${row.reason ? banner("取消原因", row.reason, "amber") : ""}
    ${card(`<h2>退改申请</h2>${amendmentList(row.amendments)}
      ${staff ? requests.map(entry => `<div class="actions spread record"><span>
       申请 #${entry.id}</span>${button("处理申请", "primary", `data-amendment="${entry.id}"`)}</div>`).join("") : ""}
      ${!ctx.demo && row.amendments.some(entry => entry.kind === "cancel" && entry.status === "pending") ?
        '<p class="hint">正式取消处理政策待确认，当前申请已登记。</p>' : ""}`)}</div>`;
  if (!ctx.show("订单详情", numberId("ST", id), body, url("/work"))) return true;
  attachOrderActions(ctx);
  document.querySelectorAll("[data-amendment]").forEach(control => control.addEventListener("click", () => {
    const entry = requests.find(item => item.id === Number(control.dataset.amendment));
    ask("处理申请", select("approve", "处理结果", [["yes", "批准"], ["no", "拒绝"]], "yes") +
      textarea("note", "处理原因"), async data => {
      await ctx.api(`/amendments/${entry.id}`, {}, { approve: data.approve === "yes", note: data.note });
      ctx.message("申请处理结果已保存。");
      ctx.go(ctx.path, {}, true);
    }, "保存处理结果", amendmentList([entry]));
  }));
  return true;
}

async function rooms(ctx) {
  if (!isStaff(ctx)) return false;
  const hotel = await ctx.api("/manage");
  const body = `<div class="checkout-layout"><div>
    ${card(`<div class="section-head"><h2>酒店资料</h2>${badge(hotel.approved ? "审核通过" : "待审核", hotel.approved ? "" : "amber")}</div>
    <dl>${kv("酒店名称", hotel.name)}${kv("城市与地址", `${hotel.city} · ${hotel.address}`)}
    ${kv("联系方式", hotel.phone)}</dl>${button("编辑酒店资料", "outline", 'id="edit-hotel"')}`)}
    ${banner("酒店审核", "资料通过平台审核后可接受预订。房型停用后仍保留历史订单关联。")}
    </div><div><div class="section-head"><h2>本店房型</h2>${button("新增房型", "primary", 'data-room="0"')}</div>
    ${hotel.rooms.map(room => card(`<div class="section-head"><h3>${h(room.name)}</h3>
      ${badge(room.active ? "在售" : "已停用", room.active ? "" : "amber")}</div>
      <p class="muted">${h(room.bed)} · 最多 ${room.capacity} 人</p><p>${h(room.description)}</p>
      <div class="actions end">${link("查看房态", "/inventory", { room: room.id })}${button("编辑房型", "outline", `data-room="${room.id}"`)}</div>`)).join("")}</div></div>`;
  if (!ctx.show("酒店与房型", hotel.name + " · 本店资料", body)) return true;
  document.querySelector("#edit-hotel").addEventListener("click", () => ask("编辑酒店资料", [
    ["name", "酒店名称"], ["city", "城市"], ["address", "地址"], ["phone", "联系方式"],
  ].map(([key, label]) => field(key, label, hotel[key], "text", 'required maxlength="120"')).join(""),
  async data => {
    await ctx.api(`/hotels/${hotel.id}`, {}, data);
    ctx.message("酒店资料已保存。");
    ctx.go("/rooms", {}, true);
  }));
  document.querySelectorAll("[data-room]").forEach(control => control.addEventListener("click", () => {
    const id = Number(control.dataset.room);
    const room = hotel.rooms.find(item => item.id === id) || { capacity: 2, active: true };
    const inputs = field("name", "房型名称", room.name, "text", 'required maxlength="120"') +
      field("bed", "床型", room.bed, "text", 'required maxlength="120"') +
      field("capacity", "人数上限", room.capacity, "number", 'min="1" max="20" required') +
      textarea("description", "房型介绍", room.description, false) +
      check("active", "启用该房型", room.active);
    ask(id ? "编辑房型" : "新增房型", inputs, async data => {
      await ctx.api(`/rooms/${id}`, {}, { ...data, active: data.active === "on" });
      ctx.message("房型已保存。");
      ctx.go("/rooms", {}, true);
    });
  }));
  return true;
}

async function inventory(ctx) {
  if (!isStaff(ctx)) return false;
  const hotel = await ctx.api("/manage");
  if (!hotel.rooms.length) {
    ctx.show("房态日历", hotel.name, empty("请先新增房型", "创建房型后可配置每日房态。", link("管理房型", "/rooms")));
    return true;
  }
  const roomId = Number(ctx.params.room) || hotel.rooms[0].id;
  const selected = ctx.params.day || ctx.today;
  const start = ctx.params.week || monday(selected);
  const rows = await ctx.api(`/inventory/${roomId}`, { start });
  const current = rows.find(item => item.day === selected) || rows[0];
  const end = rows.at(-1).day;
  const body = `${card(`<form id="calendar-form"><div class="fields two">
    ${select("room", "房型", hotel.rooms.map(room => [room.id, room.name]), roomId)}
    ${field("day", "跳转日期", selected, "date", "required")}</div>${formError()}
    ${button("查看该周", "outline", 'type="submit"')}</form>`)}
    ${card(`<div class="section-head"><h2>${monthDay(start)} – ${monthDay(end)}</h2><div class="actions">
      ${link("‹ 上一周", "/inventory", { room: roomId, day: shiftDate(start, -7) }, "quiet")}
      ${link("下一周 ›", "/inventory", { room: roomId, day: shiftDate(start, 7) }, "quiet")}</div></div>
      <div class="calendar">${rows.map((row, i) => `<a class="date-tile ${row.day === current.day ? "active" : ""}"
        href="${url("/inventory", { room: roomId, day: row.day, week: start })}"
        ${row.day === current.day ? 'aria-current="date"' : ""} aria-label="${row.day} ${roomStates[row.status]}">
        <small>周${"一二三四五六日"[i]}</small><strong>${row.day.slice(-2)}</strong><span>${yuan(row.price)}</span>
        <small>${row.status === "available" ? `余 ${row.remaining} 间` : roomStates[row.status]}</small></a>`).join("")}</div>`)}
    ${card(`<form id="inventory-form"><div class="section-head"><h2>${monthDay(current.day)} · 房态设置</h2>
      ${badge(roomStates[current.status], current.status === "available" ? "" : "amber")}</div>
      <dl>${kv("已占用 / 已消费", `${current.occupied} 间`)}${kv("当前物理余量", `${current.remaining} 间`)}</dl>
      <div class="fields two">${field("total", "可售总量", current.total ?? 0, "number", numeric)}
      ${field("price", "当晚售价（元）", current.price == null ? "" : amountInput(current.price), "number", priceField)}</div>
      ${check("stopped", "当日停售", current.stopped)}${formError()}${button("保存当日房态", "primary wide", 'type="submit"')}</form>`)}
    ${banner("库存校验", `可售总量不能低于已占用和已消费的 ${current.occupied} 间。停售只影响新订单。`)}`;
  if (!ctx.show("房态日历", hotel.name + " · 按房型逐日查看和维护", body)) return true;
  bindForm(document.querySelector("#calendar-form"), async data => ctx.go("/inventory", data));
  bindForm(document.querySelector("#inventory-form"), async data => {
    await ctx.api(`/inventory/${roomId}`, {}, { ...data, value: current.day, stopped: data.stopped === "on" });
    ctx.message("当日房态已保存，顾客查询会显示新数据。");
    ctx.go("/inventory", { room: roomId, day: current.day, week: start }, true);
  });
  return true;
}

async function review(ctx) {
  if (isStaff(ctx)) return false;
  const all = await ctx.api("/hotels");
  const selected = ctx.params.status || "pending";
  const hotels = all.filter(item => Boolean(item.approved) === (selected === "approved"));
  const body = `${tabs([["pending", "待审核"], ["approved", "已审核"]], "/review", {}, "status", selected)}
    <div class="room-grid">${hotels.map(hotel => card(`<div class="section-head"><h2>${h(hotel.name)}</h2>
      ${badge(hotel.approved ? "已通过" : "待审核", hotel.approved ? "" : "amber")}</div>
      <dl>${kv("城市", hotel.city)}${kv("地址", hotel.address)}${kv("联系方式", hotel.phone)}
      ${kv("提交时间", timeText(hotel.submitted))}${kv("预订状态", hotel.approved ? "可接受预订" : "不可预订")}</dl>
      ${hotel.approved ? `<p class="muted">审核意见 · ${h(hotel.review_note)}</p>` :
        `<form data-hotel="${hotel.id}">${textarea("note", "审核意见")}${formError()}
        ${button("审核通过", "primary wide", 'type="submit"')}</form>`}`)).join("")}</div>
    ${hotels.length ? "" : empty("当前列表没有酒店", "可以切换到其他审核状态。")}
    ${banner("审核条件", "资料审核通过后，顾客方可预订。具体驳回和重新提交规则待确认。")}`;
  if (!ctx.show("酒店资料审核", "查看酒店资料并记录审核结果。", body)) return true;
  document.querySelectorAll("[data-hotel]").forEach(form => bindForm(form, async data => {
    await ctx.api(`/hotels/${form.dataset.hotel}/approve`, {}, data);
    ctx.message("审核通过，酒店已具备预订准入资格。");
    ctx.go("/review", ctx.params, true);
  }));
  return true;
}

async function closures(ctx) {
  const staff = isStaff(ctx);
  const rows = await ctx.api("/closures");
  const form = staff ? card(`<form id="closure-form"><h2>填写停业区间</h2><div class="fields two">
    ${field("start", "开始日期（含）", ctx.today, "date", "required")}
    ${field("end", "结束日期（含）", ctx.today, "date", "required")}</div>
    ${textarea("reason", "停业原因")}<dl>${kv("影响范围", "本店全部房型")}</dl>${formError()}
    ${button("提交停业申请", "primary wide", 'type="submit"')}</form>`) : "";
  const body = `${form}${staff ? banner("生效规则", "审批通过后仅限制区间内的新预订。已有订单进入影响清单。") : ""}
    <div class="section-head"><h2>${staff ? "最近申请" : "停业申请列表"}</h2></div>
    <div class="room-grid">${rows.map(row => card(`<div class="section-head"><h3>${numberId("CL", row.id)}</h3>
      ${badge(closureStates[row.status], row.status === "pending" ? "amber" : "")}</div>
      <p>${h(row.hotel)} · ${h(row.reason)}</p><p class="muted">${h(row.start)} 至 ${h(row.end)}（含）</p>
      <div class="actions end">${link("查看申请与受影响订单", `/closure/${row.id}`)}</div>`)).join("")}</div>
    ${rows.length ? "" : empty("暂无停业申请", "酒店提交申请后，可查看审批和处理结果。")}`;
  if (!ctx.show(staff ? "申请临时停业" : "停业审批", staff ? ctx.account.hotel + " · 由平台审批" : "查看停业申请与受影响订单。", body)) return true;
  if (staff) bindForm(document.querySelector("#closure-form"), async data => {
    const item = await ctx.api("/closures", {}, data);
    ctx.message("停业申请已提交。");
    ctx.go(`/closure/${item.id}`);
  });
  return true;
}

async function closure(ctx, id) {
  const row = await ctx.api(`/closures/${id}`);
  const filter = ctx.params.status || "";
  const states = ["pending", "confirmed", "in_house"];
  const affected = row.orders.filter(item => !filter || item.status === filter);
  const body = `<div class="detail-column">${card(`<div class="section-head"><h2>${h(row.hotel)}</h2>
    ${badge(closureStates[row.status], row.status === "pending" ? "amber" : "")}</div>
    <dl>${kv("停业区间", `${row.start} 至 ${row.end}（含）`)}${kv("停业原因", row.reason)}
    ${row.note ? kv("审核意见", row.note) : ""}</dl>
    ${!isStaff(ctx) && row.status === "pending" ? `<form id="closure-review">${textarea("note", "审核意见")}
    ${formError()}<div class="actions equal">${button("拒绝申请", "outline", 'type="submit" value="reject"')}
    ${button("批准停业", "primary", 'type="submit" value="approve"')}</div></form>` : ""}`)}
    <h2>受影响订单</h2>
    ${tabs([["", `全部 ${row.orders.length}`], ...states.map(state =>
      [state, `${statuses[state]} ${row.orders.filter(item => item.status === state).length}`])],
      `/closure/${id}`, {}, "status", filter)}
    ${affected.map(item => card(`<div class="section-head"><h3>${numberId("ST", item.id)}</h3>${statusBadge(item.status)}</div>
      <p>${h(item.room)} · ${h(item.arrival)} 至 ${h(item.departure)}</p><p class="muted">影响住宿日 · ${h(item.affected)}</p>
      <div class="actions">${link("查看订单", `/order/${item.id}`)}${button("登记处置", "outline", `data-note="${item.id}"`)}</div>`)).join("")}
    ${affected.length ? "" : empty("该筛选下没有受影响订单", "可切换状态核对其他订单。")}
    ${card(`<h2>处置记录</h2>${row.notes.map(note => `<div class="record"><strong>${numberId("ST", note.order_id)}</strong>
      <p>${h(note.note)}</p><p class="muted">${h(note.staff)} · ${h(timeText(note.created))}</p></div>`).join("")
      || '<p class="muted">暂无记录。</p>'}`)}
    ${banner("存量订单", "批准停业不会自动取消已有订单或强制退房。具体处置政策待确认。")}</div>`;
  if (!ctx.show(isStaff(ctx) ? "停业申请详情" : "停业审批", numberId("CL", id), body, url("/closures"))) return true;
  const form = document.querySelector("#closure-review");
  if (form) bindForm(form, async (data, submit) => {
    await ctx.api(`/closures/${id}/review`, {}, { ...data, approve: submit?.value === "approve" });
    ctx.message("停业审批结果已保存。");
    ctx.go(ctx.path, ctx.params, true);
  });
  document.querySelectorAll("[data-note]").forEach(control => control.addEventListener("click", () => {
    ask("登记处置记录", textarea("note", "处置情况"), async data => {
      await ctx.api(`/closures/${id}/notes`, {}, { ...data, order_id: control.dataset.note });
      ctx.message("处置记录已保存。");
      ctx.go(ctx.path, ctx.params, true);
    }, "保存记录");
  }));
  return true;
}

async function statistics(ctx) {
  const hotels = await ctx.api("/hotels");
  const staff = isStaff(ctx);
  const values = { start: ctx.today, end: shiftDate(ctx.today, 7), hotel_id: "0", ...ctx.params };
  const choices = hotels.map(hotel => [hotel.id, hotel.name]);
  if (!staff) choices.unshift(["0", "授权范围内全部酒店"]);
  if (staff) values.hotel_id = ctx.account.hotel_id;
  const body = `${card(`<form id="stats-form"><h2>查询范围</h2>
    ${select("hotel_id", "酒店范围", choices, values.hotel_id)}<div class="fields two">
    ${field("start", "开始日期（含）", values.start, "date", "required")}
    ${field("end", "结束日期（不含）", values.end, "date", "required")}</div>${formError()}
    ${button("查询统计", "primary wide", 'type="submit"')}</form>`)}
    ${card('<h2>指标预览</h2><dl id="stats-result">' + kv("订单量", "—") + kv("入住率", "—") + kv("住宿金额", "—") + '</dl>')}
    ${banner("统计口径待确认", "正式计算公式、角色授权和入住率口径待确认。演示住宿金额不等于实际到账。", "amber")}`;
  if (!ctx.show("业务统计", "授权范围内的只读查询。", body)) return true;
  bindForm(document.querySelector("#stats-form"), async data => {
    const item = await ctx.api("/stats", data);
    document.querySelector("#stats-result").innerHTML = item.demo ?
      kv("订单量（演示）", item.counts.reduce((sum, row) => sum + row.amount, 0)) + kv("入住率", "—") +
      kv("住宿金额（演示）", yuan(item.amount)) + kv("已消费房晚", item.nights) +
      item.counts.map(row => kv(statuses[row.status], row.amount)).join("") :
      kv("订单量", "待确认") + kv("入住率", "待确认") + kv("住宿金额", "待确认");
  });
  return true;
}

async function audit(ctx) {
  const query = ctx.params.query || "";
  const [logs, notices] = await Promise.all([ctx.api("/logs", { query }), ctx.api("/notices")]);
  const body = `<div class="checkout-layout"><div>${card(`<h2>操作日志</h2>
    <form id="audit-form">${field("query", "按操作代码或目标编号筛选", query, "search", 'maxlength="100"')}
    ${formError()}${button("查询日志", "outline", 'type="submit"')}</form>
    ${logs.map(row => `<div class="record"><div class="section-head"><strong>${h(row.action)}</strong>
      ${badge(row.result === "ok" ? "成功" : "失败 / 拒绝", row.result === "ok" ? "" : "amber")}</div>
      <p class="muted">${h(timeText(row.created))} · ${h(row.actor)} · ${h(row.target)}</p>
      <p>${h(row.detail)}</p></div>`).join("") || '<p class="muted">暂无符合条件的记录。</p>'}`)}</div>
    <div><h2>通知投递记录</h2>${notices.map(row => card(`<div class="section-head"><h3>${numberId("ST", row.order_id)}</h3>
      ${badge({ pending: "待投递", failed: "投递失败", sent: "已送达" }[row.status], row.status === "failed" ? "amber" : "")}</div>
      <p>${h(row.message)}</p><p class="muted">投递尝试 ${row.attempts} 次 · ${h(row.detail || "等待处理")}</p>
      ${ctx.role === "admin" && ctx.demo && row.status !== "sent" ? `<div class="actions">
        ${button("模拟失败", "outline", `data-notice="${row.id}" data-fail="yes"`)}
        ${button("投递 / 重试", "primary", `data-notice="${row.id}"`)}</div>` : ""}`)).join("")
      || empty("暂无通知记录", "业务通知送达或失败后将在此显示。")}
    ${banner("订单状态", "通知投递失败不会回滚已生效的取消。审计日志为只读。")}</div></div>`;
  if (!ctx.show("通知与审计", "按授权范围查看业务操作与投递结果。", body)) return true;
  bindForm(document.querySelector("#audit-form"), async data => ctx.go("/audit", data));
  document.querySelectorAll("[data-notice]").forEach(control => control.addEventListener("click", () => {
    const fail = control.dataset.fail === "yes";
    ask(fail ? "模拟投递失败" : "投递或重试", "", async () => {
      const result = await ctx.api(`/notices/${control.dataset.notice}`, {}, { fail });
      ctx.message(result.status === "sent" ? "演示通知已送达。" : "失败已记录，可以再次重试。");
      ctx.go("/audit", ctx.params, true);
    }, "确认");
  }));
  return true;
}

export function workbench(ctx) {
  const [page, id] = ctx.parts;
  const handlers = { work, order, rooms, inventory, review, closures, closure, statistics, audit };
  return Object.hasOwn(handlers, page) ? handlers[page](ctx, id) : false;
}
