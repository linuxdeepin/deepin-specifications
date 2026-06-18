# D-Bus 应用接口接入规范

> __警告！此规范内容是不稳定版本，可能会发生破坏兼容性的更新。当无法保障向下兼容时，将会升级此文档的主版本号，如从"1.0"更新到"2.0"。反之，普通更新只会升级次版本号，如"1.0"更新到"1.1"，其对"1.0"版本向下兼容。请在使用前确认此文档的版本号，并为将来可能发生的兼容性变化做好准备。__

* 维护者：
* 版本：1.0
* 修改日期：2026.06.01
* 议题：

## 引言

本文档规定了 Deepin 桌面应用对外暴露 D-Bus 接口的设计规范，以及 deepin-cli-tools 工具集和 dbus-introspect 动态发现机制如何对接应用接口。

规范覆盖两个层面：

1. **应用侧**：DDE 桌面应用应如何设计、命名、暴露 D-Bus 接口，以便被工具链自动发现和调用
2. **工具侧**：deepin-cli-tools 如何编写工具适配脚本，dbus-introspect 如何通过 Introspect 机制实现运行时动态调用

## 名词解释

* **D-Bus**：Linux 桌面进程间通信（IPC）的标准协议，分为 session bus（用户会话总线）和 system bus（系统总线）
* **Bus Name**：D-Bus 总线名称，指代 D-Bus 上的一个连接 (Connection)。严格分为两种类型：
  * **唯一名 (Unique Connection Name)**：以冒号开头，如 `:1.45`、`:1.102`，进程连接 D-Bus 即自动分配，类似网络中的 IP 地址。
  * **知名名 / 公共名 (Well-known Name)**：反向域名格式，如 `org.deepin.Reader`，进程连接后主动向 D-Bus 申请的名字，类似网络中的域名。本文档所指的"服务名"即 Well-known Name。
* **Object Path**：D-Bus 对象路径，表示服务内的对象实例，格式为斜杠分隔的路径，如 `/org/deepin/Reader`
* **Interface**：D-Bus 接口，包含方法（Method）、信号（Signal）、属性（Property）的集合
* **Introspect**：`org.freedesktop.DBus.Introspectable.Introspect` 方法，用于在运行时查询服务的接口定义（XML 格式）
* **deepin-cli-tools**：Deepin 桌面通用 CLI 工具集，除 D-Bus 调用外还包含系统信息查询、文件管理等多种功能
* **dbus-introspect**：基于 D-Bus Introspect 协议的脚本工具库（Bash），用于运行时动态发现和调用任意 D-Bus 方法
* **工具脚本**：deepin-cli-tools 中每个应用对应的 `dt-<name>.sh` 脚本文件
* **polkit**：PolicyKit 的简称，Linux 桌面细粒度权限管理系统，用于对特权操作（如 root D-Bus 接口调用）进行鉴权
* **system bus / session bus**：D-Bus 的两种总线。session bus 为单用户会话总线，权限与用户等同；system bus 为系统级总线，常驻 root 权限服务，是安全审查重点
* **TOCTOU**：Time-Of-Check to Time-Of-Use，"检查-使用"时序竞态漏洞（CWE-367）。代码先校验资源（如路径）再使用，两步之间的时间窗口内资源可能被篡改（如符号链接替换），导致校验失效
* **路径穿越**：攻击者利用 `..`、符号链接等绕过路径前缀校验，访问授权范围外的文件（如 `/home/user/../../../etc/shadow`）

## 角色说明

* **桌面应用**：提供业务功能的实体，通过 D-Bus 暴露接口供外部调用
* **工具脚本**：deepin-cli-tools 中为特定应用编写的适配脚本，封装 D-Bus 调用细节
* **deepin-cli-tools 入口**：`deepin-cli-tools` 命令行程序，负责加载工具脚本、调度操作
* **dbus-introspect**：运行时动态发现库，无需预先编写适配即可调用任意 D-Bus 方法

## 应用侧：D-Bus 接口设计规范

### 服务命名

服务名称采用反向域名表示法，规则如下：

* 使用 `org.deepin.*` 命名空间
* 名称应与 `appid` 保持一致性，便于工具侧自动关联

示例：

| 应用 | appid | 推荐服务名 |
|------|-------|-----------|
| PDF 阅读器 | org.deepin.reader | org.deepin.Reader |
| 日历 | org.dde.calendar | org.deepin.Calendar |
| 音乐 | org.deepin.music | org.mpris.MediaPlayer2.DeepinMusic |
| 文件管理器 | org.deepin.file-manager | org.deepin.Filemanager.Daemon |

### 对象路径

对象路径应与服务名保持结构一致：

```
服务名：org.deepin.Reader
路径：  /org/deepin/Reader

服务名：org.deepin.Filemanager.Daemon
路径：  /org/deepin/Filemanager/Daemon
```

### 接口设计

#### 方法命名

* 使用 PascalCase 命名，动词在前
* 对同一操作，提供明确的动词前缀

