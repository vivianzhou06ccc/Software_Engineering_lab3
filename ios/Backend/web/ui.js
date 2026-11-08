/** Shared display, navigation and form helpers. */

export const statuses = {
  pending: "待确认", confirmed: "已确认", in_house: "已入住", completed: "已退房", cancelled: "已取消",
};
export const roomStates = {
  available: "可预订", sold_out: "已售罄", stopped: "停售", closed: "酒店临时停业", unconfigured: "未发布房态",
};
export const requestStates = {
  pending: "待处理", approved: "已批准", rejected: "已拒绝", invalid: "已失效",
};
export const roleNames = { guest: "顾客", staff: "酒店工作台", admin: "平台管理端" };
const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const h = value => String(value ?? "").replace(/[&<>"']/g, symbol => entities[symbol]);
export const yuan = value => value == null ? "—" :
  `¥${(value / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
export const amountInput = value => (value / 100).toFixed(2);
export const numberId = (prefix, id) => `${prefix}-${String(id).padStart(6, "0")}`;
export const timeText = value => new Date(value).toLocaleString("zh-CN", { hour12: false });
export const monthDay = value => value.slice(5).replace("-", "月") + "日";

export function shiftDate(value, offset) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function monday(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return shiftDate(value, -(date.getUTCDay() + 6) % 7);
}

const icons = {
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  orders: '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',
  calendar: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 4v4m8-4v4M4 10h16"/>',
  hotel: '<path d="M5 20V5h14v15M3 20h18M9 9h1m4 0h1m-6 4h1m4 0h1m-4 7v-3h2v3"/>',
  lock: '<rect x="6" y="10" width="12" height="10" rx="2"/><path d="M8 10V8a4 4 0 1 1 8 0v2m-4 4v2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  stats: '<path d="M5 19h14M8 16v-4m4 4V6m4 10V9"/>',
  bell: '<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 20h4"/>',
  arrow: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  location: '<path d="M19 10c0 5-7 10-7 10s-7-5-7-10a7 7 0 1 1 14 0z"/><circle cx="12" cy="10" r="2"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5m0-8v1"/>',
  bed: '<path d="M4 19V7m16 12v-7H4m0 4h16M7 12V9h5v3m2 0V9h4l2 3"/>',
};

export function icon(name, className = "") {
  return `<svg class="icon ${h(className)}" aria-hidden="true" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
      ${icons[name] || icons.info}</svg>`;
}

export function art(twin = false) {
  const beds = twin ? [[17, 32], [53, 32]] : [[18, 65]];
  return `<svg class="room-art" aria-hidden="true" viewBox="0 0 104 90">
    <rect width="104" height="90" rx="12" fill="${twin ? "#e3ead9" : "#eee6d6"}"/>
    <path d="M0 65 41 44l63 15v31H0z" fill="${twin ? "#d9e3ce" : "#e8dbc1"}"/>
    <path d="M64 13h21v24H64z" fill="#fff9df" stroke="#b5ac8a"/>
    <path d="M74.5 13v24M64 25h21" stroke="#b5ac8a"/>
    <path d="M11 64V37m81 34v-9" stroke="#98846c" stroke-width="3"/>
    ${beds.map(([x,w]) => `<rect x="${x}" y="42" width="${w}" height="30" rx="5" fill="#fffdf0" stroke="#b1a38a"/>
      <path d="M${x + 3} 54h${w - 6}v14h-${w - 6}z" fill="#6b8875"/>
      <rect x="${x + 5}" y="46" width="${w - 10}" height="6" rx="2" fill="#ffffff"/>`).join("")}
    </svg>`;
}

export function url(path, params = {}) {
  const values = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "" && value != null));
  return `#${path}${values.size ? "?" + values : ""}`;
}

export function button(label, style = "primary", attrs = "") {
  return `<button class="button ${style}" ${attrs}>${h(label)}</button>`;
}

export function link(label, path, params = {}, style = "outline") {
  return `<a class="button ${style}" href="${h(url(path, params))}">${h(label)}</a>`;
}

export function badge(text, tone = "") {
  return `<span class="badge ${tone}">${h(text)}</span>`;
}

export function statusBadge(value) {
  return badge(statuses[value], value === "pending" ? "amber" : value === "cancelled" ? "neutral" : "");
}

export function card(content, className = "") {
  return `<section class="card ${className}">${content}</section>`;
}

export function banner(title, text, tone = "") {
  return `<aside class="banner ${tone}">${icon("info")}<div><strong>${h(title)}</strong><p>${h(text)}</p></div></aside>`;
}

export function kv(label, value) {
  return `<div class="kv"><dt>${h(label)}</dt><dd>${h(value)}</dd></div>`;
}

export function empty(title, text, extra = "") {
  return card(`<div class="empty">${icon("info")}<h2>${h(title)}</h2><p>${h(text)}</p>${extra}</div>`);
}

export function field(name, title, value = "", type = "text", attrs = "") {
  return `<label class="field"><span>${h(title)}</span><input type="${type}" name="${h(name)}"
    value="${h(value)}" ${attrs}></label>`;
}

export function select(name, title, options, value) {
  return `<label class="field"><span>${h(title)}</span><select name="${h(name)}">
    ${options.map(([key, text]) => `<option value="${h(key)}" ${String(key) === String(value) ? "selected" : ""}>${h(text)}</option>`).join("")}
    </select></label>`;
}

export function textarea(name, title, value = "", required = true) {
  return `<label class="field"><span>${h(title)}</span><textarea name="${h(name)}"
    maxlength="400" rows="3" ${required ? "required" : ""}>${h(value)}</textarea></label>`;
}

export function check(name, title, enabled) {
  return `<label class="switch"><input type="checkbox" name="${name}" ${enabled ? "checked" : ""}>
    <span>${h(title)}</span></label>`;
}

export function tabs(options, path, params, name, value) {
  return `<div class="chips" aria-label="状态筛选">${options.map(([key, text]) =>
    `<a href="${h(url(path, { ...params, [name]: key }))}" class="chip ${key === value ? "active" : ""}"
      ${key === value ? 'aria-current="true"' : ""}>${h(text)}</a>`).join("")}</div>`;
}

export function formError() {
  return '<p class="form-error" role="alert" hidden></p>';
}

export function formValues(form) {
  return Object.fromEntries(new FormData(form));
}

export function bindForm(form, action) {
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = event.submitter;
    const error = form.querySelector(".form-error");
    if (error) error.hidden = true;
    if (submit) submit.disabled = true;
    try {
      await action(formValues(form), submit, form);
    } catch (problem) {
      if (!error) throw problem;
      error.textContent = problem.message;
      error.hidden = false;
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

export function bindDates(form, first = "arrival", last = "departure") {
  const start = form.elements[first];
  const end = form.elements[last];
  function setEnd(update = false) {
    if (!start.value) return;
    const next = shiftDate(start.value, 1);
    end.min = next;
    if (update && (!end.value || end.value < next)) end.value = next;
  }
  setEnd();
  start.addEventListener("change", () => setEnd(true));
}

export function ask(title, fields, action, label = "确认提交", intro = "") {
  const dialog = document.querySelector("#dialog");
  if (dialog.open) dialog.close();
  dialog.innerHTML = `<form><h2 id="dialog-title">${h(title)}</h2>${intro}
    ${fields}${formError()}<div class="actions">${button("返回", "outline", 'type="button" data-close')}
    ${button(label, "primary", 'type="submit"')}</div></form>`;
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  bindForm(dialog.querySelector("form"), async (data, submit) => {
    await action(data, submit);
    dialog.close();
  });
  dialog.showModal();
}

export function pricesTable(rows, { inventory = false, last = "", total = null } = {}) {
  return `<div class="table-wrap"><table><thead><tr><th scope="col">住宿日</th>
    ${inventory ? '<th scope="col">剩余</th>' : ""}<th scope="col">每间 / 晚</th></tr></thead>
    <tbody>${rows.map(row => `<tr><td><time datetime="${h(row.day)}">${h(row.day)}</time></td>
    ${inventory ? `<td>${row.status === "available" ? h(row.remaining) + " 间" : h(roomStates[row.status])}</td>` : ""}
    <td>${yuan(row.price)}</td></tr>`).join("")}</tbody></table></div>
    ${last ? `<p class="hint">${h(last)} 退房，当天不计费。</p>` : ""}
    ${total !== null ? `<div class="total"><span>总应付</span><strong>${yuan(total)}</strong></div>` : ""}`;
}
