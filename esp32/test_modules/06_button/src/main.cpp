/**
 * 模块测试 06 — 按键输入测试
 *
 * 接线:
 *   K1 (上键) → GPIO9  (接 GND, 启用内部上拉)
 *   K2 (下键) → GPIO10 (接 GND, 启用内部上拉)
 *
 * 预期:
 *   按下按键时串口打印按键编号和状态。
 *   带 50ms 软件去抖。
 */

#include <Arduino.h>

#define KEY_UP   9
#define KEY_DOWN 10

unsigned long last_debounce = 0;

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== 按键输入测试 ===\n");
    Serial.println("按 K1(上键 GPIO9) 或 K2(下键 GPIO10) 测试...\n");

    pinMode(KEY_UP,   INPUT_PULLUP);
    pinMode(KEY_DOWN, INPUT_PULLUP);
}

void loop() {
    unsigned long now = millis();
    if (now - last_debounce < 50) {
        delay(5);
        return;
    }

    bool up   = (digitalRead(KEY_UP)   == LOW);
    bool down = (digitalRead(KEY_DOWN) == LOW);

    if (up && down) {
        Serial.printf("[KEY] 双键同时按下! (时间: %lu ms)\n", now);
        last_debounce = now;
    } else if (up) {
        Serial.printf("[KEY] K1 上键按下 (GPIO9)  [上一页]\n");
        last_debounce = now;
    } else if (down) {
        Serial.printf("[KEY] K2 下键按下 (GPIO10) [下一页]\n");
        last_debounce = now;
    }

    delay(5);
}