```xml
<!-- 推荐 -->
<method name="OpenDocument">
  <arg type="s" name="docId" direction="in"/>
</method>

<method name="GetCpuUsage">
  <arg type="i" name="percentage" direction="out"/>
</method>
```

#### 属性设计

对于可读写的配置项，应同时提供 Property 和 getter/setter 方法：

```xml
<property access="read" type="i" name="consoleFontSize"/>
<method name="getConsoleFontSize">
  <arg type="i" name="size" direction="out"/>
</method>
<method name="setConsoleFontSize">
  <arg type="i" name="size" direction="in"/>
</method>
```

#### 参数类型映射

D-Bus 方法参数应使用标准类型签名：

| D-Bus 类型 | 说明 | 示例 |
|-----------|------|------|
| s | 字符串 | 文件路径、关键词 |
| i | int32 | 数量、阈值 |
| x | int64 | 时间戳（微秒） |
| u | uint32 | 无符号整数 |
| b | 布尔值 | 开关状态 |
| d | 双精度浮点 | 音量（0.0-1.0） |
| o | 对象路径 | D-Bus 对象引用 |
| as | 字符串数组 | 文件列表 |
| ai | int32 数组 | PID 列表 |

#### 信号设计

需要通知外部状态变化时，应提供 D-Bus 信号：

```xml
<signal name="valueChanged">
  <arg name="key" type="s" direction="out"/>
</signal>
```

#### 多服务应用

一个应用可注册多个 D-Bus 服务，分别负责不同功能域。每个服务应独立注册，服务名使用 appid 的子域名：

```
应用 appid: org.deepin.file-manager

服务1: org.deepin.Filemanager.Daemon          (守护进程)
服务2: org.deepin.Filemanager.TextIndex       (全文索引)
```

### 服务启动

应用应支持 D-Bus 服务自动激活（service activation）。需安装 `.service` 文件：

```
安装路径: $XDG_DATA/dbus-1/services/<service-name>.service
```

文件格式：

```ini
[D-BUS Service]
Name=org.deepin.Reader
Exec=/opt/apps/org.deepin.reader/files/bin/org.deepin.reader --dbus
```

> **安全提示**：上述为 session bus（用户态）激活示例，无需 root。若服务需注册到 **system bus**，则触发 R1：必须先经安全评审论证 root 必要性，并提供配套 polkit `.policy` 与 dbus `.conf` 策略文件。

### Introspect 支持

所有 D-Bus 服务**必须**正确实现 `org.freedesktop.DBus.Introspectable.Introspect` 方法。该方法返回 XML 格式的接口描述，使工具链能够：

1. 自动发现服务的所有接口、方法、信号、属性
2. 自动解析方法参数签名，构造正确的调用参数
3. 支持运行时动态调用，无需预先编写适配代码

Introspect 返回的 XML 必须包含完整的 `<arg>` 元素，且每个参数必须有 `type`、`name`、`direction` 属性：

```xml
<method name="QuerySchedules">
  <arg type="s" name="query" direction="in"/>
  <arg type="s" name="result" direction="out"/>
</method>
```

## 应用侧：安全与合规规范

D-Bus 接口一旦暴露即成为系统对外攻击面，尤其是运行在 system bus 上、持有 root 权限的服务。以下为强制安全规则与合规要求，设计接口时必须遵循。

### 强制规则 R1：禁止随意新增 root 权限 D-Bus 接口

新增 D-Bus 接口**不得默认以 root 权限运行**，必须先论证该接口为何无法在用户权限下完成。

* 新增 root D-Bus 接口（system bus 服务）必须经过**安全评审**，并明确说明：
  * 为什么该操作需要 root 权限（而非降级到用户态）
  * 是否已有 polkit 策略文件覆盖该接口
  * 是否遵循最小权限原则（仅暴露必要的最小方法集）
* 禁止将已有用户态接口**升级为 root 接口**，除非有充分的安全评审记录

**应避免的高风险模式：**

| 模式 | 说明 |
|------|------|
| 新增 `QDBusAbstractAdaptor` 子类 + system bus 注册 | 可能引入新的 root D-Bus 服务 |
| 新增 `.service` 文件指向 system bus | 新 root 服务注册 |
| 新增 D-Bus XML 接口 + 对应 polkit `.policy` 文件 | Root 接口需鉴权 |
| 修改已有 system bus adaptor 添加新方法 | 扩展 root 攻击面 |
| `registerService` on `QDBusConnection::systemBus()` | 注册系统级服务 |

### 强制规则 R2：调用 root D-Bus 必须鉴权，无例外

任何对 root D-Bus 接口的调用（包括**读取属性、监听信号、调用方法**）都必须经过鉴权。

