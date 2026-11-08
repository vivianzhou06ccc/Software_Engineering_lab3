# 栖居 STAY · iPhone 版

Lab 3 酒店预订系统的独立 iPhone App。适用于 iOS 17 及以上版本。顾客、酒店员工和平台管理员的页面、房态和订单逻辑与桌面网页版使用同一份源码快照。App 在手机内通过 WebKit 显示这些页面，并在同一个应用里运行内置的 Python 服务，数据保存在该 App 的 SQLite 数据库中。首次启动会生成样例数据。网页版和 iPhone 各自保存数据。

## 在 Mac 上试用

1. 双击 `Stay.xcodeproj`。
2. 在 Xcode 顶部选择 `Stay` 方案和一个 iPhone 模拟器。
3. 按 ⌘R 启动，按 ⌘U 运行界面测试。

启动后，在顾客页选择入住和退房日期，点「查询酒店和房态」。点「查看房型和逐日房态」，可以看每晚剩余量与售价，再选择可订房型。顶部「演示身份」可切换到酒店员工或平台管理员。

## 安装到自己的 iPhone

1. 把 iPhone 连接到 Mac，完成信任和配对。
2. 在 Xcode 的 **Settings → Apple Accounts** 登录自己的 Apple 账号。在项目的 **Stay target → Signing & Capabilities** 勾选 **Automatically manage signing** 并选择自己的 Team。
3. 在 Xcode 顶部选择已连接的 iPhone。如果系统提示启用开发者模式，在 iPhone 的 **设置 → 隐私与安全性 → 开发者模式** 中按提示操作。
4. 在 Xcode 按 ⌘R。完成开发签名后，Xcode 会将应用安装到 iPhone 的主屏幕。

[Apple 官方真机运行说明](https://developer.apple.com/documentation/xcode/building-and-running-an-app) · [开发者模式说明](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)

## 演示政策和测试

- 在 iPhone 的系统设置中找到「栖居 STAY」，可以开启演示政策。完全退出 App 后重新打开生效，演示模式使用独立数据库。
- 改单、取消登记、房量与售价维护、停业审批、审计等流程沿用网页版。待确认的正式退改、统计口径及外部通知渠道继续保留为待确认。
- 命令行可在项目根目录运行 `PYTHONPATH=Backend python3 -m unittest discover -s Tests -v`，检查预订及库存规则。
- `Backend/web` 是网页版界面快照。`Backend/stay` 保存业务模块。`App` 是 iPhone 外壳、图标和嵌入入口。
- Python 3.13.18 iOS 运行环境随工程附带，构建时无需另行下载 Python。版本和许可证见 `Vendor`。打包时使用设备和模拟器各自的运行库。
  [BeeWare Python Apple Support 3.13-b18](https://github.com/beeware/Python-Apple-support/releases/tag/3.13-b18) · [Python iOS 嵌入文档](https://docs.python.org/3.13/using/ios.html)
