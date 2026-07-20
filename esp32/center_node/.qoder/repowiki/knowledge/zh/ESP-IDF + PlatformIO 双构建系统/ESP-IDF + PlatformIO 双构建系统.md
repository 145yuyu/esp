---
kind: build_system
name: ESP-IDF + PlatformIO 双构建系统
category: build_system
scope:
    - '**'
source_files:
    - CMakeLists.txt
    - platformio.ini
    - main/CMakeLists.txt
    - main/idf_component.yml
    - sdkconfig.defaults
    - components/FastLED/CMakeLists.txt
    - components/TFT_eSPI/CMakeLists.txt
---

本项目为 ESP32-S3 中心节点，同时提供 ESP-IDF 与 PlatformIO 两套构建入口，面向不同开发环境（命令行/CI 使用 ESP-IDF，VS Code 调试使用 PlatformIO）。

## 1. 构建系统与工具链
- ESP-IDF 构建：基于 CMake，根 CMakeLists.txt 通过 EXTRA_COMPONENT_DIRS 引入 components/ 与外部 ../common 目录，并包含 $ENV{IDF_PATH}/tools/cmake/project.cmake。
- PlatformIO 构建：platformio.ini 声明 espressif32 平台、esp32-s3-devkitc-1 板型、Arduino 框架，并通过 lib_deps 拉取 TFT_eSPI 本地库与 DHT 传感器库。
- 组件管理：ESP-IDF 5.x 组件管理器通过 main/idf_component.yml 声明对 espressif/arduino-esp32: ^3.0 的依赖；第三方库 FastLED、TFT_eSPI 以本地子模块形式克隆到 components/ 下，各自提供 CMakeLists.txt 包装成 idf 组件。

## 2. 关键文件与职责
- CMakeLists.txt：ESP-IDF 工程入口，注册组件目录、包含 IDF CMake 脚本
- main/CMakeLists.txt：main 组件定义，注册 main.cpp 及 REQUIRES 依赖
- main/idf_component.yml：托管组件依赖清单（arduino-esp32）
- platformio.ini：PlatformIO 环境配置（板型、框架、宏、串口速率）
- sdkconfig.defaults：ESP-IDF 默认 Kconfig 配置（Wi-Fi SSID/PWD、ESP-NOW、日志级别等）
- components/FastLED/CMakeLists.txt：FastLED 库的 idf 组件包装
- components/TFT_eSPI/CMakeLists.txt：TFT_eSPI 库的 idf 组件包装

## 3. 架构与约定
- 双构建共存：同一份源码同时被 ESP-IDF 和 PlatformIO 消费。PlatformIO 侧通过 -I ../common 和 file://../common/TFT_eSPI 指向共享代码，避免重复。
- 组件化组织：所有第三方库以 components/<name>/CMakeLists.txt 形式封装为 idf 组件，遵循 idf_component_register(SRCS ... INCLUDE_DIRS ... REQUIRES ...) 规范。
- 硬件抽象集中：TFT 驱动引脚、SPI 频率等通过 platformio.ini 的 build_flags = -D ... 宏注入，同时在 sdkconfig.defaults 中固化 Wi-Fi/ESP-NOW 等运行时参数。
- 依赖来源混合：托管依赖走 idf_component.yml（联网下载），本地私有库（FastLED、TFT_eSPI）直接 git clone 到 components/，形成托管加本地混合策略。

## 4. 开发者应遵循的规则
1. 新增组件：在 components/ 下创建 <Name>/CMakeLists.txt，使用 idf_component_register 注册源文件、头文件路径与 REQUIRES 依赖。
2. 新增宏定义：优先写入 sdkconfig.defaults（Kconfig 常量）；仅在 PlatformIO 侧需要时追加到 platformio.ini 的 build_flags。
3. 新增托管依赖：编辑 main/idf_component.yml，运行 idf.py reconfigure 自动拉取。
4. 保持双构建兼容：修改 platformio.ini 时需同步检查 ESP-IDF 侧是否也需要对应宏或 include 路径。
5. 不要硬编码板级引脚：将引脚、SPI 频率等通过宏或 User_Setup.h 暴露，由上层选择。

当前仓库未包含 Makefile、Dockerfile、CI 流水线或发布脚本，因此本卡片仅覆盖已存在的 ESP-IDF / PlatformIO 构建体系。