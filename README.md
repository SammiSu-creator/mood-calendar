# 日历心情 · C 版

每天一张照片，一句话心情。数据 100% 存在你自己手机里。

## 怎么用（给别人）

把整个文件夹传到任意静态托管（GitHub Pages / Cloudflare Pages / Vercel），拿到一个链接发给朋友。
对方手机打开链接 → 分享菜单 → 「添加到主屏幕」，桌面出现图标，点开全屏运行。

**没有服务器数据库，没有账号，所有人的数据互相看不见。**

## 部署

```bash
# 任选其一
npx vercel deploy --prod
# 或推到 GitHub 后在 Settings → Pages 选 main 分支
```

无需构建，无依赖，原生 ES Module。

## 数据

- 存 IndexedDB，一天一条，主键是日期
- 图片自动压两份：缩略图 240px（网格用） + 大图 1400px（详情用）
- 一年约 100MB
- 设置里可导出 JSON 备份 / 导入恢复，换手机前记得导出

## 结构

```
index.html
css/style.css
js/db.js        IndexedDB 封装 + 内存缓存
js/image.js     图片压缩（EXIF 方向修正 / 双份输出）
js/calendar.js  日历渲染
js/moods.js     心情标签定义
js/app.js       主入口：详情页 / 记录面板 / 设置
sw.js           Service Worker（离线可用）
```

## 测试

测试脚本在 `test/` 目录，需要 Playwright：

```bash
npm i playwright && npx playwright install chromium

python3 -m http.server 8902      # 起服务（端口需与脚本内一致）
node test/flow.js                # 34 项端到端流程
node test/verify_yearpin.js      # 年份切换不被兜底逻辑破坏
node test/verify_back.js         # 跳回按钮后月份条与视口一致
node test/verify_sticky2.js      # 粘性头部
```
