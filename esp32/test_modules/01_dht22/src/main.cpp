/**
 * 模块测试 01 — DHT22 温湿度传感器
 *
 * 接线:
 *   DHT22 VCC  → 3.3V
 *   DHT22 DATA → GPIO16 (需 10KΩ 上拉到 3.3V)
 *   DHT22 GND  → GND
 *
 * LED 指示:
 *   板上 LED (GPIO48) — 快闪=初始化中, 慢闪=正常运行
 *
 * 预期输出:
 *   串口每秒输出一次温度/湿度读数。
 *   如果持续显示 "读取失败"，请检查 DATA 引脚上拉电阻。
 */

#include <Arduino.h>
#include <DHT.h>

#define DHT_PIN  16
#define DHT_TYPE DHT22
#define LED_PIN  48  // ESP32-S3 DevKitC 板上 LED

DHT dht(DHT_PIN, DHT_TYPE);

void led_blink(int count, int ms_on, int ms_off) {
    for (int i = 0; i < count; i++) {
        digitalWrite(LED_PIN, HIGH);
        delay(ms_on);
        digitalWrite(LED_PIN, LOW);
        delay(ms_off);
    }
}

void setup() {
    pinMode(LED_PIN, OUTPUT);

    // 快闪 5 次 = 初始化中
    led_blink(5, 100, 100);

    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== DHT22 温湿度传感器测试 ===\n");
    dht.begin();
    Serial.println("[INFO] DHT22 已初始化，等待传感器稳定...");
    delay(2000);
}

void loop() {
    // 每次循环短闪一下 = 固件在运行
    digitalWrite(LED_PIN, HIGH);
    delay(50);
    digitalWrite(LED_PIN, LOW);

    float t = dht.readTemperature();
    float h = dht.readHumidity();

    if (isnan(t) || isnan(h)) {
        Serial.println("[ERR] DHT22 读取失败! 请检查接线和上拉电阻。");
        // 读取失败时快闪 3 次
        led_blink(3, 100, 100);
    } else {
        float hi = t;
        if (t >= 27.0f && h >= 40.0f) {
            float t_f = t * 1.8f + 32.0f;
            hi = -42.379f + 2.04901523f * t_f + 10.14333127f * h
                 - 0.22475541f * t_f * h - 0.00683783f * t_f * t_f
                 - 0.05481717f * h * h + 0.00122874f * t_f * t_f * h
                 + 0.00085282f * t_f * h * h - 0.00000199f * t_f * t_f * h * h;
            hi = (hi - 32.0f) / 1.8f;
            if (hi < t) hi = t;
        }

        Serial.printf("温度: %.1f°C | 湿度: %.1f%% | 体感: %.1f°C\n", t, h, hi);
    }

    delay(2000);
}
