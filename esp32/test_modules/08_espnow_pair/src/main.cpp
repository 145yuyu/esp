/**
 * 模块测试 08 — ESP-NOW 通信对测试
 *
 * 需要 2 块 ESP32 开发板:
 *   - 一块设为 SENDER   (发送方)
 *   - 一块设为 RECEIVER (接收方)
 *
 * 使用前:
 *   1. 将下方 ROLE 设为本板角色 (SENDER 或 RECEIVER)
 *   2. 将 RECEIVER_MAC 设为接收方的 WiFi MAC 地址
 *      (接收方启动后串口会打印自己的 MAC)
 *   3. 分别编译烧录两块板
 *
 * 预期:
 *   SENDER 每秒发一条带计数器的消息
 *   RECEIVER 收到后打印消息内容并通过串口确认
 */

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>

// ========== 配置 (烧录前修改) ==========
#define ROLE  SENDER        // SENDER 或 RECEIVER

// 接收方 MAC 地址 (SENDER 需要填写; RECEIVER 会打印自己的 MAC)
uint8_t RECEIVER_MAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
// =======================================

typedef struct {
    uint32_t counter;
    char     msg[32];
    float    value;
} test_msg_t;

test_msg_t g_tx;

// ---- SENDER 回调 ----
void on_sent(const uint8_t *mac, esp_now_send_status_t status) {
    Serial.printf("[TX] 发送%s (状态=%d)\n",
                  status == ESP_NOW_SEND_SUCCESS ? "成功" : "失败", status);
}

// ---- RECEIVER 回调 ----
void on_recv(const uint8_t *mac, const uint8_t *data, int len) {
    if (len != sizeof(test_msg_t)) {
        Serial.printf("[RX] 数据长度异常: %d\n", len);
        return;
    }
    test_msg_t *m = (test_msg_t*)data;
    Serial.printf("[RX] 来自 %02X:%02X:%02X:%02X:%02X:%02X\n",
                  mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    Serial.printf("[RX] counter=%u  msg=\"%s\"  value=%.2f\n\n",
                  m->counter, m->msg, m->value);
}

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== ESP-NOW 通信测试 ===\n");
    Serial.printf("[INFO] 角色: %s\n", ROLE == SENDER ? "SENDER (发送方)" : "RECEIVER (接收方)");

    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    Serial.printf("[INFO] 本机 MAC: %s\n", WiFi.macAddress().c_str());

    if (esp_now_init() != ESP_OK) {
        Serial.println("[FATAL] ESP-NOW 初始化失败!");
        while (1) delay(1000);
    }

#if ROLE == SENDER
    esp_now_register_send_cb(on_sent);

    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, RECEIVER_MAC, 6);
    peer.channel = 0;
    peer.encrypt = false;

    if (esp_now_add_peer(&peer) != ESP_OK) {
        Serial.println("[FATAL] 添加 peer 失败! 请检查 RECEIVER_MAC");
        while (1) delay(1000);
    }
    Serial.println("[INFO] SENDER 就绪，开始发送...\n");

#else  // RECEIVER
    esp_now_register_recv_cb(on_recv);
    Serial.println("[INFO] RECEIVER 就绪，等待数据...\n");
#endif
}

void loop() {
#if ROLE == SENDER
    g_tx.counter++;
    snprintf(g_tx.msg, sizeof(g_tx.msg), "Hello #%u", g_tx.counter);
    g_tx.value = g_tx.counter * 1.5f;

    Serial.printf("[TX] counter=%u  value=%.2f\n", g_tx.counter, g_tx.value);
    esp_err_t err = esp_now_send(RECEIVER_MAC, (uint8_t*)&g_tx, sizeof(g_tx));
    if (err != ESP_OK) {
        Serial.printf("[TX] 发送失败: %d\n", err);
    }
    delay(1000);
#else
    delay(100);  // RECEIVER: 仅等待回调
#endif
}
