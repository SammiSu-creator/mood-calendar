/**
 * 日历渲染：复刻 iOS 相册「按日浏览」
 * 7 列圆形网格，照片作圆圈背景，日期数字压左下角
 */

import { db, cache, fmt } from './db.js';
import { blobImage } from './image.js';
import { MOODS } from './moods.js';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

/** 状态 */
export const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(), // 0-11
  // today 不是快照，而是每次访问都重新计算的 getter。
  // 之前这里存的是模块加载那一刻的日期字符串，
  // 页面跨过零点后再点「记录今天」，会把新记录静默写进昨天并覆盖掉旧记录。
  get today() {
    return fmt(new Date());
  },
  view: 'day', // 'day' | 'month'
  detailDate: null,
  // 当前年份是不是用户自己从下拉列表选的？
  // 用来区分「用户主动选了没数据的年份」和「程序漂移到了没数据的年份」——
  // 前者必须尊重，后者才需要拉回有数据的年份。
  yearPinned: false,
};

/** 事件回调，由 app.js 注入 */
export const handlers = {
  onOpenDetail: () => {},
  onChangeYear: () => {},
};

/* ---------------- 月份条 ---------------- */

export function renderMonthBar(container) {
  container.innerHTML = '';
  const now = new Date();
  MONTH_NAMES.forEach((name, i) => {
    const btn = document.createElement('button');
    btn.className = 'monthbar__item';
    btn.textContent = name;
    const isCurrentMonth = i === now.getMonth() && state.year === now.getFullYear();
    if (i === state.month) {
      btn.classList.add('monthbar__item--active');
    } else if (!isCurrentMonth) {
      btn.classList.add('monthbar__item--muted');
    }
    btn.addEventListener('click', () => {
      state.month = i;
      renderAll();
      scrollToMonth(i, 'smooth');
    });
    container.appendChild(btn);
  });

  // 让当前选中的月份在横条里可见，否则打开页面看不到高亮在哪
  requestAnimationFrame(() => {
    const active = container.querySelector('.monthbar__item--active');
    if (active) {
      const cr = container.getBoundingClientRect();
      const ar = active.getBoundingClientRect();
      if (ar.left < cr.left || ar.right > cr.right) {
        container.scrollLeft += ar.left - cr.left - cr.width / 2 + ar.width / 2;
      }
    }
  });
}

/** 滚动到指定月份区块 */
/**
 * 滚动到指定月份的区块。
 * 偏移量必须实测 .sticky-head 的高度——它在刘海屏上会因安全区而变高，
 * 写死 150 会在 iPhone 上把月份标题切掉一半（桌面端碰巧是对的）。
 */
export function scrollToMonth(month, behavior = 'smooth') {
  const doScroll = () => {
    const el = document.getElementById(`month-${state.year}-${month}`);
    if (!el) return;
    const head = document.querySelector('.sticky-head');
    // 头部实际高度 + 一点呼吸间距
    const offset = (head ? head.getBoundingClientRect().height : 150) + 12;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior });
  };
  // 图片是异步插入的，立刻测量高度还不准。多等几帧再滚，确保落点是最终位置。
  if (behavior === 'smooth') {
    setTimeout(doScroll, 60);
    setTimeout(doScroll, 200);
  } else {
    requestAnimationFrame(doScroll);
  }
}

/* ---------------- 月标题 ---------------- */

function monthTitle(year, month) {
  return `${year}年${month + 1}月`;
}

/* ---------------- 网格 ---------------- */