* **无豁免情形**：即使"只是读一个属性"或"只是监听状态变化"，也必须经过 polkit 或等效鉴权机制
* 鉴权必须在**服务端**强制执行（而非仅在客户端检查），即 D-Bus 服务内部必须校验调用者身份
* 禁止使用 `allow_user="*"` 或 `deny_send_destination` 缺失等宽松策略覆盖 root D-Bus 接口
* 代码层面的鉴权调用必须在 D-Bus 方法**入口处**执行，禁止在深层调用链中延迟鉴权

**必须规避的模式：**

| 模式 | 说明 |
|------|------|
| D-Bus method 内无 polkit check | Root 接口无鉴权 |
| D-Bus property `read`/`write` 无 auth annotate | 属性读写未鉴权 |
| D-Bus signal 发射至 system bus 无访问限制 | 信号可能泄露 root 信息 |
| `.conf` 策略文件中 `send_destination` 使用 `allow` + `send_interface` 无 group 限制 | 策略过于宽松 |
| adaptor 方法内直接执行特权操作，未调用 polkit 鉴权 API | 缺少运行时鉴权 |

### 强制规则 R3：权限范围必须与接口能力匹配

鉴权不仅要存在，粒度还必须与接口暴露的能力相匹配。每条 root 对外接口必须明确回答以下三要素：

| 要素 | 检查内容 | 通过标准 |
|------|----------|----------|
| **身份认证** | 调用者是否被正确识别？ | polkit `checkAuthorization` 返回 caller UID/GID 或 session |
| **权限校验** | 调用者是否有权执行此操作？ | polkit 策略文件明确限定 action 名称，非通配符；或代码内有 session group 检查 |
| **能力边界** | 此接口允许的操作范围是什么？ | 接口参数有类型/范围校验；不暴露未限定的文件路径/命令参数；输出不泄露超出必要范围的系统信息 |

**必须避免的权限范围失控模式：**

| 失控模式 | 描述 | 示例 |
|----------|------|------|
| **路径穿透** | 接口接受文件路径参数但未校验路径前缀 | `exportLog("/home/user/../../../etc/shadow")` |
| **命令注入** | 接口参数直接拼入 shell 命令 | `execute("ls " + user_input)` |
| **参数放大** | 接口暴露的能力远超其声称的功能 | 导出日志的接口同时支持任意命令执行 |
| **输出溢出** | 接口返回值包含超出其功能范围的敏感信息 | 只读接口返回完整系统配置 |
| **权限过宽的 polkit action** | polkit 策略文件中 action 名称使用通配符或过于宽泛 | `<action id="org.deepin.*">` 而非具体 action |
| **缺少 action 的 polkit annotate** | polkit annotate 中 `auth_admin` 等标记存在但无对应 `.policy` 文件 | 接口有 `auth_admin_keep` 但无对应 action 定义 |

### 强制规则 R4：禁止使用目录路径作为参数，防止路径穿越和 TOCTOU

**核心原则：目录路径参数是不可信的。** 当 D-Bus 接口接受目录路径作为参数时，从参数校验到文件操作的整个时间窗口内，文件系统状态可能发生变化（符号链接替换、挂载点切换等），导致**检查-使用（TOCTOU）漏洞**和**路径穿越漏洞**。

**R4.1 禁止模式：**

| 禁止模式 | 描述 |
|----------|------|
| 接口直接接受目录路径参数 | 接口签名中包含 `QString outDir` / `QString path` / `QString dir` 等目录类型参数 |
| 白名单仅用 `startsWith()` 前缀匹配 | `/home/user` 可穿越为 `/home/user/../../../etc` |
| 符号链接未解析即使用 | `QDir::cleanPath()` 无法解析符号链接 |
| 检查路径和使用路径之间存在时间窗口 | `stat()` 检查后 `open()` 使用前，路径可能被替换 |
| 使用用户提供的目录拼接命令 | `"cp " + dir + "/..."` 直接拼入命令 |

**R4.2 合规设计模式：**

| 合规模式 | 说明 |
|----------|------|
| **FD 代替路径传递** | 使用 `QDBusUnixFileDescriptor` 传递已打开的文件描述符，服务端直接使用 fd 操作 |
| **精确路径白名单** | 白名单使用精确路径而非前缀，精确到最后一级的完整路径（如 `/home/ut001218` ✅ vs `/home` ❌） |
| **多层目录锁定** | 在检查和使用之间使用 `open()` with `O_NOFOLLOW` + `fstat()` 验证，fd 操作跳过路径解析 |
| **禁止相对路径** | 所有路径参数必须以 `/` 开头，拒绝包含 `..` 或 `.` 的路径 |
| **路径规范化解构** | 使用 `realpath()` 或等效方法将路径解析到物理路径，再与白名单比较 |

**R4.3 合规设计示例（FD 模式）：**

