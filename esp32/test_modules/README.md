# 城市公园环境监测系统 — 模块独立测试

每个子目录是一个独立的 PlatformIO 项目，**可单独编译烧录**，用于验证单一硬件模块是否正常工作。

## 目录

| 编号 | 模块 | 测试内容 | 依赖库 |
|------|------|----------|--------|
| 01 | DHT22 | 温湿度传感器读数 | DHT sensor library |
| 02 | GP2Y1014AU | 粉尘传感器读数 | 无 |
| 03 | ST7735 TFT | LCD 显示 (纯色/文字/图形) | TFT_eSPI |
| 04 | LED 预警灯 | GPIO 直驱 4 色 LED 级联点亮 | 无 |
| 05 | 有源蜂鸣器 | 短促/间歇/持续鸣响 | 无 |
| 06 | 按键 | K1/K2 输入检测 + 去抖 | 无 |
| 07 | WiFi + HTTP | AP+STA 双模式 + HTTP Server | 无 |
| 08 | ESP-NOW | 双板通信 (收发对测) | 无 |

## 使用方法

```bash
# 1. 进入测试目录
cd 01_dht22

# 2. 编译并烧录
pio run -t upload

# 3. 打开串口监视器
pio device monitor
```

## 测试顺序建议

```
01 DHT22 ──→ 02 粉尘 ──→ 03 TFT ──→ 04 LED ──→ 05 蜂鸣器 ──→ 06 按键
                                    ↓
                              07 WiFi/HTTP (需要手机/电脑配合)
                                    ↓
                              08 ESP-NOW (需要 2 块 ESP32)
```

## 引脚总览 (ESP32-S3)

```
传感器:
  DHT22 DATA       → GPIO16
  GP2Y1014AU Vo    → GPIO34 (ADC)
  GP2Y1014AU LED   → GPIO7

显示:
  TFT CS   → GPIO5
  TFT DC   → GPIO4
  TFT RST  → GPIO21
  TFT MOSI → GPIO17
  TFT SCK  → GPIO18

执行器:
  LED 绿 → GPIO2
  LED 黄 → GPIO3
  LED 橙 → GPIO38
  LED 红 → GPIO39
  蜂鸣器  → GPIO6

输入:
  K1 上键 → GPIO9
  K2 下键 → GPIO10
```
