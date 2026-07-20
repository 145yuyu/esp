# 基于ESP32的城市公园环境多点监测节点设计

> **毕业设计** · 电子信息工程 · 李昆涛 (2312010127)

---

## 硬件配置

| 组件 | 型号 | 说明 |
|------|------|------|
| 中心节点 MCU | **ESP32-S3** | 双核 Xtensa LX7, 240MHz |
| 温湿度传感器 | **DHT22** | 数字温湿度, ±0.5°C / ±2%RH |
| 粉尘传感器 | **GP2Y1014AU** | Sharp 光学粉尘传感器, 模拟输出 |
| 显示屏 | **1.44寸 TFT ST7735** | 128×128 SPI, 12pin 排针+4按键 |
| RGB LED | **WS2812B 5050** | 4位 RGB LED 灯珠 |
| 蜂鸣器 | **有源12095蜂鸣器 5V** | 有源一体, DC通电即响 |
| 子节点 MCU | **ESP32** | Xtensa LX6, 240MHz |
| 子节点传感器 | **DHT22 + GP2Y1014AU** | 温湿度 + 粉尘 |

## 系统架构

```
┌──────────────────┐
│   子节点×N       │  DHT22 + GP2Y1014AU 传感器采集
│  ESP32 Sub Node  │  滑动窗口均值滤波 + 边缘计算
└───────┬──────────┘
        │ ESP-NOW (2.4GHz, 无WiFi路由依赖)
        ▼
┌──────────────────┐
│   中心节点        │  ESP32-S3
│  Center Node     │  DHT22 + GP2Y1014AU + 1.44寸 TFT
│                  │  WS2812B 4位 LED + 有源蜂鸣器
│                  │  HTTP Server (AP模式 192.168.4.1)
└───────┬──────────┘
        │ HTTP POST /api/sensors/ingest
        ▼
┌──────────────────┐
│   后端服务器      │  Node.js + Express + SQLite
│  Backend :3000   │  WebSocket 实时推送
└───────┬──────────┘
        │ HTTP REST + WebSocket
        ▼
┌──────────────────┐
│   Web Dashboard  │  7页监控面板 + 数据可视化
│  Frontend        │  Chart.js + localStorage
└──────────────────┘
```

## 项目结构

```
D:\final work\
├── frontend/              Web 前端仪表盘 (vanilla HTML/CSS/JS)
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── data.js         数据引擎 + 滤波 + 告警
│       ├── data-source.js  数据源抽象层 (模拟/HTTP/WebSocket)
│       ├── charts.js       7种 Chart.js 图表
│       └── app.js          SPA路由 + 7页面渲染
│
├── backend/               Node.js 后端服务器
│   ├── server.js          主入口 (Express + WebSocket)
│   ├── db.js              SQLite 持久化 (sensor_records/alarms/logs)
│   ├── websocket.js       WebSocket 实时广播
│   └── routes/
│       ├── sensors.js     /api/sensors/* (数据摄入+查询)
│       ├── alarms.js      /api/alarms/* (告警管理)
│       └── stats.js       /api/stats/* (分区统计)
│
├── esp32/                 ESP32 固件 (PlatformIO + VS Code)
│   ├── common/protocol.h  通信协议定义 (GP2Y1014AU适配版)
│   ├── center_node/       中心节点 (ESP32-S3, DHT22, GP2Y1014AU, TFT, LED, 蜂鸣器)
│   │   ├── platformio.ini
│   │   ├── main/main.cpp
│   │   └── src/main.cpp
│   ├── center_node_1.44inch/  1.44寸TFT版本 (同中心节点)
│   └── sub_node/          子节点 (DHT22 + GP2Y1014AU)
│       ├── platformio.ini
│       ├── main/main.cpp
│       └── src/main.cpp
│
├── workspace.code-workspace   VS Code 多根工作区
└── README.md
```

## 快速启动

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 启动后端（模拟模式，无需 ESP32）

```bash
cd backend
node server.js --sim
```

### 3. 打开前端

| 场景 | 地址 |
|------|------|
| 本机浏览器 | `http://localhost:3000` |
| 同一 WiFi 下其他设备 | `http://[电脑IP]:3000`（启动时终端会显示） |

### 4. ESP32 部署

- VS Code 安装 `PlatformIO IDE` 扩展
- 打开 `workspace.code-workspace`
- 分别在 center_node 和 sub_node 中点击 PlatformIO → Upload

编译前记得修改 sub_node `main.cpp` 中的 `NODE_ID`、`ZONE_ID` 和 `CENTER_MAC`。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | HTML5, CSS3, Chart.js, JavaScript ES6 |
| 后端 | Node.js, Express, better-sqlite3, WebSocket |
| 设备 | ESP32-S3/ESP32, PlatformIO, Arduino framework, ESP-NOW |
| 通信 | HTTP REST + WebSocket + ESP-NOW |
| 传感器 | DHT22 (温湿度) + GP2Y1014AU (粉尘浓度) |

## 数据流

```
DHT22/GP2Y1014AU → 子节点滤波 → ESP-NOW → 中心节点HTTP → 后端SQLite → WebSocket → 前端Chart.js
                  中心节点本地采集 ← DHT22/GP2Y1014AU (ESP32-S3)
```

## 开发环境

- **VS Code** + PlatformIO + ESLint
- **Node.js 18+**
- **ESP32-S3 DevKitC** × 1 (中心节点)
- **ESP32 DevKitC** × N (子节点)
- **传感器** DHT22 × (N+1) + GP2Y1014AU × (N+1)
- **屏幕** TFT 1.44寸 ST7735 128×128 × 1
- **LED** WS2812B 5050 4位 × 1
- **蜂鸣器** 有源12095 5V × 1