```cpp
// ❌ 禁止：目录路径参数
bool exportOpsLog(const QString &outDir, const QString &userHomeDir);

// ✅ 推荐：FD 参数传递
// 1. 客户端打开目录并传递 fd（QFile 适用于文件，目录须用 open + O_DIRECTORY）
#include <fcntl.h>
#include <sys/stat.h>
int fd = open(outDir.toUtf8().constData(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
if (fd < 0) {
    return false; // 目录不存在或为符号链接，拒接
}
QDBusUnixFileDescriptor dbusFd(fd);
close(fd);
m_dbus->exportOpsLog(dbusFd, userHomeFd);

// 2. 服务端直接使用 fd，在 O_NOFOLLOW 下验证
bool LogViewerService::exportOpsLog(QDBusUnixFileDescriptor outDirFd, ...)
{
    struct stat st;
    if (fstat(outDirFd.fileDescriptor(), &st) != 0 || !S_ISDIR(st.st_mode)) {
        return false; // 不是目录，拒接
    }
    // 直接使用 fd 操作，绕过路径解析，无 TOCTOU 风险
    // O_NOFOLLOW：若 output.txt 是符号链接则 openat 直接失败，攻击者预置符号链接劫持写入敏感文件的路径已被拦截
    int fd = openat(outDirFd.fileDescriptor(), "output.txt",
                    O_WRONLY | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0644);
    if (fd < 0) {
        return false; // 符号链接、权限不足或其他错误，拒接
    }
    if (ftruncate(fd, 0) != 0) {
        close(fd);
        return false;
    }
    ...
}
```

**R4.4 合规设计示例（精确路径白名单 + realpath）：**

```cpp
// ✅ 精确路径白名单（而非前缀）
const QStringList kAllowedExportPaths = {
    "/home/ut001218/exports",
    "/media/USB-drive/logs",
    "/tmp"
};

// 解析符号链接到真实路径；realpath 失败（路径不存在）直接拒绝，不回退未解析路径
char resolved[PATH_MAX];
if (!realpath(outDir.toUtf8().constData(), resolved)) {
    qCCritical(logService) << "Path resolution failed:" << outDir;
    return false;
}
QString realOutPath = QString::fromUtf8(resolved);

if (!kAllowedExportPaths.contains(realOutPath)) {
    qCCritical(logService) << "Path not in whitelist:" << realOutPath;
    return false;
}
```

> **R3 与 R4 的关系：** R3 关注"是否校验"，R4 关注"**是否能完全消除路径参数本身**"。即使通过前缀白名单暂时满足 R3，也必须按 R4 的禁止目录参数原则进一步改造。

### 对外接口合规检查清单

设计 D-Bus 接口时，逐项核对以下内容：

* 接口命名遵循 D-Bus 命名约定（`org.project.Module.Interface` 形式）
* 方法参数和返回类型定义明确，且有文档说明
* 错误处理使用标准 D-Bus 错误名（`org.freedesktop.DBus.Error.*`）
* 不通过 D-Bus 传递敏感数据（密码、令牌、私钥），如必须传递则需加密
* D-Bus 服务配置了正确的 `<allow>`/`<deny>` 策略规则，且使用 group 限制（非 `allow all`）
* 信号发射不向未授权监听者泄露内部状态
* 属性变更通过 `PropertiesChanged` 信号正确通知
* 异步方法有正确的完成回调或错误传播
* 接口考虑版本管理（命名、弃用策略）

### 对外接口检测要点

实现 D-Bus 接口时，以下元素均构成对外攻击面，需按上述规则逐一核查：

| 类别 | 检测要点 |
|------|----------|
| D-Bus 接口定义 | `.xml` 接口文件、`Q_CLASSINFO("D-Bus Interface", ...)`、`QDBusAbstractAdaptor` 子类 — 关注接口命名与方法完整性 |
| D-Bus 方法/信号/属性 | adaptor 类中的 `Q_INVOKABLE`、`Q_SCRIPTABLE` 方法、信号发射 — 关注 API 稳定性与向后兼容 |
| D-Bus 服务注册 | `/usr/share/dbus-1/` 下的 `.service` 文件、`QDBusConnection::registerService()`、`registerObject()` — 关注服务命名与安全策略 |
| D-Bus 策略配置 | `/etc/dbus-1/` 下的 `.conf` 文件、`<allow>`/`<deny>` 规则 — 关注访问控制规则 |
| Polkit 鉴权 | `.policy` 文件、polkit 鉴权检查、`org.freedesktop.policykit` — 关注 action 精确性与 annotate 完整性 |

## 工具侧：deepin-cli-tools 适配规范

### 目录结构

```
deepin-cli-tools/
├── bin/
│   └── deepin-cli-tools          # 统一入口
├── lib/
│   ├── common.sh             # 共享库（dbus_call 等）
│   └── introspect.sh         # Introspect 动态发现库
└── tools/
    ├── dt-reader.sh          # PDF 阅读器
    ├── dt-music.sh           # 音乐播放器
    ├── dt-calendar.sh        # 日历
    └── ...                   # 更多工具
```

### 工具脚本编写规范

#### 文件命名

文件名格式为 `dt-<name>.sh`，其中 `<name>` 为工具的短名称（连字符分隔的小写英文）：

