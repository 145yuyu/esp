---
kind: logging_system
name: 基于 Arduino Serial.printf 的嵌入式调试日志
category: logging_system
scope:
    - '**'
source_files:
    - main/main.cpp
---

本仓库未引入任何结构化日志框架（如 ESP-IDF esp_log、ESP32-Arduino 的 Logger 等），所有输出均通过 Arduino 框架的 `Serial` 对象以 `printf`/`print`/`println` 直接写入串口，波特率固定为 115200。日志组织完全依赖开发者在字符串前手动添加方括号标签来区分模块，例如 `[SENSOR]`、`[UPLOAD]`、`[RX]`、`[ALERT]`、`[KEY]`、`[WiFi]`、`[ESP-NOW]`、`[LED]`、`[DHT]`、`[DUST]`、`[HTTP]`、`[SYS]`、`[FAULT]`、`[FATAL]` 等；没有统一的日志级别宏或开关，也没有将日志路由到文件、网络或 TFT 屏幕以外的 sink。

关键特征：
- 唯一入口：`main/main.cpp` 中 `setup()` 调用 `Serial.begin(115200)`，此后全程序共用该串口输出。
- 无日志初始化配置：未见 `esp_log_level_set`、`log_set_level` 等调用，无法在运行时调整级别。
- 无结构化字段：日志行是拼接后的纯文本，不包含 JSON 或键值对，解析需依赖正则匹配标签。
- 无分级策略：错误与调试信息混排，仅靠标签语义区分严重性（如 `[FATAL]` 用于互斥锁创建失败后进入死循环）。
- 无多 sink：所有输出仅走 UART，未集成到 HTTP `/api/health` 或 TFT 显示区作为“系统日志页”。

因此，当前项目属于“裸串口调试输出”模式，不具备可配置的日志系统能力。