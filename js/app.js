/**
 * 主入口：串联日历、详情页、记录面板、设置
 * 所有数据都在本地 IndexedDB，不出手机
 */

import { db, cache, fmt } from './db.js';
import { processImage } from './image.js';
import { MOODS } from './moods.js';
import { state, handlers, renderAll, renderYearList, scrollToMonth } from './calendar.js';

/* ---------------- DOM 引用 ---------------- */

const $ = (id) => document.getElementById(id);

/** 日期可选范围。日期控件、编辑器翻页、详情页翻页共用同一套边界，
 *  避免同一个「上一天」在编辑器里被拦住、在详情页里却放行。 */
const MIN_YEAR = 1970;
const MAX_YEAR = 2099;

const els = {
  monthbar: $('monthbar'),
  stats: $('stats'),
  main: $('main'),
  overlay: $('overlay'),
  toast: $('toast'),

  // 抽屉
  sheet: $('sheet'),
  sheetTitle: $('sheet-title'),
  sheetBody: $('sheet-body'),
  sheetFoot: $('sheet-foot'),

  // 详情页
  detail: $('detail'),
  detailDate: $('detail-date'),
  detailBody: $('detail-body'),
};

/* ---------------- 基础工具 ---------------- */

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('toast--show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('toast--show'), 2200);
}

const WEEKDAYS_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function prettyDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    full: `${y}年${m}月${d}日`,
    weekday: WEEKDAYS_CN[dt.getDay()],
    short: `${m}月${d}日`,
    isToday: dateStr === fmt(new Date()),
  };
}

/* ---------------- 抽屉通用 ---------------- */

function openSheet(title, bodyHTML, footHTML, afterMount) {
  els.sheetTitle.textContent = title;
  els.sheetBody.innerHTML = bodyHTML;
  els.sheetFoot.innerHTML = footHTML || '';
  els.sheetFoot.style.display = footHTML ? '' : 'none';
  els.overlay.classList.add('overlay--show');
  els.sheet.classList.add('sheet--show');
  els.sheetBody.scrollTop = 0;
  if (afterMount) afterMount(els.sheetBody, els.sheetFoot);
}

function closeSheet() {
  els.sheet.classList.remove('sheet--show');
  els.overlay.classList.remove('overlay--show');
}

els.overlay.addEventListener('click', closeSheet);

/* ---------------- 年份选择 ---------------- */

function openYearPicker() {
  openSheet('选择年份', '<div class="yearlist" id="yearlist"></div>', '');
  renderYearList($('yearlist'));
}

/* ---------------- 记录面板 ---------------- */

function openEditor(dateStr) {
  const target = dateStr || state.today;

  db.get(target).then((rec) => {
    const p = prettyDate(target);
    const body = `
      <div class="field">
        <label class="field__label" for="text-input">想说点什么</label>
        <textarea id="text-input" rows="2" maxlength="200"
          placeholder="哪怕只有一句话，也值得留下">${escapeHtml((rec && rec.text) || '')}</textarea>
        <div class="field__counter"><span id="counter">0</span>/200</div>
      </div>

      <div class="field">
        <label class="field__label">今天的心情</label>
        <div class="moods" id="moods"></div>
      </div>

      <div class="photopick" id="photopick">
        <input type="file" accept="image/*" id="file-input" hidden>
        <div class="photopick__hint" id="pick-hint">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M12 16V4m0 0L8 8m4-4l4 4"/><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"/>
          </svg>
          <span>添加今天的照片</span>
        </div>
      </div>
      <div style="height:8px"></div>`;

    openSheet(
      p.isToday ? '记录今天' : `编辑 ${p.short}`,
      body,
      `<div class="datebar">
         <button class="datebar__arrow" id="date-prev" type="button" aria-label="前一天">‹</button>
         <input type="date" id="date-input" value="${target}" max="${MAX_YEAR}-12-31" min="${MIN_YEAR}-01-01">
         <button class="datebar__arrow" id="date-next" type="button" aria-label="后一天">›</button>
       </div>
       <button class="btn btn--primary" id="save-btn">保存</button>`,
      (body_, foot) => {
        mountEditor(body_, foot, { target, rec, p });
      }
    );
  });
}