```
dt-reader.sh          # reader 工具
dt-screen-recorder.sh # screen-recorder 工具
dt-file-manager.sh    # file-manager 工具
```

#### 端点变量声明

工具脚本必须声明 D-Bus 端点变量，以供 introspect 和通用调度机制使用。

**单服务模式**（最常用，适用于大多数应用）：

```bash
SERVICE="org.deepin.Reader"    # D-Bus 服务名
OBJ="/org/deepin/Reader"       # 对象路径
IFACE="org.deepin.Reader"      # 接口名（通常与服务名相同）
APP_ID="org.deepin.reader"     # 应用标识（用于启动服务）
```

**多服务模式**（适用于一个应用暴露多个 D-Bus 服务的场景）：

```bash
SVC="org.deepin.Filemanager.Daemon"
BASE="/org/deepin/Filemanager/Daemon"

# 各子路径和接口
DEV_PATH="$BASE/DeviceManager"; DEV_IFACE="$SVC.DeviceManager"
VAULT_PATH="$BASE/VaultManager"; VAULT_IFACE="$SVC.VaultManager"
TAG_PATH="$BASE/TagManager"; TAG_IFACE="$SVC.TagManager"
```

**MPRIS 模式**（适用于媒体播放器，遵循 MPRIS 协议）：

```bash
DEST="org.mpris.MediaPlayer2.DeepinMusic"
```

**system bus 模式**（适用于需要系统级权限的服务）：

```bash
BUS="system"                        # 使用系统总线（默认为 session）
SVC_SYS="org.deepin.SystemMonitorSystemServer"
PATH_SYS="/org/deepin/SystemMonitorSystemServer"
```

> **安全约束**：system bus 服务通常持有 root 权限，受 R1-R4 严格约束。使用此模式前必须确认：
> 1. 该服务确需系统级权限（R1），并已通过安全评审
> 2. 服务端所有方法、属性、信号均有 polkit 鉴权（R2）
> 3. 接口参数经范围校验、无目录路径参数（R3/R4）
> 4. 已安装配套 `.conf` 策略文件与 `.policy` polkit 文件

#### 服务启动函数

需要主动启动应用时，定义 `_ensure` 函数：

```bash
# 标准：通过 ensure_service 启动
_ensure() { ensure_service session "$SERVICE" "$APP_ID|deepin-reader" || return 1; }

# 无需启动（系统常驻服务）
# 不定义 _ensure 函数

# 自定义启动逻辑
_ensure() {
    if command -v deepin-terminal &>/dev/null; then
        deepin-terminal &
    else
        ensure_service session "$SERVICE" "deepin-terminal" || return 1
    fi
}
```

`ensure_service` 函数签名：`ensure_service <bus> <service> <starter> [timeout]`

* `<starter>` 支持 `|` 分隔备选启动命令
* 含 `.` 的 starter 优先走 `ll-cli run`（玲珑格式），否则当普通命令执行

#### 帮助函数

必须定义 `tool_help` 函数，提供工具的操作列表：

```bash
tool_help() { cat <<'EOF'
reader — PDF 阅读器
  open <file> [file2...]    打开文档文件
EOF
}
```

格式要求：

* 第一行为 `工具名 — 简要描述`
* 每个操作一行，格式为 `  action <参数说明>    中文描述`
* 操作名使用连字符分隔（如 `font-size`），入口程序会自动转换为下划线匹配函数

#### 操作函数

每个操作对应一个 `tool_<action>` 函数。action 中的连字符会自动转为下划线匹配函数名：

```bash
# 操作 font-size → 函数 tool_font_size
tool_font_size() {
    _ensure && dbus_get_or_set session "$SERVICE" "$OBJ" \
        "$IFACE.consoleFontSize" "$IFACE.setConsoleFontSize" int32 "$1"
}
```

#### D-Bus 调用方式

根据操作类型选择合适的调用函数：

| 函数 | 用途 | 返回值 |
|------|------|--------|
| `dbus_call` | 调用有返回值的方法 | 解析后的值（JSON 友好格式） |
| `dbus_call_void` | 调用无返回值的方法 | 无 |
| `dbus_get_or_set` | 属性查询/设置二合一 | 查询时返回属性值 |

**只读操作声明**：

对于只需检查服务是否运行而不需启动服务的只读操作，声明 `READONLY` 变量：

```bash
READONLY="status metadata position"
```

声明为 READONLY 的操作使用 `_tool_check_service`（仅检查服务是否存在，不启动），而非 `_tool_ensure_service`（会启动服务）。

#### 输入校验与健壮性

在编写 `tool_*` 操作函数时，应对用户传入的参数进行基本的合法性校验，避免将无效参数传递给 D-Bus 接口导致应用进程异常崩溃。

> **注意**：工具脚本的校验仅为健壮性防呆，**不构成安全边界**。攻击者可绕过脚本直接调用 `dbus-send`，真正的安全校验必须在服务端完成（参见"安全与合规规范"）。

