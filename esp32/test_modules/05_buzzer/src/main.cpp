/**
 * 模块测试 05 — 有源蜂鸣器测试
 *
 * 接线:
 *   有源蜂鸣器 + → 5V (VIN)
 *   有源蜂鸣器 - → S8050 NPN C极
 *   S8050 B极 → GPIO6 (串 1KΩ 电阻)
 *   S8050 E极 → GND
 *
 * 预期:
 *   蜂鸣器依次发出: 短促3声 → 间歇 → 持续 → 静音 → 重复
 */

#include <Arduino.h>

#define BUZZER_PIN 6

void beep(int ms_on, int ms_off, int repeat) {
    for (int i = 0; i < repeat; i++) {
        digitalWrite(BUZZER_PIN, HIGH);
        delay(ms_on);
        digitalWrite(BUZZER_PIN, LOW);
        if (ms_off > 0) delay(ms_off);
    }
}

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== 有源蜂鸣器测试 ===\n");

    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
    Serial.printf("[INFO] 蜂鸣器引脚: GPIO%d\n", BUZZER_PIN);
}

void loop() {
    Serial.println("[TEST] 短促3声 (WARNING模式: 150ms ON / 850ms OFF)");
    beep(150, 850, 3);
    delay(500);

    Serial.println("[TEST] 间歇3声 (DANGER模式: 400ms ON / 600ms OFF)");
    beep(400, 600, 3);
    delay(500);

    Serial.println("[TEST] 持续1声 (CRITICAL模式: 1500ms ON)");
    beep(1500, 300, 1);
    delay(500);

    Serial.println("[TEST] 静音 2 秒");
    digitalWrite(BUZZER_PIN, LOW);
    delay(2000);

    Serial.println("--- 循环 ---\n");
}
