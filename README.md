# 二维码识别 Chrome 插件

右键识别网页图片中的二维码，或点击图标上传/拖拽/粘贴图片识别。支持一张图片包含多个二维码，逐个列出全部结果。识别全程在浏览器本地完成（ZXing + jsQR 双引擎），图片不会上传到服务器，不收集任何数据。

## 安装

### 方式一：下载安装包（推荐，免构建）

1. 进入 [Releases](../../releases) 页面，下载最新版的 `qr-reader-extension-vX.Y.Z.zip` 并解压
2. Chrome 打开 `chrome://extensions`，右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择解压出来的文件夹
4. 右键任意网页图片，即可看到「识别二维码」菜单项

> 安装时 Chrome 会提示「读取和更改所有网站数据」权限：右键识别需要作用于任意网站的图片（含跨域抓图），属本类工具的必需权限；扩展不常驻任何页面，仅在点击右键菜单后按需注入脚本，详见下方权限说明。

### 方式二：从源码构建

```bash
git clone https://github.com/EndEdge/qr-reader-extension.git
cd qr-reader-extension
npm install
npm run build
```

构建产物在 `dist/`，按方式一第 2~3 步加载 `dist/` 文件夹即可。

## 功能

- 右键任意网页图片 → 「识别二维码」→ 页面右下角浮层展示结果
- **多码支持**：一张图里有多个二维码时全部识别，逐条列出（带编号、逐条复制/打开链接）
- 结果面板：缩略图预览、复制（带已复制提示）、访问链接（结果为网址时）
- popup：点击、拖拽或粘贴本地图片识别，同样的结果展示
- 识别失败时自动进入深度识别（降采样 / 反色 / 多阈值二值化 / 通道提取等增强策略）

> 多码识别原理：jsQR 每识别一个二维码会返回其四角坐标，将该区域遮盖后继续扫描，循环直到无新结果；再与 ZXing 的结果按内容去重合并。单张图片最多返回 16 个结果。

## 隐私与权限

- 识别引擎全部在本地运行，图片与识别结果不离开你的设备，无统计、无埋点
- `contextMenus`：在图片右键菜单中添加入口
- `scripting`：点击右键菜单后向当前页面按需注入识别脚本
- `<all_urls>`：用户可能在任意网站右键图片；扩展需要读取被选中图片字节用于本地解码（绕过跨域限制），不做任何后台访问

## 开发

```bash
npm run check    # 类型检查 + 构建
npm run build    # 仅构建
node tools/gen-icons.mjs   # 重新生成图标
```

## 结构

```
src/
  background/index.ts   # 右键菜单注册、跨域抓图（CORS 豁免）、按需注入 content script
  content/index.ts      # 接收任务、加载图片、调度解码
  content/panel.ts      # Shadow DOM 结果浮层
  shared/decode.ts      # 双引擎解码管线（html5-qrcode 主 + jsQR 暴力增强兜底）
  popup/popup.ts        # popup 上传/拖拽/粘贴识别
public/
  manifest.json         # MV3 清单
  popup.html            # popup 页面
build.mjs               # esbuild 三入口打包（background/content/popup 均 IIFE）
```

## 已知边界

- 仅支持右键 `<img>` 元素；背景图、canvas、视频帧暂不支持
- blob: 图片由 content script 在页面内获取；防盗链等抓取失败场景会兜底尝试页面内 fetch
- SVG 内嵌二维码可能无法识别（canvas 绘制限制）

## 许可

[MIT](./LICENSE)