校验原则：

1. **文件路径校验**：操作文件的接口应检查路径是否存在、是否可读
2. **数值边界校验**：设置数值的接口（如音量、缩放比例）应检查是否在合理区间内
3. **空参数拦截**：必须的入参不应为空

示例：带校验的文件打开操作

```bash
# 操作函数：打开图片（带安全校验）
tool_open() {
    _ensure || return 1

    # 安全校验：禁止空参数
    if [ $# -eq 0 ]; then
        echo "Error: Missing file path." >&2
        return 1
    fi

    local valid_files=()
    for f in "$@"; do
        # 安全校验：检查文件是否存在且可读
        if [ ! -f "$f" ] || [ ! -r "$f" ]; then
            echo "Warning: Skipping invalid or unreadable file '$f'" >&2
            continue
        fi
        valid_files+=("$f")
    done

    # 安全校验：如果没有有效文件则中止
    if [ ${#valid_files[@]} -eq 0 ]; then
        echo "Error: No valid files to open." >&2
        return 1
    fi

    if [ ${#valid_files[@]} -gt 1 ]; then
        dbus_call_void session "$SERVICE" "$OBJ" "$IFACE.OpenFiles" \
            "array:string:$(join_args "${valid_files[@]}")"
    else
        dbus_call_void session "$SERVICE" "$OBJ" "$IFACE.OpenFile" "string:${valid_files[0]}"
    fi
}
```

#### 自定义 Introspect

多服务应用应定义自定义 `tool_introspect` 函数，列出所有服务的接口信息：

```bash
tool_introspect() {
    local recursive="${1:-}"
    echo "=== Daemon ==="
    introspect_display session "$SVC" "$BASE" "$recursive"
    echo ""
    echo "=== TextIndex ==="
    introspect_display session "$TI_SVC" "$TI_PATH" "$recursive"
}
```

#### 操作别名

通过 `ALIASES` 变量可以将用户友好的操作名映射到 D-Bus 方法名：

```bash
ALIASES="fullscreen=FullscreenScreenshot window=TopWindowScreenshot"
```

#### 通用调度（无需 tool_ 函数）

如果工具只定义了端点变量而没有对应的 `tool_<action>` 函数，deepin-cli-tools 会自动通过 Introspect 查询方法列表，精确匹配操作名，自动解析参数签名并调用。这意味着对于简单场景，只需声明端点变量即可：

```bash
#!/bin/bash
# dt-example.sh — 示例应用
SERVICE="org.deepin.Example"
OBJ="/org/deepin/Example"
IFACE="org.deepin.Example"
APP_ID="org.deepin.example"

tool_help() { cat <<'EOF'
example — 示例应用
  （运行 introspect 查看可用方法）
EOF
}
```

此时所有方法通过 `_tool_call_generic` 自动分发，无需逐一编写 `tool_*` 函数。

### 新增工具流程

为一个新的 DDE 桌面应用新增 deepin-cli-tools 适配，步骤如下：

1. **确认 D-Bus 端点**：使用 `dbus-send` 或 D-Feet 等工具确认应用暴露的服务名、对象路径和接口

   ```bash
   # 检查服务是否存在
   dbus-send --session --dest=org.freedesktop.DBus --type=method_call --print-reply \
       /org/freedesktop/DBus org.freedesktop.DBus.ListNames | grep deepin

   # 查看 Introspect 信息
   dbus-send --session --dest=org.deepin.Example --type=method_call --print-reply \
       /org/deepin/Example org.freedesktop.DBus.Introspectable.Introspect
   ```

2. **创建工具脚本**：在 `tools/` 目录下创建 `dt-<name>.sh`

3. **声明端点变量**：根据第一步确认的信息填写 `SERVICE`、`OBJ`、`IFACE`、`APP_ID`

4. **编写帮助函数**：定义 `tool_help` 列出所有操作

5. **编写操作函数**：为常用操作编写 `tool_*` 函数封装 D-Bus 调用

6. **测试验证**：

   ```bash
   # 列出工具
   deepin-cli-tools <name> help

   # 查看 D-Bus 接口
   deepin-cli-tools <name> introspect

   # 递归查看所有子节点
   deepin-cli-tools <name> introspect --recursive

   # 执行操作
   deepin-cli-tools <name> <action> [args...]
   ```

## 工具侧：dbus-introspect 动态发现规范

### 架构分层

dbus-introspect 库分为三层，各层职责明确：

```
┌─────────────────────────────┐
│    高层：格式化/调度         │   introspect_display, introspect_call
│    （面向用户，输出友好）     │   _tool_introspect, _tool_call_generic
├─────────────────────────────┤
│    中层：解析提取            │   introspect_interfaces, introspect_methods
│    （结构化解析 XML）        │   introspect_method_in_args, introspect_signals
│                             │   introspect_properties, introspect_child_nodes
├─────────────────────────────┤
│    低层：原始调用            │   _introspect_raw
│    （dbus-send 封装）        │
└─────────────────────────────┘
```

