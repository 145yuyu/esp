/**
 * 模块测试 07 — WiFi AP+STA + HTTP Server 测试
 *
 * 测试流程:
 *   1. 启动 AP 热点 (ParkMonitor / 12345678)
 *   2. 尝试连接路由器 STA (修改下方 SSID/PASS)
 *   3. 启动 HTTP Server (端口 80)
 *   4. 用手机/电脑连接 AP 热点，浏览器访问:
 *      http://192.168.4.1/api/sensors   → JSON 传感器模拟数据
 *      http://192.168.4.1/api/status    → JSON 状态
 *      http://192.168.4.1/api/health    → "OK"
 *
 * 注意: 烧录前请修改 STA_SSID / STA_PASSWORD 为实际 WiFi
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>

WebServer server(80);

const char* AP_SSID     = "ParkMonitor";
const char* AP_PASSWORD = "12345678";

// !! 修改为你的实际 WiFi !!
const char* STA_SSID     = "YourWiFi";
const char* STA_PASSWORD = "YourPassword";

unsigned long sys_start = 0;

void addCors() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
}

void handleSensors() {
    addCors();
    char json[512];
    snprintf(json, sizeof(json),
        "{\"nodes\":["
        "{\"node_id\":0,\"zone_name\":\"中心节点\","
        "\"temperature\":%.1f,\"humidity\":%.1f,"
        "\"dust_level\":%d,\"aqi\":%d,\"battery\":%d,"
        "\"online\":true,\"timestamp\":%lu}"
        "],\"timestamp\":%lu,\"uptime\":%lu}",
        25.5f, 55.0f, 42, 60, 100, millis(),
        millis(), (millis() - sys_start) / 1000);
    server.send(200, "application/json", json);
}

void handleStatus() {
    addCors();
    server.send(200, "application/json",
        "{\"local\":{\"online\":true,\"battery\":100}}");
}

void handleHealth() {
    server.send(200, "text/plain", "OK");
}

void handleRoot() {
    String html = "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        "<title>Park Monitor Test</title></head>"
        "<body style='font-family:sans-serif;padding:20px;background:#1a1a2e;color:#eee'>"
        "<h1>🌳 城市公园环境监测系统</h1>"
        "<h2>ESP32-S3 中心节点 — WiFi 测试页</h2>"
        "<ul>"
        "<li><a href='/api/sensors' style='color:#0ff'>/api/sensors</a> — 传感器数据</li>"
        "<li><a href='/api/status' style='color:#0ff'>/api/status</a> — 节点状态</li>"
        "<li><a href='/api/health' style='color:#0ff'>/api/health</a> — 健康检查</li>"
        "</ul>"
        "<p>AP IP: " + WiFi.softAPIP().toString() + "</p>";
    if (WiFi.status() == WL_CONNECTED) {
        html += "<p>STA IP: " + WiFi.localIP().toString() + " ✅</p>";
    } else {
        html += "<p>STA: 未连接 ⚠️</p>";
    }
    html += "<p>运行时间: " + String((millis() - sys_start) / 1000) + "s</p>";
    html += "</body></html>";
    server.send(200, "text/html", html);
}

void setup() {
    Serial.begin(115200);
    delay(500);
    sys_start = millis();
    Serial.println("\n=== WiFi AP+STA + HTTP Server 测试 ===\n");

    // AP + STA 双模式
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.printf("[AP]  热点: %s  密码: %s\n", AP_SSID, AP_PASSWORD);
    Serial.printf("[AP]  IP: %s\n", WiFi.softAPIP().toString().c_str());
    Serial.println("[AP]  用手机连此热点，浏览器访问 http://192.168.4.1");

    WiFi.begin(STA_SSID, STA_PASSWORD);
    Serial.printf("[STA] 正在连接: %s ...\n", STA_SSID);

    int wait = 0;
    while (WiFi.status() != WL_CONNECTED && wait < 30) {
        delay(500); Serial.print("."); wait++;
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[STA] 已连接! IP: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\n[STA] 连接超时 (AP 仍可用)");
    }

    // HTTP Server
    server.on("/",            handleRoot);
    server.on("/api/sensors", handleSensors);
    server.on("/api/status",  handleStatus);
    server.on("/api/health",  handleHealth);
    server.begin();
    Serial.println("[HTTP] Server 已启动 (端口 80)");
    Serial.println("[INFO] 测试就绪!\n");
}

void loop() {
    server.handleClient();
    delay(10);

    // 每 30 秒打印连接状态
    static unsigned long last = 0;
    if (millis() - last > 30000) {
        Serial.printf("[WiFi] AP: %s | STA: %s\n",
            WiFi.softAPIP().toString().c_str(),
            WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "未连接");
        last = millis();
    }
}