function mountEditor(root, foot, ctx) {
  const { target, rec } = ctx;
  let mood = (rec && rec.mood) || '';
  let pending = { thumb: null, full: null };
  // 编辑已有记录时，保留原图作为回退（必须在 renderPhoto 之前声明）
  const originalPhoto = rec ? rec.photoFull || rec.photoThumb || null : null;

  /* 心情标签 */
  const moodsBox = root.querySelector('#moods');
  MOODS.list.forEach((m) => {
    const b = document.createElement('button');
    b.className = 'mood';
    b.type = 'button';
    b.setAttribute('aria-pressed', String(m.key === mood));
    b.innerHTML = `<span class="mood__emoji">${m.emoji}</span><span class="mood__label">${m.label}</span>`;
    b.addEventListener('click', () => {
      mood = mood === m.key ? '' : m.key; // 再点一次取消
      moodsBox.querySelectorAll('.mood').forEach((x) =>
        x.setAttribute('aria-pressed', String(x === b && !!mood))
      );
    });
    moodsBox.appendChild(b);
  });

  /* 图片区 */
  const pick = root.querySelector('#photopick');
  const hint = root.querySelector('#pick-hint');
  const fileInput = root.querySelector('#file-input');
  const hintText = () => hint.querySelector('span');

  function renderPhoto() {
    pick.querySelectorAll('img').forEach((n) => n.remove());
    // 预览用大图（pending.full），不用缩略图。
    // 缩略图只有 240px，而这个预览区在 2x 屏上要显示约 700px 宽，
    // 放大会糊成一片。存进库的仍然是 thumb+full 两份，预览只是临时用大图。
    const previewBlob = pending.full || originalPhoto;
    if (previewBlob) {
      const img = new Image();
      const u = URL.createObjectURL(previewBlob);
      img.onload = () => URL.revokeObjectURL(u);
      img.src = u;
      pick.insertBefore(img, hint);
      hintText().textContent = '点击更换照片';
      hint.style.opacity = '0.75';
      pick.classList.add('photopick--filled');
    } else {
      hintText().textContent = '添加今天的照片';
      hint.style.opacity = '1';
      pick.classList.remove('photopick--filled');
    }
    pick.appendChild(fileInput);
  }

  renderPhoto();

  pick.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    hint.querySelector('span').textContent = '正在处理照片…';
    hint.style.opacity = '1';
    try {
      const out = await processImage(f);
      pending = out;
      renderPhoto();
    } catch (err) {
      toast(err.message || '图片处理失败');
      renderPhoto();
    }
    fileInput.value = '';
  });

  /* 字数统计 */
  const ta = root.querySelector('#text-input');
  const counter = root.querySelector('#counter');
  const upd = () => (counter.textContent = String(ta.value.length));
  ta.addEventListener('input', upd);
  upd();

  // 焦点落在文字输入框——这是最高频操作，少点一次是一次
  if (!originalPhoto && !rec) {
    setTimeout(() => {
      ta.focus();
      // 自动弹出键盘后滚到底，保证输入框可见
      setTimeout(() => {
        ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 320);
    }, 380); // 等抽屉动画结束再聚焦，否则会被 transform 吃掉
  }

  /* 日期：输入框 + 左右箭头微调 */
  const dateInput = foot.querySelector('#date-input');
  dateInput.value = target;

  const shiftDate = (n) => {
    const [y, m, d] = dateInput.value.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    if (dt.getFullYear() < MIN_YEAR || dt > new Date()) return;
    dateInput.value = fmt(dt);
  };
  foot.querySelector('#date-prev').addEventListener('click', () => shiftDate(-1));
  foot.querySelector('#date-next').addEventListener('click', () => shiftDate(1));

  /* 保存 */
  const saveBtn = foot.querySelector('#save-btn');
  if (saveBtn) saveBtn.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const date = dateInput.value || target;
      const text = ta.value.trim();

      // 只选了心情标签也算一条记录；什么都没选则拒绝写入空壳
      if (!text && !mood && !pending.thumb && !originalPhoto) {
        toast('写点什么、选个心情，或者放张照片吧');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';

      try {
        // 目标日期已有记录时会直接覆盖，必须让用户知道
        if (date !== target) {
          const existing = await db.get(date);
          if (existing) {
            btn.disabled = false;
            btn.textContent = '保存';
            const p2 = prettyDate(date);
            const msg = `${p2.short} 已经有记录了，要用新内容覆盖吗？`;
            if (!confirm(msg)) return;
          }
        }

        const row = {
          date,
          text,
          mood,
          photoThumb: pending.thumb || originalPhoto || null,
          photoFull: pending.full || originalPhoto || null,
        };

        // 注意：这里绝对不能 db.remove(target)。
        // 「编辑记录时把日期往前挪一天」是正常用法，旧记录必须留在库里。
        // 同理也不能 cache.set(target, null) —— 那会让旧日期在日历上凭空消失。
        // 目标日期已有记录时，覆盖它（一天一条，符合产品定义）。
        const saved = await db.put(row);
        cache.set(date, {
          text: saved.text,
          mood: saved.mood,
          hasPhoto: !!saved.photoThumb,
          updatedAt: saved.updatedAt,
        });

        closeSheet();
        // 跳到刚保存的那个月，让用户立刻看到结果。
        // 注意：renderAll() 会重绘整个 main 把滚动位置重置回顶部，
        // 所以必须在重绘后显式滚动过去，否则用户看不到刚存的照片。
        const d = new Date(`${date}T00:00:00`);
        state.year = d.getFullYear();
        state.month = d.getMonth();
        // 保存后定位到那一天，是程序行为，不是用户选年份
        state.yearPinned = false;
        renderAll();
        scrollToMonth(state.month, 'smooth');
        toast(date === fmt(new Date()) ? '已记下今天 ✓' : `已保存 ${prettyDate(date).short} ✓`);
      } catch (err) {
        console.error(err);
        toast('保存失败，再试一次');
        btn.disabled = false;
        btn.textContent = '保存';
      }
    });
}