function buildCell(dateStr, dayNum, isToday) {
  const wrap = document.createElement('div');
  wrap.className = 'cell-wrap';

  const cell = document.createElement('button');
  cell.className = 'cell';
  cell.dataset.date = dateStr;
  cell.type = 'button';
  cell.setAttribute('aria-label', `${dateStr}`);

  const info = cache.get(dateStr);
  const hasPhoto = info && info.hasPhoto;

  // 有照片：拍立得（照片 + 下方白边日期）
  if (hasPhoto) {
    cell.classList.add('cell--filled');
    const photoBox = document.createElement('div');
    photoBox.className = 'cell__photo';
    cell.appendChild(photoBox);
    db.get(dateStr).then((rec) => {
      if (rec && rec.photoThumb) {
        blobImage(rec.photoThumb, photoBox, {
          alt: `${dateStr} 的照片`,
          // 不能用 loading="lazy"：格子高度靠 padding-bottom 撑开，
          // 图片插入时布局未稳定，浏览器会误判不可见而永不加载。
          onReady: (img) => {
            if (!img) {
              // 图解码失败，降级成便利贴
              cell.classList.remove('cell--filled');
              cell.classList.add('cell--text');
              const e = document.createElement('span');
              e.className = 'emoji';
              e.textContent = MOODS.icon(info.mood);
              cell.prepend(e);
            }
          },
        });
      } else {
        cell.classList.remove('cell--filled');
        cell.classList.add('cell--text');
        const e = document.createElement('span');
        e.className = 'emoji';
        e.textContent = MOODS.icon(info.mood);
        cell.prepend(e);
      }
    });
  } else if (info) {
    // 有文字没照片：便利贴
    cell.classList.add('cell--text');
    const e = document.createElement('span');
    e.className = 'emoji';
    e.textContent = MOODS.icon(info.mood);
    cell.appendChild(e);
  } else {
    cell.classList.add('cell--empty');
    const n = document.createElement('span');
    n.className = 'num';
    n.textContent = dayNum;
    cell.appendChild(n);
  }

  if (hasPhoto || info) {
    // 日期：拍立得下方白边处
    const n = document.createElement('span');
    n.className = 'num';
    n.textContent = dayNum;
    cell.appendChild(n);

    if (info && info.mood) {
      const dot = document.createElement('span');
      dot.className = 'cell__dot';
      dot.style.background = MOODS.color(info.mood);
      cell.appendChild(dot);
    }
  }

  if (isToday) cell.classList.add('cell--today');

  cell.addEventListener('click', () => handlers.onOpenDetail(dateStr));
  wrap.appendChild(cell);
  return wrap;
}

function buildMonthGrid(year, month) {
  const grid = document.createElement('div');
  grid.className = 'grid';

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadBlanks = first.getDay(); // 周日开头

  for (let i = 0; i < leadBlanks; i++) {
    const blank = document.createElement('div');
    grid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    grid.appendChild(buildCell(dateStr, d, dateStr === state.today));
  }

  return grid;
}

function buildSection(year, month) {
  const sec = document.createElement('section');
  sec.className = 'section';
  sec.id = `month-${year}-${month}`;

  const count = cache.countByMonth(`${year}-${String(month + 1).padStart(2, '0')}`);
  const head = document.createElement('div');
  head.className = 'section__head';
  head.innerHTML = `
    <h2 class="section__title">${monthTitle(year, month)}</h2>
    <span class="section__count">${count} 天</span>
  `;
  sec.appendChild(head);

  const wd = document.createElement('div');
  wd.className = 'weekdays';
  WEEKDAYS.forEach((w) => {
    const s = document.createElement('span');
    s.textContent = w;
    wd.appendChild(s);
  });
  sec.appendChild(wd);

  sec.appendChild(buildMonthGrid(year, month));
  return sec;
}

/* ---------------- 主渲染 ---------------- */

