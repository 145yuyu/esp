/**
 * 模块测试 04 — 预警 LED 灯珠测试 (GPIO 直驱)
 *
 * 接线:
 *   GPIO2  ──[220Ω]──→ 绿色LED(+) ──→ GND
 *   GPIO3  ──[220Ω]──→ 黄色LED(+) ──→ GND
 *   GPIO38 ──[220Ω]──→ 橙色LED(+) ──→ GND
 *   GPIO39 ──[220Ω]──→ 红色LED(+) ──→ GND
 *
 * 预期:
 *   LED 依次循环: 全灭 → 仅绿 → 绿+黄 → 绿+黄+橙 → 全亮 → 闪烁 → 重复
 */

#include <Arduino.h>

#define LED_GREEN  2
#define LED_YELLOW 3
#define LED_ORANGE 38
#define LED_RED    39

void all_off() {
    digitalWrite(LED_GREEN,  LOW);
    digitalWrite(LED_YELLOW, LOW);
    digitalWrite(LED_ORANGE, LOW);
    digitalWrite(LED_RED,    LOW);
}

void show_level(int level) {
    all_off();
    if (level >= 1) digitalWrite(LED_GREEN,  HIGH);   // NORMAL
    if (level >= 2) digitalWrite(LED_YELLOW, HIGH);   // WARNING
    if (level >= 3) digitalWrite(LED_ORANGE, HIGH);   // DANGER
    if (level >= 4) digitalWrite(LED_RED,    HIGH);   // CRITICAL
}

void blink_all(int times, int ms_on, int ms_off) {
    for (int i = 0; i < times; i++) {
        digitalWrite(LED_GREEN,  HIGH);
        digitalWrite(LED_YELLOW, HIGH);
        digitalWrite(LED_ORANGE, HIGH);
        digitalWrite(LED_RED,    HIGH);
        delay(ms_on);
        all_off();
        delay(ms_off);
    }
}

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== 预警 LED 灯珠测试 ===\n");

    pinMode(LED_GREEN,  OUTPUT);
    pinMode(LED_YELLOW, OUTPUT);
    pinMode(LED_ORANGE, OUTPUT);
    pinMode(LED_RED,    OUTPUT);
    all_off();

    Serial.printf("LED 引脚: 绿=GPIO%d 黄=GPIO%d 橙=GPIO%d 红=GPIO%d\n",
                  LED_GREEN, LED_YELLOW, LED_ORANGE, LED_RED);
}

void loop() {
    Serial.println("[TEST] 逐级点亮 →");
    for (int lv = 1; lv <= 4; lv++) {
        show_level(lv);
        const char* names[] = {"", "NORMAL(绿)", "WARNING(绿+黄)",
                               "DANGER(绿+黄+橙)", "CRITICAL(全亮)"};
        Serial.printf("  等级 %d: %s\n", lv, names[lv]);
        delay(1000);
    }

    Serial.println("[TEST] 全灭 →");
    all_off();
    delay(500);

    Serial.println("[TEST] 全部闪烁 3 次 →");
    blink_all(3, 200, 200);
    delay(500);

    Serial.println("[TEST] 单灯巡检 →");
    const int pins[] = {LED_GREEN, LED_YELLOW, LED_ORANGE, LED_RED};
    const char* pnames[] = {"绿", "黄", "橙", "红"};
    for (int i = 0; i < 4; i++) {
        all_off();
        digitalWrite(pins[i], HIGH);
        Serial.printf("  %s (GPIO%d)\n", pnames[i], pins[i]);
        delay(600);
    }
    all_off();
    delay(1000);

    Serial.println("--- 循环 ---\n");
}
