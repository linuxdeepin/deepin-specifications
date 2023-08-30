import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Desktop Spec Group",
  description: "Desktop Specifications Group",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [{ text: "首页", link: "/" }],

    sidebar: [
      {
        text: "配置文件规范",
        link: "/unstable/配置文件规范",
      },
      {
        text: "屏保资源格式规范",
        link: "/unstable/屏保资源格式规范",
      },
      {
        text: "图标文件规范",
        link: "/unstable/图标文件规范",
      },
      {
        text: "文件管理器扩展盘符规范",
        link: "/unstable/文件管理器扩展盘符规范",
      },
      {
        text: "文件管理上下文右键菜单规范",
        link: "/unstable/文件管理上下文右键菜单规范",
      },
      {
        text: "应用数据目录规范",
        link: "/unstable/应用数据目录规范",
      },
      {
        text: "桌面应用打包规范",
        link: "/unstable/桌面应用打包规范",
      },
    ],

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/linuxdeepin/deepin-specifications",
      },
    ],

    docFooter: {
      prev: "上一页",
      next: "下一页",
    },
    darkModeSwitchLabel: "浅色/深色模式",
    outlineTitle: "此页的大纲",
    sidebarMenuLabel: "菜单",
    returnToTopLabel: "返回顶部",
  },
});
