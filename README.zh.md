# mimo2codex

> [English](./README.md) · 中文

本地代理，让**最新版** OpenAI Codex 桌面端无缝接入**小米 MiMo** 和 **DeepSeek** 等模型。把 Codex 的 Responses API 实时翻译成 Chat Completions API，纯本地无状态转换。

可独立使用，也可作为自定义供应商配置进 [cc-switch](https://github.com/farion1231/cc-switch)，与 OpenAI 官方、Azure 等其他 Codex 供应商**一键切换**。

> **注意：** Codex 自带的 `/hatch` 宠物生成功能需要 OpenAI 的图片生成 API，使用本代理时无法直接使用。但我们提供了替代方案，可以免费生成自定义宠物，详见 [`codex_pet_generate/`](./codex_pet_generate/)。

***

## 解决什么问题

Codex 使用 OpenAI 的 Responses API，但 MiMo 和 DeepSeek 只支持 Chat Completions API。官方方案是降级 Codex（丢失新功能），本项目用协议翻译代理解决：

```
Codex 桌面端 → Responses API → mimo2codex 本地代理 → Chat Completions API → MiMo / DeepSeek
```

类似 [openrouter](https://openrouter.ai)、[y-router](https://github.com/luohy15/y-router)——纯协议网关，不缓存、不存储。

## 支持的能力

- ✅ Codex CLI / 桌面端（macOS / Windows）
- ✅ Pet 宠物、工具调用（含并行）、多轮对话
- ✅ 流式 SSE，完整 Responses 事件序列
- ✅ 思维链透传（reasoning\_content）
- ✅ MiMo Web Search 翻译
- ✅ 多 Provider 支持（MiMo / DeepSeek）
- ✅ cc-switch 集成，一键切换

***

## 快速开始

### 方式一：使用 cc-switch（推荐）

cc-switch 是一个桌面 App，可以管理多个 Codex 供应商并一键切换。**推荐使用这种方式**，因为：
- 不会覆盖你原有的 OpenAI 配置
- 可以在 MiMo、DeepSeek、OpenAI 之间自由切换
- 配置更简单，粘贴即可

#### 步骤 1：安装 mimo2codex

```bash
npm install -g mimo2codex
```

需要 Node.js ≥ 18。

#### 步骤 2：启动代理

打开一个终端窗口，启动代理（代理需要一直运行）：

**MiMo（Token 套餐）：**
```bash
MIMO_API_KEY=tp-xxx mimo2codex --base-url https://token-plan-cn.xiaomimimo.com/v1 --no-web-search
```

**MiMo（按量付费）：**
```bash
MIMO_API_KEY=sk-xxx mimo2codex
```

**DeepSeek：**
```bash
DEEPSEEK_API_KEY=sk-xxx mimo2codex --provider deepseek
```

**同时运行两个 Provider（不同端口）：**
```bash
# 终端 1 — MiMo
MIMO_API_KEY=tp-xxx mimo2codex --base-url https://token-plan-cn.xiaomimimo.com/v1 --no-web-search --port 8788

# 终端 2 — DeepSeek
DEEPSEEK_API_KEY=sk-xxx mimo2codex --provider deepseek --port 8789
```

Windows 用户可以用根目录的 `start_all_proxies.bat` 一键启动两个代理【注意填写好你自己的 API Key】。

启动成功后，终端会显示：
```
mimo2codex listening on http://127.0.0.1:8788
```

#### 步骤 3：获取 cc-switch 配置

在**另一个终端**运行：

```bash
# MiMo 配置
mimo2codex print-cc-switch

# 或者 DeepSeek 配置
mimo2codex --provider deepseek --port 8789 print-cc-switch
```

会输出类似这样的内容：
```
# ───────── auth.json ─────────
{
  "OPENAI_API_KEY": "mimo2codex-local"
}

# ───────── config.toml ─────────
model_provider = "mimo2codex"
model = "mimo-v2.5-pro"

[model_providers.mimo2codex]
name = "MiMo (via mimo2codex)"
base_url = "http://127.0.0.1:8788/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1
```

#### 步骤 4：在 cc-switch 中添加供应商

1. 打开 cc-switch 应用
2. 点击 **Add Provider** → 选择 **Codex** 标签页 → 点击 **Custom**
3. **auth.json 文本框**：粘贴上面输出的 auth.json 内容
4. **config.toml 文本框**：粘贴上面输出的 config.toml 内容
5. 点击保存

#### 步骤 5：切换并使用

1. 在 cc-switch 中选择你刚添加的供应商（如 "MiMo (via mimo2codex)"）
2. cc-switch 会自动写入 `~/.codex/auth.json` 和 `~/.codex/config.toml`
3. **完全退出 Codex 桌面端**（系统托盘 → Quit，不是只关窗口）
4. 重新启动 Codex
5. **关闭 VPN**（如果开着的话）
6. 现在 Codex 就在用 MiMo/DeepSeek 了！

**为什么关 VPN？** Codex 启动时需要连接 `auth.openai.com` 认证（国内需要 VPN），但认证完后，代理连接 MiMo/DeepSeek 是国内直连，不需要 VPN。如果 VPN 一直开着，可能会劫持 `127.0.0.1` 的本地流量，导致代理连接失败或频繁重连。

如果要切换回 OpenAI，在 cc-switch 里选择 OpenAI 即可，无需手动改配置文件。

***

### 方式二：直接配置（不用 cc-switch）

如果你不想用 cc-switch，可以直接修改配置文件。**注意：这会覆盖你原有的 OpenAI 配置。**

#### 步骤 1：安装 mimo2codex

```bash
npm install -g mimo2codex
```

#### 步骤 2：启动代理

同上，在终端启动代理。

#### 步骤 3：生成配置

```bash
mimo2codex print-config
```

输出会告诉你需要写入哪些文件：
```
# Step 1 — write ~/.codex/auth.json
{
  "OPENAI_API_KEY": "mimo2codex-local"
}

# Step 2 — append to ~/.codex/config.toml
model = "mimo-v2.5-pro"
model_provider = "mimo"

[model_providers.mimo]
name = "MiMo (via mimo2codex)"
base_url = "http://127.0.0.1:8788/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1
```

#### 步骤 4：写入配置文件

**Windows 路径：**
- `C:\Users\你的用户名\.codex\auth.json`
- `C:\Users\你的用户名\.codex\config.toml`

**macOS / Linux 路径：**
- `~/.codex/auth.json`
- `~/.codex/config.toml`

将输出的内容按提示写入对应文件。如果文件不存在就创建，已存在就追加或覆盖。

#### 步骤 5：重启 Codex

完全退出 Codex 桌面端（系统托盘 → Quit），重新启动即可。

***

## 可用模型

| Provider     | 模型                       | 说明          |
| ------------ | ------------------------ | ----------- |
| **MiMo**     | `mimo-v2.5-pro`          | 默认，推理能力强    |
| **MiMo**     | `mimo-v2.5-pro[1m]`      | 1M 长上下文     |
| **MiMo**     | `mimo-v2.5`              | 支持图像输入      |
| **MiMo**     | `mimo-v2.5[1m]`          | 图像 + 1M 上下文 |
| **DeepSeek** | `deepseek-v4-flash`      | 默认，快速       |
| **DeepSeek** | `deepseek-v4-flash[1m]`  | 1M 长上下文     |
| **DeepSeek** | `deepseek-v4-pro`        | Pro 版本      |
| **DeepSeek** | `deepseek-v4-pro[1m]`    | Pro + 1M    |
| **DeepSeek** | `deepseek-chat`          | DeepSeek V3 |
| **DeepSeek** | `deepseek-reasoner`      | R1 推理模型     |

> `[1m]` 后缀表示 1M 长上下文窗口。代理会自动剥离此后缀再调用上游 API，无需手动处理。

***

## CLI 参数

| 参数                | 环境变量                       | 默认              | 说明                               |
| ----------------- | -------------------------- | --------------- | -------------------------------- |
| `--provider`      | `MIMO2CODEX_PROVIDER`      | `mimo`          | 上游 provider（`mimo` / `deepseek`） |
| `--model`         | —                          | provider 默认模型   | 覆盖默认模型                           |
| `-p, --port`      | `MIMO2CODEX_PORT`          | `8788`          | 监听端口                             |
| `--host`          | `MIMO2CODEX_HOST`          | `127.0.0.1`     | 绑定地址                             |
| `--base-url`      | —                          | provider 默认 URL | 覆盖上游 API 地址                      |
| `--api-key`       | 见下表                        | —               | 覆盖 API Key                       |
| `--no-web-search` | `MIMO2CODEX_NO_WEB_SEARCH` | 关               | 过滤 web\_search 工具                |
| `--no-reasoning`  | `MIMO2CODEX_NO_REASONING`  | 关               | 隐藏思维链                            |
| `-v, --verbose`   | `MIMO2CODEX_VERBOSE`       | 关               | 详细日志                             |

API Key 环境变量：

| Provider | 环境变量               |
| -------- | ------------------ |
| MiMo     | `MIMO_API_KEY`     |
| DeepSeek | `DEEPSEEK_API_KEY` |

子命令：

```bash
mimo2codex print-config             # 输出 Codex 配置片段
mimo2codex print-cc-switch          # 输出 cc-switch 配置片段
```

***

## 获取 API Key

**MiMo：** [platform.xiaomimimo.com](https://platform.xiaomimimo.com) → 控制台 → API Keys

- `sk-xxx`（按量付费）→ 默认 base URL
- `tp-xxx`（Token 套餐）→ `--base-url https://token-plan-cn.xiaomimimo.com/v1`

**DeepSeek：** [platform.deepseek.com](https://platform.deepseek.com) → API Keys

***

## 故障排查

**Codex 连不上 / 504 / connection refused**

1. 确认代理进程还在运行（终端窗口没有关闭）
2. 测试代理是否正常：`curl http://127.0.0.1:8788/healthz` 应返回 `{"ok":true,...}`
3. config.toml 的 `base_url` 必须以 `/v1` 结尾

**401 / authentication\_error**

API Key 无效，去对应平台重新创建。

**MiMo 400: web search tool found but webSearchEnabled is false**

MiMo 后台没开 Web Search 插件。解决方案：

- 去 [MiMo 控制台 → 插件管理](https://platform.xiaomimimo.com/#/console/plugin) 开启
- 或启动时加 `--no-web-search`

**VPN 问题**

- Codex 桌面端需要连接 `auth.openai.com` 认证，国内需要 VPN
- 但代理连 MiMo/DeepSeek 不需要 VPN（国内直连）
- **正确流程：开 VPN → 启动 Codex → 认证完成 → 关 VPN → 正常使用**
- 如果 VPN 一直开着，会劫持 `127.0.0.1` 本地流量，导致代理连接失败或频繁重连
- 建议在 VPN 设置中绕过 `127.0.0.1`

**cc-switch 切换后 Codex 没变化**

- 确保完全退出 Codex（系统托盘 → Quit），不是只关窗口
- 重新启动 Codex

***

## 项目结构

```
mimo2codex/
├── src/
│   ├── cli.ts              # 入口：argv 解析、启动 server
│   ├── server.ts           # HTTP server，路由 /v1/responses、/v1/models、/healthz
│   ├── config.ts           # Provider 预设、env + flags 合并
│   ├── upstream/
│   │   ├── mimoClient.ts   # 上游 fetch 封装
│   │   └── chatStream.ts   # SSE 流解析
│   ├── translate/
│   │   ├── types.ts        # 类型定义
│   │   ├── reqToChat.ts    # 请求翻译（Responses → Chat）
│   │   ├── respToResponses.ts  # 响应翻译（非流式）
│   │   └── streamToSse.ts  # 流式状态机
│   └── util/
├── test/
├── scripts/
│   ├── install.sh          # 安装脚本
│   ├── install.ps1         # Windows 安装脚本
│   └── mimo_chat.py        # MiMo API 调试工具
├── codex_pet_generate/     # Codex 宠物生成
├── start_all_proxies.bat   # Windows 一键启动
├── stop_all_proxies.bat    # Windows 一键停止
└── package.json
```

## 许可证

MIT