export function renderCalendar(container) {
  container.innerHTML = '';

  if (!cache.dates().length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__deco" aria-hidden="true">
          <span class="deco deco--star" style="--x:8%;--y:12%;--s:22px;--r:-14deg"></span>
          <span class="deco deco--heart" style="--x:84%;--y:10%;--s:18px;--r:12deg"></span>
          <span class="deco deco--star" style="--x:90%;--y:36%;--s:14px;--r:20deg"></span>
          <span class="deco deco--butterfly" style="--x:7%;--y:48%;--s:20px;--r:-10deg"></span>
          <span class="deco deco--flower" style="--x:82%;--y:66%;--s:17px;--r:10deg"></span>
          <span class="deco deco--star" style="--x:14%;--y:80%;--s:13px;--r:26deg"></span>
        </div>
        <div class="empty-state__emoji">📷</div>
        <h3>还没有任何记录</h3>
        <p>点右下角的按钮，添加第一张<br>今天的心情吧</p>
      </div>`;
    return;
  }

  // 只渲染「当前选中年份」的 12 个月。
  // 原来这里会把当前年强行并进来，选 2031 后就变成「2031 + 2026」两段，
  // 用户看到的不是切换而是追加。选哪年就该只看哪年。
  // 用户可能特意翻到没有记录的年份（比如提前看看）。
  // 不给提示的话，面对一整年空格子会以为应用坏了。
  // 提示条放在最前面——放末尾的话用户要滚过一整年才看得到。
  if (!cache.dates().some((d) => d.startsWith(String(state.year)))) {
    const tip = document.createElement('div');
    tip.className = 'year-empty-tip';
    tip.innerHTML = `<span>${state.year} 年还没有记录</span><button type="button" id="back-to-data">回到有记录的年份</button>`;
    container.appendChild(tip);
    const back = tip.querySelector('#back-to-data');
    if (back) {
      back.addEventListener('click', () => {
        const withData = yearsWithData();
        if (!withData.length) return;
        const targetYear = withData[withData.length - 1];

        // 定位到该年「最后一条记录所在的月」，而不是"今天所在的月"。
        // 用今天会导致月份条高亮 10 月、日历却停在 1 月，对不上。
        const inYear = cache
          .dates()
          .filter((d) => d.startsWith(`${targetYear}-`))
          .sort();
        state.year = targetYear;
        state.month = inYear.length
          ? new Date(`${inYear[inYear.length - 1]}T00:00:00`).getMonth()
          : new Date().getMonth();
        state.yearPinned = false; // 这是"回到数据"，不是"我想固定这一年"

        renderAll({ pinYear: state.year });
        // renderAll() 会重绘整个 main 把滚动重置到顶部，
        // 少了这一句，月份条显示 10 月而页面还停在 1 月。
        scrollToMonth(state.month, 'smooth');
      });
    }
  }

  for (let m = 0; m < 12; m++) {
    container.appendChild(buildSection(state.year, m));
  }
}

/** 顶部统计 */
/**
 * 顶部统计 —— 三个数字都跟着「当前选中的年月」走。
 *
 * 之前的版本：
 *   连续 N 天 —— 锚定「今天」，跟选中年份无关
 *   累计 N 天 —— 全局总数，跟选中年份无关
 * 于是用户翻到 2030 年，底下还写着「连续 3 天 / 累计 13 天」，
 * 语义上说不通，看起来像没跟着切换。
 *
 * 现在改成：
 *   当月 —— 当前选中年月的记录数
 *   本年 —— 当前选中年份的记录数
 *   连续 —— 只在「当前就是今天所在年月」时才有意义，其余月份显示该月的最长连续段
 */
export function renderStats(el) {
  const y = String(state.year);
  const m = state.month;

  const monthCount = cache.countByMonth(`${y}-${String(m + 1).padStart(2, '0')}`);
  const yearCount = cache.countByYear(y);

  // 「连续」在不同上下文含义不同，得按情况算
  let streakLabel = '连续';
  let streak;
  if (y === state.today.slice(0, 4) && m === new Date().getMonth()) {
    // 正在看当月 → 真实连续天数（从今天往回推）
    streak = cache.streak(state.today);
  } else {
    // 看的是别的月份 → 那个月的最长连续记录段
    streak = cache.longestRunInMonth(y, m);
  }

  el.innerHTML = `
    <span class="tape tape--pink">${streakLabel} <b>${streak}</b> 天</span>
    <span class="tape tape--blue">当月 <b>${monthCount}</b> 天</span>
    <span class="tape tape--olive">本年 <b>${yearCount}</b> 天</span>`;
}

/** 年份选择列表 */
export function renderYearList(container) {
  const nowYear = new Date().getFullYear();

  // 年份范围：今年往后 5 年（方便提前规划）+ 所有有记录的年份（含过去）。
  //
  // 之前为了「不要铺到 1970 年六十多屏」把范围卡在 >= 今年，
  // 结果把用户的历史记录也一起藏了——去年的日记找不到了。
  // 正确做法是：过去只列「真正有记录的年份」，未来才给固定的几年。
  const years = new Set([nowYear, state.year]);
  cache.years().map(Number).forEach((y) => years.add(y)); // 历史有数据的年份必须能选回
  for (let y = nowYear; y <= nowYear + 5; y++) years.add(y); // 当年往后多给几年

  container.innerHTML = '';
  [...years]
    .sort((a, b) => b - a)
    .forEach((y) => {
      const row = document.createElement('button');
      row.className = 'yearlist__item';
      row.setAttribute('aria-selected', String(y === state.year));
      const n = cache.countByYear(y);
      row.innerHTML = `
        <span>${y} 年</span>
        <span class="yearlist__meta">${n > 0 ? `${n} 天记录` : '暂无记录'}</span>`;
      row.addEventListener('click', () => {
        state.year = y;
        handlers.onChangeYear();
      });
      container.appendChild(row);
    });
}

/** 数据实际存在的年份（升序） */
export function yearsWithData() {
  return cache.years().map(Number).sort((a, b) => a - b);
}

/**
 * 把 state.year 修正到一个「有内容」的年份。
 *
 * 现在日历只渲染选中的那一年（选哪年看哪年），
 * 所以如果停在一个空年份，用户会看到一整年空格子而毫无提示。
 * 这里在切年份/重新渲染时兜底：
 *   - 选中年份没数据 → 跳到最近的有数据年份
 *   - 全都没数据 → 回到当前年
 */
export function ensureYearHasContent(preferred) {
  const withData = yearsWithData();
  const nowYear = new Date().getFullYear();

  // 用户显式指定（pinYear）优先，其次是用户之前主动选过年份（yearPinned）。
  // 这两个判断必须放在「无数据兜底」之前——
  // 否则新用户（库里一条记录都没有）选 2029，抽屉一关就被拽回今年，
  // 而且 yearPinned 残留为 true，状态自相矛盾。
  if (typeof preferred === 'number') {
    state.year = preferred;
    return;
  }
  if (state.yearPinned) return;

  if (!withData.length) {
    state.year = nowYear;
    return;
  }
  if (withData.includes(state.year)) return; // 选中年份有数据，保持

  // 其余情况才拉回最近的有数据年份
  const nearest = withData.reduce((best, y) =>
    Math.abs(y - nowYear) < Math.abs(best - nowYear) ? y : best
  );
  state.year = nearest;
}

/**
 * 重新渲染整个界面。
 * @param {object} [opts]
 * @param {number} [opts.pinYear] 强制锁定该年份（用户主动选择时用，跳过空年份兜底）
 */
export function renderAll(opts) {
  // 兜底：停在一个没有任何记录的年份，用户会看到一整年空格子却毫无线索。
  // 但用户主动选年份时（pinYear）尊重他的选择——他可能就是想翻翻未来。
  ensureYearHasContent(opts && opts.pinYear);

  renderMonthBar(document.getElementById('monthbar'));
  renderStats(document.getElementById('stats'));
  renderCalendar(document.getElementById('main'));

  // 顶部年份胶囊要跟着当前选中年份走。
  // 这个元素原本只在 HTML 里写死了一个静态年份，切年份时不会变——
  // 会导致胶囊显示 2026、日历却是 2031 的对不上的问题。
  const label = document.getElementById('year-label');
  if (label) label.textContent = String(state.year);
}