/* ---------------- 日详情页 ---------------- */

async function openDetail(dateStr) {
  state.detailDate = dateStr;
  const rec = await db.get(dateStr);
  const p = prettyDate(dateStr);
  els.detailDate.textContent = `${p.short} ${p.weekday}`;

  // 只有真有内容才算「有记录」。
  // 库里的空壳记录（历史脏数据 / 导入时的空行）不能被当成有记录，
  // 否则用户看到的是"编辑"按钮而不是"补记这一天"。
  const isReal = !!(rec && (rec.photoThumb || rec.photoFull || (rec.text || '').trim() || rec.mood));
  const hasPhoto = isReal && rec.photoFull;
  const hasThumb = isReal && rec.photoThumb;

  els.detailBody.innerHTML = `
    ${
      hasPhoto
        ? `<img class="detail__photo" id="detail-photo" alt="${p.full}">`
        : hasThumb
        ? `<div class="detail__photo" style="display:grid;place-items:center;font-size:60px">${MOODS.icon(rec.mood)}</div>`
        : `<div class="detail__photo" style="display:grid;place-items:center;flex-direction:column;gap:8px;color:#aeaeb2;font-size:14px">
             <span style="font-size:44px">🕊️</span><span>这天没有记录</span>
           </div>`
    }
    ${
      isReal && (rec.mood || rec.text)
        ? `<div class="detail__mood">
             <span class="detail__mood-emoji">${MOODS.icon(rec.mood)}</span>
             <span class="detail__mood-label">${MOODS.label(rec.mood)}${
               p.isToday ? ' · 今天' : ''
             }</span>
           </div>`
        : ''
    }
    <p class="detail__text">${
      rec && rec.text
        ? escapeHtml(rec.text)
        : '<span style="color:#aeaeb2">这天没有写字</span>'
    }</p>

    <div class="detail__nav">
      <button id="prev-day">← 前一天</button>
      <button id="next-day">后一天 →</button>
    </div>

    ${
      isReal
        ? `<div class="detail__meta">
             创建于 ${new Date(rec.createdAt || Date.now()).toLocaleString('zh-CN')}<br>
             更新于 ${new Date(rec.updatedAt).toLocaleString('zh-CN')}
           </div>
           <div class="detail__actions">
             <button class="btn" id="edit-btn">编辑</button>
             <button class="btn btn--danger" id="del-btn">删除</button>
           </div>`
        : `<div class="detail__actions">
             <button class="btn btn--primary" id="add-btn">补记这一天</button>
           </div>`
    }
    <div style="height:20px"></div>`;

  // 大图加载
  if (hasPhoto) {
    const img = $('detail-photo');
    const u = URL.createObjectURL(rec.photoFull);
    img.onload = () => URL.revokeObjectURL(u);
    img.src = u;
  }

  // 前后翻页
  $('prev-day').addEventListener('click', () => shiftDay(-1));
  $('next-day').addEventListener('click', () => shiftDay(1));

  if (isReal) {
    $('edit-btn').addEventListener('click', () => {
      closeDetail();
      openEditor(dateStr);
    });
    $('del-btn').addEventListener('click', async () => {
      if (!confirm(`确定删除 ${p.short} 的记录吗？照片也会一起删掉。`)) return;
      await db.remove(dateStr);
      cache.set(dateStr, null);
      closeDetail();
      renderAll();
      toast('已删除');
    });
  } else {
    $('add-btn').addEventListener('click', () => {
      closeDetail();
      openEditor(dateStr);
    });
  }

  els.detail.classList.add('detail--show');
  els.detailBody.scrollTop = 0;
}