### Introspect 解析规则

#### 接口过滤

解析时自动排除以下标准接口（由 D-Bus 规范定义，非应用接口）：

* `org.freedesktop.DBus.Properties`
* `org.freedesktop.DBus.Introspectable`
* `org.freedesktop.DBus.Peer`

#### 方法重载匹配

当同一方法名存在多个重载版本时，按以下规则选择：

1. 优先匹配参数数量与用户提供的参数数量完全一致的重载版本
2. 若无精确匹配，选择参数数量最少的版本
3. 每个重载版本独立解析参数签名

#### 参数类型自动映射

Introspect 解析出参数的 D-Bus 类型签名后，自动映射为 `dbus-send` 的参数格式：

| D-Bus 类型 | dbus-send 格式 | 说明 |
|-----------|---------------|------|
| s | string:\<value\> | 字符串 |
| i | int32:\<value\> | 32 位整数 |
| x | int64:\<value\> | 64 位整数 |
| u | uint32:\<value\> | 无符号 32 位整数 |
| b | boolean:\<value\> | 布尔值 |
| d | double:\<value\> | 双精度浮点 |
| n | int16:\<value\> | 16 位整数 |
| q | uint16:\<value\> | 无符号 16 位整数 |
| t | uint64:\<value\> | 无符号 64 位整数 |
| o | objpath:\<value\> | 对象路径 |
| as | array:string:\<value\> | 字符串数组 |
| ai | array:int32:\<value\> | 整数数组 |
| ab | array:boolean:\<value\> | 布尔数组 |

对于未明确映射的类型，默认使用 `string:` 格式传递。

#### 返回值解析

`dbus_call` 函数通过 `busctl --json=pretty call` 获取 JSON 格式的返回值：

* 字符串值：加引号输出 `"value"`
* 数值/布尔值：原样输出 `42`、`true`、`3.14`
* 数组值：输出为 JSON 数组 `["a","b","c"]`

### 端点发现规则

`_resolve_endpoint` 函数按以下优先级解析 D-Bus 端点：

1. `SERVICE` + `OBJ` 变量（标准单服务模式）→ `IFACE` 默认为 `SERVICE`
2. `SVC` + `BASE` 变量（多服务模式）→ `IFACE` 默认为 `SVC`
3. `DEST` 变量（MPRIS 模式）→ 路径固定为 `/org/mpris/MediaPlayer2`，接口固定为 `org.mpris.MediaPlayer2.Player`

多服务扫描模式：当工具脚本声明了 `SVC_<Name>` 和 `PATH_<Name>` 形式的变量对时，`_tool_introspect` 会自动遍历所有变量对。

### 通用调用流程

`_tool_call_generic` 实现了无预定义函数的方法调度：

```
用户操作 → _resolve_endpoint → _tool_ensure_service
         → _introspect_raw 获取 XML
         → _introspect_match_method 精确匹配方法名
         → _introspect_call_impl 解析参数签名
         → 自动构造 dbus-send 参数并调用
```

### 约束

* **方法名匹配区分大小写**：用户提供的操作名必须与 D-Bus 方法名完全一致（PascalCase）
* **不支持嵌套类型**：参数类型映射仅支持基本类型和一维数组，复合类型（如 `a{sv}`）需在 `tool_*` 函数中手动处理
* **单层数组**：`as`、`ai`、`ab` 等数组类型仅支持逗号分隔的扁平值传递
* **Introspect 时效**：Introspect 结果反映调用时刻的接口状态，服务重启后接口可能变化

## 完整示例

### 应用侧：定义 D-Bus 接口

一个虚构的图片查看器的 D-Bus Introspect XML 输出：

```xml
<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
  "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="org.deepin.ImageViewer">
    <!-- 打开图片文件 -->
    <!-- 安全：使用 QDBusUnixFileDescriptor 传递已打开的文件描述符，避免路径参数（R4） -->
    <method name="OpenFile">
      <arg type="h" name="fileFD" direction="in"/>
    </method>

    <!-- 批量打开图片 -->
    <!-- 安全：同上，通过 FD 传递，无路径解析风险 -->
    <method name="OpenFiles">
      <arg type="ah" name="fileFDs" direction="in"/>
    </method>

    <!-- 获取/设置缩放比例 -->
    <!-- 安全：服务端须校验 scale ∈ [0.0, 10.0]，拒绝越界值（R3 能力边界） -->
    <method name="GetScale">
      <arg type="d" name="scale" direction="out"/>
    </method>
    <method name="SetScale">
      <arg type="d" name="scale" direction="in"/>
    </method>

    <!-- 获取当前图片名称（不传递路径） -->
    <property access="read" type="s" name="CurrentFileName"/>

    <!-- 图片切换信号（通过索引而非路径标识） -->
    <signal name="FileChanged">
      <arg name="index" type="i" direction="out"/>
    </signal>
  </interface>
</node>
```

