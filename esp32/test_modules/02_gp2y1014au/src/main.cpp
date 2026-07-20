/**
 * 模块测试 02 — GP2Y1014AU 粉尘传感器
 *
 * 接线 (ESP32-S3):
 *   GP2Y1014AU Vcc → 5V (VIN)
 *   GP2Y1014AU GND → GND
 *   GP2Y1014AU LED → GPIO7  (经 NPN 三极管驱动 IR LED)
 *   GP2Y1014AU Vo  → GPIO34 (ADC1_CH6, 经 10K+10K 分压)
 *
 * 注意:
 *   - Vo 输出 max≈3.6V@5V，经 1:2 分压后 max≈1.8V，安全进入 ESP32 ADC
 *   - 传感器需要约 10ms 完成一次测量周期
 *
 * 预期输出:
 *   串口每秒输出一次粉尘浓度 (ug/m³) 和空气质量等级。
 *   无粉尘环境下读数应接近 0~10 ug/m³。
 */

#include <Arduino.h>

#define DUST_LED_PIN  7     // IR LED 驱动引脚
#define DUST_ADC_PIN  34    // Vo 输出电压 ADC 引脚

uint16_t read_dust() {
    digitalWrite(DUST_LED_PIN, HIGH);
    delayMicroseconds(280);

    uint32_t sum = 0;
    for (int i = 0; i < 16; i++) {
        sum += analogRead(DUST_ADC_PIN);
        delayMicroseconds(40);
    }
    uint16_t adc_avg = sum / 16;

    digitalWrite(DUST_LED_PIN, LOW);
    delayMicroseconds(9680);

    float adc_v = adc_avg * (3.3f / 4095.0f);   // ADC → 电压
    float vo   = adc_v * 2.0f;                    // 反推分压前电压

    // GP2Y1014AU 转换公式 (datasheet)
    float dust_mg = (vo * 10.0f / 5.0f - 0.6f) / 0.172f;
    if (dust_mg < 0.0f) dust_mg = 0.0f;
    return (uint16_t)(dust_mg * 1000.0f);         // mg/m³ → ug/m³
}

const char* dust_grade(uint16_t ug) {
    if (ug <= 35)  return "优";
    if (ug <= 75)  return "良";
    if (ug <= 115) return "轻度污染";
    if (ug <= 150) return "中度污染";
    if (ug <= 250) return "重度污染";
    return "严重污染";
}

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== GP2Y1014AU 粉尘传感器测试 ===\n");

    pinMode(DUST_LED_PIN, OUTPUT);
    digitalWrite(DUST_LED_PIN, LOW);

    analogReadResolution(12);
    analogSetAttenuation(ADC_11db);

    // 丢弃前 5 次读数 (传感器稳定)
    Serial.print("[INFO] 传感器预热中");
    for (int i = 0; i < 5; i++) {
        read_dust();
        delay(12);
        Serial.print(".");
    }
    Serial.println(" OK\n");
}

void loop() {
    uint16_t dust = read_dust();
    uint32_t adc_raw = analogRead(DUST_ADC_PIN);
    float adc_v = adc_raw * (3.3f / 4095.0f) * 2.0f;

    Serial.printf("粉尘: %d ug/m³ | 等级: %s | ADC原始: %d | Vo≈%.3fV\n",
                  dust, dust_grade(dust), adc_raw, adc_v);
    delay(1000);
}