/** 详情页前后翻页。加上下界保护，与编辑器里的 shiftDate 保持一致——
 *  否则从 1970-01-01 往前点会翻到 1969，更早的年份会得到 Invalid Date，
 *  星期几直接显示成 undefined。 */
function shiftDay(n) {
  if (!state.detailDate) return;
  const [y, m, d] = state.detailDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  if (Number.isNaN(dt.getTime())) return;
  if (dt.getFullYear() < MIN_YEAR || dt.getFullYear() > MAX_YEAR) return;
  openDetail(fmt(dt));
}

function closeDetail() {
  els.detail.classList.remove('detail--show');
  state.detailDate = null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

$('detail-close').addEventListener('click', closeDetail);
$('sheet-close').addEventListener('click', closeSheet);

/* ---------------- 设置 ---------------- */

async function openSettings() {
  const u = await db.usage();
  const sizeText = u
    ? `已用 ${(u.usage / 1048576).toFixed(1)} MB`
    : '暂不可用';
  const total = cache.dates().length;

  openSheet(
    '设置',
    `<div style="padding-bottom:8px">
       <button class="settings__item" id="export-btn">
         <span>导出备份</span><span>${total} 天 · ${sizeText}</span>
       </button>
       <button class="settings__item" id="import-btn">
         <span>导入备份</span><span>选择 JSON 文件</span>
       </button>
       <input type="file" accept="application/json,.json" id="import-file" hidden>
       <button class="settings__item" id="dayview-btn">
         <span>视图</span><span id="view-label"></span>
       </button>
       <button class="settings__item settings__item--danger" id="clear-btn">
         <span>清空所有数据</span><span>不可恢复</span>
       </button>
       <p style="margin:18px 4px 0;font-size:12px;color:#aeaeb2;line-height:1.7">
         所有照片和文字只存在这台设备上，不会上传到任何服务器。<br>
         换手机前记得先导出备份。
       </p>
     </div>
     <div style="height:12px"></div>`,
    ''
  );

  $('view-label').textContent = state.view === 'day' ? '照片视图' : '紧凑视图';

  $('export-btn').addEventListener('click', doExport);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', doImport);
  $('dayview-btn').addEventListener('click', () => {
    state.view = state.view === 'day' ? 'month' : 'day';
    closeSheet();
    applyView();
  });
  $('clear-btn').addEventListener('click', async () => {
    if (!confirm('确定清空全部记录和照片吗？此操作不可恢复。')) return;
    if (!confirm('再确认一次：所有数据都会被删除。')) return;
    await db.clear();
    cache.meta.clear();
    closeSheet();
    renderAll();
    toast('已清空');
  });
}

async function doExport() {
  toast('正在打包备份…');
  try {
    const rows = await db.allFull();
    const { blobToBase64 } = await import('./image.js');

    const payload = [];
    for (const r of rows) {
      payload.push({
        date: r.date,
        text: r.text || '',
        mood: r.mood || '',
        createdAt: r.createdAt,
        thumb: r.photoThumb ? await blobToBase64(r.photoThumb) : null,
        full: r.photoFull ? await blobToBase64(r.photoFull) : null,
      });
    }

    const json = JSON.stringify({ app: 'mood-calendar', version: 1, exportedAt: Date.now(), records: payload });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `心情日历备份-${fmt(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('备份已导出 ✓');
  } catch (err) {
    console.error(err);
    toast('导出失败');
  }
}

async function doImport(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;

  toast('正在导入…');
  try {
    const { base64ToBlob } = await import('./image.js');
    const text = await f.text();
    const data = JSON.parse(text);
    if (data.app !== 'mood-calendar' || !Array.isArray(data.records)) {
      throw new Error('不是有效的备份文件');
    }

    // 日期格式校验。像 "2026-3-7" / "not-a-date" 这种非规范字符串，
    // 会被 countByYear 用 startsWith 算进「本年」统计，却永远匹配不到日历格子
    // ——用户看到「本年 11 天」却只数得出 9 天，这些记录还打不开、删不掉。
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

    const records = data.records
      .filter((r) => r && r.date)
      // 过滤空壳记录，别把脏数据带进来
      .filter((r) => (r.text && r.text.trim()) || r.mood || r.thumb || r.full)
      .filter((r) => DATE_RE.test(r.date))
      .map((r) => ({
        date: r.date,
        text: r.text || '',
        mood: r.mood || '',
        createdAt: r.createdAt || Date.now(),
        photoThumb: r.thumb ? base64ToBlob(r.thumb) : null,
        photoFull: r.full ? base64ToBlob(r.full) : null,
      }));

    const skipped = (data.records || []).length - records.length;
    if (skipped > 0) toast(`已跳过 ${skipped} 条无效记录`);

    await db.bulkPut(records);
    await cache.load();
    closeSheet();
    renderAll();
    toast(`已导入 ${records.length} 天 ✓`);
  } catch (err) {
    console.error(err);
    toast(err.message || '导入失败，文件可能已损坏');
  }
}

/* ---------------- 视图切换 ---------------- */

/**
 * 切换「照片视图 / 紧凑视图」。
 *
 * 关键：切换后必须重新锚定到当前选中的月份。
 * 两种视图的行高不同（日视图格子 52px，紧凑 38px），
 * 整页总高会从约 5800px 缩到约 4000px。浏览器在重排后仍保留
 * 原来的 scrollY 像素值，但那个像素已经指向完全不同的月份了——
 * 实测高亮 10 月、实际显示 11 月甚至 7 月。
 * 所以切完必须 scrollToMonth 重新定位，保证「月份条高亮」和「视口内容」一致。
 */
function applyView(opts) {
  document.body.classList.toggle('compact', state.view === 'month');
  document.querySelectorAll('.viewswitch button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.view === state.view));
  });
  // 启动时只恢复上次的视图样式，不滚动——
  // 那时 state.month 还没定位好，滚动会把用户甩到错误的月份。
  if (!(opts && opts.noScroll)) scrollToMonth(state.month, 'auto');
}

/* ---------------- 启动 ---------------- */

async function boot() {
  await cache.load();
  await db.persist(); // 申请持久化，降低被系统清理的概率
  handlers.onOpenDetail = openDetail;
  handlers.onChangeYear = () => {
    // 用户主动选了年份 → pinYear，跳过「空年份兜底」，
    // 同时标记 yearPinned，让后续任何重渲染都尊重这个选择。
    // （否则「选 2027 → 点 3 月」会被兜底逻辑悄悄拽回 2026）
    const picked = state.year;
    state.yearPinned = true;

    // 月份落到该年「最后一条记录所在的月」。
    // 之前这里固定重置成 1 月，导致用户切回有记录的年份后
    // 月份莫名其妙跳到 1 月，还得自己再翻回去。
    const inYear = cache.dates().filter((d) => d.startsWith(`${picked}-`));
    if (inYear.length) {
      state.month = new Date(`${inYear[inYear.length - 1]}T00:00:00`).getMonth();
    } else {
      state.month = 0;
    }

    renderAll({ pinYear: picked });
    closeSheet();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  renderAll();
  applyView({ noScroll: true }); // 启动时先不滚，下面定位完再滚

  // 首次打开：定位到「最近的、不晚于今天」的那条记录所在月份。
  // 不能直接取最大日期——万一用户提前给未来的日子记了东西，
  // 打开就跳到未来年，后面全是空月份，反而困惑。
  const todayKey = fmt(new Date());
  const past = cache.dates().filter((d) => d <= todayKey);
  const anchor = past.length ? past[past.length - 1] : todayKey;
  state.year = Number(anchor.slice(0, 4));
  state.month = new Date(`${anchor}T00:00:00`).getMonth();
  state.yearPinned = false; // 这是程序自动定位，不是用户选的
  renderAll();
  scrollToMonth(state.month, 'auto');

  // 跨零点检测。
  // state.today 已经是每次现算的，但日历里的「今天红圈」「连续天数」
  // 都是上次渲染时的结果——页面开着过了午夜不会自动更新。
  // 这里轮询日期，变了就重绘（只重绘，不动用户正在看的位置）。
  let lastSeenDay = state.today;
  setInterval(() => {
    const now = state.today;
    if (now === lastSeenDay) return;
    lastSeenDay = now;
    // 用户正停留在详情页/抽屉里时不打断
    if (els.detail.classList.contains('detail--show')) return;
    if (els.sheet.classList.contains('sheet--show')) return;
    renderAll();
    toast('已跨过零点，日历已更新到新的一天');
  }, 30000);

  // 顶部按钮
  $('year-pill').addEventListener('click', openYearPicker);
  $('settings-btn').addEventListener('click', openSettings);
  $('fab').addEventListener('click', () => openEditor(state.today));
  document.querySelectorAll('.viewswitch button').forEach((b) => {
    b.addEventListener('click', () => {
      state.view = b.dataset.view;
      applyView();
    });
  });

  // 调试用
  window.__mood = { db, cache, state, renderAll };
}

document.addEventListener('DOMContentLoaded', boot);

// Service Worker：离线可用 + 可添加到主屏
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}