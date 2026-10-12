/**
 * 数据层：IndexedDB 封装
 * 一天 = 一条记录，date 为主键
 * 照片存双份：photoThumb（网格圆圈用）/ photoFull（详情页用）
 */

const DB_NAME = 'mood-calendar';
const DB_VERSION = 1;
const STORE = 'records';

let dbPromise = null;

/** 打开数据库 */
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'date' });
        store.createIndex('month', 'month', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        try {
          result = fn(store);
        } catch (e) {
          reject(e);
          return;
        }
        // 兼容两种返回值：
        //   fn 返回 IDBRequest（如 get/getAll）→ 交易完成后取 .result
        //   fn 返回普通值（如 put/remove）   → 直接透传
        //
        // 这里必须用「是否 IDBRequest」判断，而不是判断 result.result !== undefined。
        // 因为 get() 未命中时 request.result 是 undefined，会被误判成
        // 「非 request」，从而把 IDBRequest 对象本身返回出去——
        // 上层 `rec || null` 拿到一个真值对象，所有「记录不存在」的分支全部失效。
        t.oncomplete = () =>
          resolve(
            result && typeof result === 'object' && 'result' in result
              ? result.result
              : result
          );
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

const req2promise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const db = {
  /** 取某一天的记录，没有则返回 null */
  get(date) {
    return tx('readonly', (s) => s.get(date)).then((r) => r || null);
  },

  /** 保存/覆盖某天记录 */
  /**
   * 保存 / 覆盖某天的记录。
   * createdAt 只在首次写入时确定，之后每次编辑都原样保留——
   * 否则 put() 整行覆盖会把创建时间抹掉，详情页的
   * 「创建于」会永远等于最后一次编辑时间，甚至比「更新于」还晚。
   */
  async put(record) {
    const existing = await this.get(record.date);
    const row = {
      ...record,
      month: record.date.slice(0, 7),
      createdAt: (existing && existing.createdAt) || record.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    await tx('readwrite', (s) => s.put(row));
    return row;
  },

  /** 删除某天 */
  remove(date) {
    return tx('readwrite', (s) => s.delete(date));
  },

  /** 全部记录的元信息（不含照片二进制，省内存） */
  allMeta() {
    return tx('readonly', (s) => s.getAll()).then((rows) =>
      (rows || []).map((r) => ({
        date: r.date,
        text: r.text || '',
        mood: r.mood || '',
        hasPhoto: !!r.photoThumb,
        updatedAt: r.updatedAt,
      }))
    );
  },

  /** 完整记录（含照片），用于导出备份 */
  allFull() {
    return tx('readonly', (s) => s.getAll());
  },

  /** 批量写入（导入用） */
  bulkPut(records) {
    // 注意：Blob 本身就是 structured-cloneable 的，IndexedDB 一直支持
    // 直接存 Blob，不需要任何转换（旧注释说要转 ArrayBuffer 是错的）。
    return tx('readwrite', (s) => {
      records.forEach((r) => {
        // 保留传入的 createdAt：备份里存的是原始创建时间，
        // 覆盖成 now() 会让所有历史记录恢复后「创建于」全部变成导入时刻。
        const row = {
          ...r,
          month: String(r.date).slice(0, 7),
          createdAt: r.createdAt || Date.now(),
          updatedAt: Date.now(),
        };
        s.put(row);
      });
    });
  },

  /** 清空全部 */
  clear() {
    return tx('readwrite', (s) => s.clear());
  },

  /** 估算已用空间 */
  async usage() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    try {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage, quota };
    } catch {
      return null;
    }
  },

  /** 申请持久化存储，避免系统自动清理 */
  async persist() {
    if (!navigator.storage || !navigator.storage.persist) return false;
    try {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  },
};

/** 记忆层：元信息常驻内存，渲染日历不用反复查库 */
export const cache = {
  meta: new Map(), // date -> { text, mood, hasPhoto }

  load() {
    return db.allMeta().then((rows) => {
      this.meta = new Map(rows.map((r) => [r.date, r]));
      return this.meta;
    });
  },

  /**
   * 写入缓存。
   * @param {string} date
   * @param {object|null} info 传 null 表示删除该条
   */
  set(date, info) {
    if (info === null || info === undefined) {
      this.meta.delete(date);
      return;
    }
    // hasPhoto 必须显式给出。默认值取 !!info.hasPhoto 而不是
    // `info.hasPhoto !== false`——后者意味着漏传字段时会被当成 true，
    // 导致「没照片的记录」在日历上错误地渲染成照片格子。
    this.meta.set(date, { ...info, hasPhoto: !!info.hasPhoto });
  },

  get(date) {
    return this.meta.get(date) || null;
  },

  has(date) {
    return this.meta.has(date);
  },

  dates() {
    return [...this.meta.keys()].sort();
  },

  /** 某年记录数 */
  countByYear(year) {
    const p = String(year);
    return [...this.meta.keys()].filter((d) => d.startsWith(p)).length;
  },

  /** 哪些年份有数据（升序） */
  years() {
    const set = new Set([...this.meta.keys()].map((d) => d.slice(0, 4)));
    return [...set].sort();
  },

  /** 连续记录天数（含今天或昨天往前推） */
  streak(today) {
    if (!this.meta.size) return 0;
    const d = new Date(today + 'T00:00:00');
    if (!this.meta.has(fmt(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (this.meta.has(fmt(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  },

  /** 某月记录数 */
  countByMonth(month) {
    const p = String(month);
    return [...this.meta.keys()].filter((d) => d.startsWith(p)).length;
  },

  /**
   * 某年某月的「最长连续记录段」。
   * 用于在翻看非当月时替代「连续天数」——
   * 「从今天往回推的连续」对历史月份没有意义。
   */
  longestRunInMonth(year, month /* 0-11 */) {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    const days = [...this.meta.keys()]
      .filter((d) => d.startsWith(prefix))
      .map((d) => Number(d.slice(8)))
      .sort((a, b) => a - b);
    if (!days.length) return 0;

    let best = 1;
    let cur = 1;
    for (let i = 1; i < days.length; i++) {
      if (days[i] === days[i - 1] + 1) {
        cur++;
      } else {
        cur = 1;
      }
      if (cur > best) best = cur;
    }
    return best;
  },
};

export function fmt(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}