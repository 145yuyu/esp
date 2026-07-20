/**
 * 模块测试 03 — ST7735 1.44寸 TFT LCD 显示测试
 *
 * 接线 (12pin, SPI):
 *   Pin1  GND  → GND
 *   Pin2  VCC  → 3.3V
 *   Pin3  SCL  → GPIO18 (SPI SCK)
 *   Pin4  SDA  → GPIO17 (SPI MOSI)
 *   Pin5  RES  → GPIO21
 *   Pin6  DC   → GPIO4
 *   Pin7  CS   → GPIO5
 *   Pin8  BL   → 3.3V (背光常亮)
 *
 * 预期:
 *   屏幕依次显示: 纯色填充(红→绿→蓝→白→黑) → 文字 → 几何图形 → 循环动画
 */

#include <Arduino.h>
#include <TFT_eSPI.h>

TFT_eSPI tft = TFT_eSPI();

void color_fill_test() {
    const uint16_t colors[] = { TFT_RED, TFT_GREEN, TFT_BLUE, TFT_WHITE, TFT_BLACK };
    const char* names[] = { "RED", "GREEN", "BLUE", "WHITE", "BLACK" };

    for (int i = 0; i < 5; i++) {
        tft.fillScreen(colors[i]);
        tft.setTextColor(TFT_WHITE, colors[i]);
        tft.setTextFont(2);
        tft.drawString(names[i], 40, 55, 2);
        delay(800);
    }
}

void text_test() {
    tft.fillScreen(TFT_BLACK);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);

    tft.setTextFont(1);
    tft.drawString("Font1: ABC abc 123", 2, 2, 1);

    tft.setTextFont(2);
    tft.drawString("Font2: T=25.3C", 2, 16, 2);

    tft.setTextColor(TFT_CYAN, TFT_BLACK);
    tft.drawString("CYAN text", 2, 40, 2);

    tft.setTextColor(TFT_YELLOW, TFT_BLACK);
    tft.drawString("YELLOW text", 2, 60, 2);

    tft.setTextColor(TFT_MAGENTA, TFT_BLACK);
    tft.drawString("MAGENTA text", 2, 80, 2);

    tft.setTextColor(TFT_GREEN, TFT_BLACK);
    tft.drawString("GREEN text", 2, 100, 2);
    delay(2000);
}

void geometry_test() {
    tft.fillScreen(TFT_BLACK);

    // 矩形边框 + 填充
    tft.drawRect(2, 2, 30, 30, TFT_RED);
    tft.fillRect(36, 2, 30, 30, TFT_GREEN);

    // 圆角矩形
    tft.drawRoundRect(70, 2, 30, 30, 5, TFT_BLUE);

    // 圆形
    tft.drawCircle(20, 65, 14, TFT_YELLOW);
    tft.fillCircle(55, 65, 14, TFT_MAGENTA);

    // 线条
    tft.drawLine(2, 95, 126, 95, TFT_CYAN);
    tft.drawLine(2, 105, 126, 105, TFT_ORANGE);

    // AQI 模拟数据
    tft.setTextFont(2);
    tft.setTextColor(TFT_GREEN, TFT_BLACK);
    tft.drawString("AQI: 42", 35, 55, 2);

    delay(3000);
}

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== ST7735 TFT LCD 显示测试 ===\n");

    tft.init();
    tft.setRotation(0);
    tft.fillScreen(TFT_BLACK);

    Serial.println("[TEST] 纯色填充...");
    color_fill_test();

    Serial.println("[TEST] 文字显示...");
    text_test();

    Serial.println("[TEST] 几何图形...");
    geometry_test();

    Serial.println("[INFO] 测试完成，进入循环动画模式\n");
}

void loop() {
    // 边框呼吸灯效果
    for (int b = 0; b < 64; b++) {
        uint16_t c = tft.color565(b * 4, 0, 63 - b);
        tft.drawRect(0, 0, 128, 128, c);
        tft.setTextColor(TFT_WHITE, TFT_BLACK);
        tft.setTextFont(2);
        tft.drawString("LCD OK!", 30, 55, 2);
        delay(30);
    }
    for (int b = 63; b >= 0; b--) {
        uint16_t c = tft.color565(b * 4, 0, 63 - b);
        tft.drawRect(0, 0, 128, 128, c);
        tft.drawString("LCD OK!", 30, 55, 2);
        delay(30);
    }
}
