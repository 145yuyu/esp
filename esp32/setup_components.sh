#!/bin/bash
# ============================================================
#  ESP32 项目依赖库一键克隆脚本
#
#  运行前确保已安装:
#    - ESP-IDF (v5.x 推荐) + idf.py 在 PATH 中
#    - git
#
#  用法:
#    cd d:/final work/esp32
#    bash setup_components.sh
# ============================================================

set -e

echo "=============================================="
echo "  ESP32 依赖组件安装"
echo "=============================================="

# ---- 中心节点: TFT_eSPI (LCD 驱动) ----
echo ""
echo "[1/4] 克隆 TFT_eSPI (中心节点 LCD 驱动)..."
TFT_DIR="center_node/components/TFT_eSPI"
if [ -f "$TFT_DIR/TFT_eSPI.cpp" ]; then
    echo "  → 已存在，跳过"
else
    git clone --depth 1 https://github.com/Bodmer/TFT_eSPI.git "$TFT_DIR"
    echo "  → 完成"
fi

# ---- 中心节点: FastLED (WS2812B) ----
echo ""
echo "[2/4] 克隆 FastLED (中心节点 LED 驱动)..."
FL_DIR="center_node/components/FastLED"
if [ -f "$FL_DIR/FastLED.cpp" ]; then
    echo "  → 已存在，跳过"
else
    git clone --depth 1 https://github.com/FastLED/FastLED.git "$FL_DIR"
    echo "  → 完成"
fi

# ---- 子节点: DHT sensor library ----
echo ""
echo "[3/4] 克隆 DHT sensor library (子节点 DHT22)..."
DHT_DIR="sub_node/components/DHT_sensor_library"
if [ -f "$DHT_DIR/DHT.cpp" ]; then
    echo "  → 已存在，跳过"
else
    git clone --depth 1 https://github.com/adafruit/DHT-sensor-library.git "$DHT_DIR"
    echo "  → 完成"
fi

# ---- 子节点: Adafruit Unified Sensor ----
echo ""
echo "[4/4] 克隆 Adafruit Unified Sensor (DHT 依赖)..."
ADR_DIR="sub_node/components/Adafruit_Unified_Sensor"
if [ -f "$ADR_DIR/Adafruit_Sensor.cpp" ]; then
    echo "  → 已存在，跳过"
else
    git clone --depth 1 https://github.com/adafruit/Adafruit_Sensor.git "$ADR_DIR"
    echo "  → 完成"
fi

echo ""
echo "=============================================="
echo "  所有依赖组件安装完成！"
echo ""
echo "  下一步:"
echo "    1. cd center_node"
echo "    2. idf.py set-target esp32"
echo "    3. idf.py build"
echo ""
echo "  子节点:"
echo "    1. cd sub_node"
echo "    2. idf.py set-target esp32"
echo "    3. idf.py build"
echo "=============================================="
