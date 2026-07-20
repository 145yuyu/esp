---
kind: configuration_system
name: ESP-IDF/PlatformIO 双构建配置与编译期宏体系
category: configuration_system
scope:
    - '**'
source_files:
    - sdkconfig.defaults
    - platformio.ini
    - CMakeLists.txt
    - main/CMakeLists.txt
    - main/idf_component.yml
    - components/TFT_Config/User_Setup.h
    - main/main.cpp
---

本仓库为 ESP32-S3 中心节点工程，采用 **ESP-IDF + PlatformIO 双构建入口**，通过两套配置文件共同决定运行时行为。配置分为三层：

1. **构建系统层（CMake / platformio.ini）**
   - `CMakeLists.txt` 将 `components/` 和 `../common` 加入 EXTRA_COMPONENT_DIRS，并包含 IDF 的 project.cmake；`main/CMakeLists.txt` 声明 main 组件依赖 arduino-esp32 与 protocol。
   - `platformio.ini` 定义 esp32-s3-devkitc-1 板型、Arduino 框架、monitor/upload 速率，并通过 `-D` 宏覆盖 TFT_eSPI 引脚、分辨率、SPI 频率等显示参数，同时设置 CORE_DEBUG_LEVEL=3。

2. **ESP-IDF 默认配置层（sdkconfig.defaults）**
   - 提供 Wi-Fi SSID/密码、ESP-NOW 最大加密数、FreeRTOS HZ、日志级别、主任务栈大小、SPI ISR 在 IRAM 等默认 Kconfig 值，供 IDF 构建时直接生效。

3. **应用层编译期常量（main/main.cpp）**
   - 大量硬件引脚、轮询/上报/刷新间隔、WiFi AP/STA 凭据、后端服务器地址、子节点 MAC 表、MAX_NODES 等均以 `#define` / `const char*` / 数组形式硬编码在源码中，烧录前需手动修改。
   - TFT 驱动另有独立头文件 `components/TFT_Config/User_Setup.h`，集中定义 ST7735 驱动芯片、分辨率、SPI 引脚、背光、旋转方向与字体开关，与 platformio.ini 中的 `-D` 宏形成双重覆盖。

4. **组件依赖声明（idf_component.yml）**
   - 仅声明 espressif/arduino-esp32 ^3.0，其余库通过 platformio.ini 的 lib_deps 或本地 components/ 目录引入。

**设计特点与约定：**
- 无运行时配置文件（JSON/YAML/.env），所有“可配置项”均为编译期宏或 C 常量，部署前通过修改源码或 platformio.ini 完成。
- 同一类配置（如 TFT 引脚）在 `User_Setup.h` 与 `platformio.ini` 两处重复声明，便于 Arduino 框架与 PlatformIO 分别消费。
- 敏感信息（Wi-Fi 密码、后端 URL）以明文常量存放，未使用 NVS/Flash 持久化或环境变量注入机制。
- 未实现多环境（dev/stage/prod）切换逻辑，亦无运行时 feature flag 机制。