服务激活文件（安装到 `$XDG_DATA/dbus-1/services/org.deepin.ImageViewer.service`）：

```ini
[D-BUS Service]
Name=org.deepin.ImageViewer
Exec=/opt/apps/org.deepin.image-viewer/files/bin/org.deepin.image-viewer --dbus
```

### 工具侧：编写适配脚本

`tools/dt-image-viewer.sh`：

```bash
#!/bin/bash
# dt-image-viewer.sh — 图片查看器

# 端点变量
SERVICE="org.deepin.ImageViewer"
OBJ="/org/deepin/ImageViewer"
IFACE="org.deepin.ImageViewer"
APP_ID="org.deepin.image-viewer"

# 帮助信息
tool_help() { cat <<'EOF'
image-viewer — 图片查看器
  open <file> [file2...]    打开图片文件
  scale [N]                 查询/设置缩放比例（浮点数）
  current                   获取当前打开的图片路径
EOF
}

# 服务启动
_ensure() { ensure_service session "$SERVICE" "org.deepin.image-viewer|deepin-image-viewer" || return 1; }

# 操作函数
tool_open() {
    _ensure || return 1

    # 输入校验：禁止空参数（参见"输入校验与健壮性"）
    if [ $# -eq 0 ]; then
        echo "Error: Missing file argument." >&2
        return 1
    fi

    local valid_files=()
    for f in "$@"; do
        # 输入校验：检查文件存在且可读
        if [ ! -f "$f" ] || [ ! -r "$f" ]; then
            echo "Warning: Skipping invalid or unreadable file '$f'" >&2
            continue
        fi
        valid_files+=("$f")
    done

    if [ ${#valid_files[@]} -eq 0 ]; then
        echo "Error: No valid files to open." >&2
        return 1
    fi

    # 通过 FD 传递文件，避免路径参数（R4）
    if [ ${#valid_files[@]} -gt 1 ]; then
        # 批量调用 OpenFiles（参数类型 ah），一次性传递所有 FD
        local fd_list=()
        for f in "${valid_files[@]}"; do
            exec {fd}<> "$f"
            fd_list+=("$fd")
        done
        dbus_call_void session "$SERVICE" "$OBJ" "$IFACE.OpenFiles" \
            "array:unix_fd:$(join_args "${fd_list[@]}")"
        for fd in "${fd_list[@]}"; do
            exec {fd}>&-
        done
    else
        exec {fd}<> "${valid_files[0]}"
        dbus_call_void session "$SERVICE" "$OBJ" "$IFACE.OpenFile" "unix_fd:$fd"
        exec {fd}>&-
    fi
}
# 数值边界校验：缩放比例须在 [0.0, 10.0] 区间（R3 能力边界）
tool_scale() {
    _ensure || return 1
    if [ -n "$1" ]; then
        # 正则校验：必须是合法数字格式（整数或浮点），防止非数字输入被 awk 静默转为 0 绕过边界
        if ! echo "$1" | grep -qE '^-?[0-9]*\.?[0-9]+$'; then
            echo "Error: scale must be a number, got '$1'." >&2
            return 1
        fi
        # 拒绝越界值
        awk -v v="$1" 'BEGIN{exit !(v+0>=0 && v+0<=10)}' || {
            echo "Error: scale must be in [0.0, 10.0]." >&2
            return 1
        }
    fi
    dbus_get_or_set session "$SERVICE" "$OBJ" "$IFACE.GetScale" "$IFACE.SetScale" double "$1"
}
tool_current() { _ensure && dbus_call session "$SERVICE" "$OBJ" org.freedesktop.DBus.Properties.Get "string:$IFACE" "string:CurrentFileName"; }

# 只读操作（不需要启动服务，只需检查）
READONLY="current"
```

### 工具侧：仅用 Introspect 的极简模式

对于接口简单、不需要特殊参数处理的应用，只需声明端点变量：

```bash
#!/bin/bash
# dt-calculator.sh — 计算器
SERVICE="org.deepin.Calculator"
OBJ="/org/deepin/Calculator"
IFACE="org.deepin.Calculator"
APP_ID="org.deepin.calculator"

tool_help() { cat <<'EOF'
calculator — 计算器
  （运行 introspect 查看可用方法，方法名可直接作为操作名调用）
EOF
}
```

使用时：

```bash
# 查看接口
deepin-cli-tools calculator introspect

# 直接调用（通过通用调度，自动 Introspect 匹配）
deepin-cli-tools calculator Calculate "1+2*3"
```

## 参考

* [D-Bus Specification](https://dbus.freedesktop.org/doc/dbus-specification.html)
* [MPRIS D-Bus Interface Specification](https://specifications.freedesktop.org/mpris-spec/latest/)
* [桌面应用打包规范](桌面应用打包规范.md) — D-Bus service 文件安装路径
* [配置文件规范](配置文件规范.md) — ConfigManager D-Bus 接口设计参考
