/** Local application shell, role switching, history and request handling. */

import { customer } from "./customer.js";
import { workbench } from "./workbench.js";
import { badge, empty, h, icon, roleNames, shiftDate, url } from "./ui.js";

const shell = document.querySelector("#shell");
const bottom = document.querySelector("#bottom");
const main = document.querySelector("main");
const flash = document.querySelector("#flash");
const entries = {
  guest: [["/find", "找酒店", "search"], ["/orders", "我的订单", "orders"], ["/notices", "通知", "bell"]],
  staff: [["/work", "订单工作台", "orders"], ["/inventory", "房态日历", "calendar"],
          ["/rooms", "酒店与房型", "hotel"], ["/closures", "停业申请", "lock"],
          ["/statistics", "本店统计", "stats"], ["/audit", "通知与审计", "bell"]],
  admin: [["/review", "酒店审核", "check"], ["/closures", "停业审批", "lock"],
          ["/statistics", "业务统计", "stats"], ["/audit", "通知与审计", "bell"],
          ["/work", "全平台订单", "orders"]],
};

let session;
let revision = 0;
let flashTimeout;
const filtersKey = "stay-search";

async function api(path, query = {}, data) {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value != null));
  let response;
  try {
    response = await fetch(`/api${path}${params.size ? "?" + params : ""}`, data === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Stay-Request": "1" },
      body: JSON.stringify(data),
    });
  } catch {
    const error = new Error("连接中断。请检查本地服务。提交过订单时可用原请求编号查询结果或重试。");
    error.code = "network";
    throw error;
  }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.message);
    error.code = result.error;
    throw error;
  }
  return result;
}

function message(text) {
  flash.textContent = text;
  flash.hidden = false;
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => { flash.hidden = true; }, 6500);
}

function go(path, params = {}, replace = false) {
  const target = url(path, params);
  if (replace || target === location.hash) {
    history.replaceState(null, "", target);
    render();
  } else {
    location.hash = target;
  }
}

function routing() {
  const raw = location.hash.slice(1);
  const [path, query = ""] = raw.split("?");
  return { path, parts: path.split("/").filter(Boolean), params: Object.fromEntries(new URLSearchParams(query)) };
}

function pageGroup(path, role) {
  if (/^\/(hotel|quote)/.test(path)) return "/find";
  if (/^\/(order|change|request)/.test(path)) return role === "guest" ? "/orders" : "/work";
  if (path.startsWith("/closure")) return "/closures";
  return path;
}

function header(path) {
  const role = session.account.role;
  const roleEntries = entries[role];
  const group = pageGroup(path, role);
  const navigation = ([href, label, glyph]) =>
    `<a href="${href === "/find" ? url(href, filters()) : url(href)}" class="${group === href ? "selected" : ""}"
      ${group === href ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${h(label)}</span></a>`;
  shell.className = role === "guest" ? "shell" : "shell dark";
  shell.innerHTML = `<div class="shell-inner"><a class="brand" href="${url(roleEntries[0][0])}">
    <span class="brand-mark">栖</span><span>栖居 <small>STAY</small></span></a>
    <nav class="wide-nav" aria-label="主导航">${roleEntries.map(navigation).join("")}</nav>
    <label class="profile"><span>演示身份</span><select aria-label="切换演示身份">
    ${session.profiles.map(user => `<option value="${user.id}" ${user.id === session.account.id ? "selected" : ""}>
      ${h(user.name)} / ${h(roleNames[user.role])}</option>`).join("")}</select></label></div>`;
  shell.querySelector("select").addEventListener("change", async event => {
    const selector = event.currentTarget;
    selector.disabled = true;
    try {
      session = await api("/session", {}, { id: selector.value });
      flash.hidden = true;
      go(entries[session.account.role][0][0], {}, true);
    } catch (error) {
      message(error.message);
      selector.value = session.account.id;
      selector.disabled = false;
    }
  });
  bottom.innerHTML = roleEntries.map(navigation).join("");
}

function filters(params = {}) {
  const saved = JSON.parse(sessionStorage.getItem(filtersKey) || "{}");
  return {
    city: "南京", arrival: session.today, departure: shiftDate(session.today, 1),
    guests: "2", name: "", room: "", maximum: "", ...saved, ...params,
  };
}

function saveFilters(values) {
  sessionStorage.setItem(filtersKey, JSON.stringify(values));
}

async function render() {
  const page = routing();
  const current = ++revision;
  const role = session.account.role;
  header(page.path);
  window.scrollTo(0, 0);
  main.innerHTML = '<p class="loading" role="status">正在读取…</p>';
  const context = {
    ...page, ...session, role, api, go, message, filters, saveFilters,
    show(title, description, body, back = "") {
      if (current !== revision) return false;
      document.title = title + " · 栖居 STAY";
      main.innerHTML = `<section class="hero ${role === "guest" ? "" : "dark"}"><div class="hero-inner">
        ${back ? `<a class="back" href="${h(back)}">${icon("arrow")} 返回</a>` : ""}
        <p class="eyebrow">栖居 STAY  /  ${h(roleNames[role])} ${session.demo ? badge("演示政策", "neutral") : ""}</p>
        <h1>${h(title)}</h1>${description ? `<p class="subtitle">${h(description)}</p>` : ""}
        </div></section><div class="page">${body}</div>`;
      return true;
    },
  };
  try {
    if (!page.parts.length) {
      go(entries[role][0][0], {}, true);
      return;
    }
    const visible = role === "guest" ? await customer(context) : await workbench(context);
    if (!visible && current === revision) go(entries[role][0][0], {}, true);
  } catch (error) {
    context.show("暂时无法打开此页面", "", empty("读取失败", error.message),
                 url(entries[role][0][0]));
  }
}

window.addEventListener("hashchange", () => { if (session) render(); });
document.querySelector(".skip").addEventListener("click", event => {
  event.preventDefault();
  main.focus();
});
try {
  session = await api("/session");
  render();
} catch (error) {
  main.innerHTML = empty("无法连接栖居 STAY", error.message);
}
