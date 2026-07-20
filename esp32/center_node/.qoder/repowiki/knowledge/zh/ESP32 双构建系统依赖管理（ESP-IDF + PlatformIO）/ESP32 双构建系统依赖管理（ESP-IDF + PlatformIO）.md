---
kind: dependency_management
name: ESP32 双构建系统依赖管理（ESP-IDF + PlatformIO）
category: dependency_management
scope:
    - '**'
source_files:
    - main/idf_component.yml
    - main/CMakeLists.txt
    - CMakeLists.txt
    - platformio.ini
    - components/FastLED/CMakeLists.txt
    - components/TFT_eSPI/CMakeLists.txt
---

本项目为 ESP32-S3 中心节点，同时支持 ESP-IDF 与 PlatformIO 两套构建入口，依赖来源采用托管组件加本地子模块/目录混合模式。

### 1. 使用的系统与工具
- ESP-IDF 组件管理器：通过 main/idf_component.yml 声明对 espressif/arduino-esp32: ^3.0 的依赖，由 idf.py reconfigure 自动从 Espressif 官方包源下载。
- ESP-IDF CMake 组件机制：根 CMakeLists.txt 将 components/ 和 ../common 加入 EXTRA_COMPONENT_DIRS，使 components/ 下的第三方库以本地 ESP-IDF 组件形式参与编译。
- PlatformIO：platformio.ini 使用 lib_deps 声明 Arduino 生态库，其中 TFT_eSPI 通过 file:// 协议指向本地路径 ../common/TFT_eSPI，其余库走 PlatformIO 包仓库。

### 2. 关键文件与位置
- main/idf_component.yml：ESP-IDF 托管依赖清单（仅 arduino-esp32）。
- main/CMakeLists.txt：main 组件注册，REQUIRES arduino-esp32 protocol 声明组件级依赖。
- CMakeLists.txt：项目级 CMake，注入 components/ 与 ../common 两个额外组件目录。
- components/FastLED/CMakeLists.txt、components/TFT_eSPI/CMakeLists.txt：第三方库的 ESP-IDF 组件包装，要求源码已克隆到对应目录。
- platformio.ini：PlatformIO 环境配置，lib_deps 中混用本地 file:// 与远程包名加语义版本。

### 3. 架构与约定
- 分层依赖来源：托管依赖（如 arduino-esp32）由 ESP-IDF Component Manager 负责拉取与版本锁定；大型第三方库（FastLED、TFT_eSPI）以 git clone 方式驻留在 components/ 或 ../common/，作为本地组件被 CMake 直接编译；小型 Arduino 库通过 PlatformIO lib_deps 按 ^x.y.z 语义版本拉取。
- 配置与代码分离：TFT_eSPI 的引脚/驱动宏既可在 platformio.ini 的 build_flags 中以 -D 传入，也可通过 TFT_Config/User_Setup.h 在 ESP-IDF 下切换，避免硬编码。
- 组件 REQUIRES 链：main 组件显式 REQUIRES arduino-esp32 protocol，确保链接顺序与头文件包含正确。

### 4. 开发者应遵循的规则
- 新增托管依赖时，优先写入 main/idf_component.yml，并通过 idf.py reconfigure 更新；不要手动修改生成的 sdkconfig。
- 需要引入新的第三方库且其体积较大时，将其克隆至 components/<Name>/ 并编写对应的 CMakeLists.txt 组件包装，同时在 main/CMakeLists.txt 的 REQUIRES 中声明。
- 若仅做快速验证或 Arduino 风格开发，可在 platformio.ini 的 lib_deps 中添加库，但注意保持与 ESP-IDF 侧的宏定义一致（尤其是 TFT 相关 -D 标志）。
- 所有版本约束使用语义化版本（^x.y.z），禁止固定死版本号，以便后续安全更新。