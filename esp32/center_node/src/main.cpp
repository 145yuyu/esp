/**
 * 城市公园环境监测系统 — ESP32-S3 中心节点
 *
 * 硬件:
 *  - MCU:       ESP32-S3 (双核 Xtensa LX7, 240MHz, WiFi/BLE)
 *  - 屏幕:      1.44寸 TFT ST7735 128×128 SPI (12pin, 4按键)
 *  - 温湿度:    DHT22 (DATA → GPIO16)
 *  - 粉尘:      GP2Y1014AU (Vo→GPIO1 ADC, LED→GPIO7)
 *  - 预警LED:   普通发光二极管 ×4 (绿→GPIO2, 黄→GPIO3, 橙→GPIO38, 红→GPIO39)
 *  - 蜂鸣器:    有源12095蜂鸣器 5V (信号→GPIO6, 经NPN三极管驱动)
 *  - 按键:      K1上键→GPIO9, K2下键→GPIO10
 *
 * 功能:
 *  - 本地传感器采集 (DHT22 + GP2Y1014AU)
 *  - 滑动窗口均值滤波 + 边缘计算 (体感温度/露点/AQI/质量评分)
 *  - 1.44寸 TFT LCD 实时显示环境数据, 按键翻页
 *  - LED 多级预警 (4位GPIO直驱: 绿→黄→橙→红, 级联点亮)
 *  - 有源蜂鸣器 分级预警（临界持续响, 危险间歇, 警告短促）
 *  - ESP-NOW 接收子节点数据 (可选, 最多4个)
 *  - HTTP Server (/api/sensors, /api/status) 供本地调试
 *  - WiFi AP+STA 双模式 (AP本地调试 + STA连路由器上网)
 *  - HTTP POST 定时上报数据到后端服务器 (支持 ngrok 远程穿透)
 *
 * 硬件接线:
 *  ============================================================
 *  TFT LCD (ST7735 128×128 SPI, 12pin):
 *    Pin1  GND  → GND
 *    Pin2  VCC  → 3.3V
 *    Pin3  SCL  → GPIO18 (SPI SCK)
 *    Pin4  SDA  → GPIO17 (SPI MOSI)
 *    Pin5  RES  → GPIO21 (屏幕复位)
 *    Pin6  DC   → GPIO4  (数据/命令)
 *    Pin7  CS   → GPIO5  (片选)
 *    Pin8  BL   → 3.3V   (背光常亮)
 *    Pin9  K1   → GPIO9  (上键, 上一页)
 *    Pin10 K2   → GPIO10 (下键, 下一页)
 *    Pin11 K3   → 预留
 *    Pin12 K4   → 预留
 *
 *  DHT22:
 *    VCC → 3.3V
 *    DATA → GPIO16 (需10KΩ上拉到3.3V)
 *    GND → GND
 *
 *  GP2Y1014AU 粉尘传感器:
 *    Vcc     → 5V (VIN)
 *    GND     → GNDGP
 *    LED     → GPIO7 (经NPN三极管驱动, 脉冲控制)
 *    Vo      → GPIO1 (ADC1_CH0, 经1:2分压: 10K+10K)
 *    (Vo max≈3.6V@5V, 分压后 max≈1.8V, 安全入ESP32 ADC)
 *
 *  预警 LED (普通发光二极管 ×4, 各串 220Ω 限流电阻):
 *    绿 LED (NORMAL)  → GPIO2  (经220Ω→GND)
 *    黄 LED (WARNING) → GPIO3  (经220Ω→GND)
 *    橙 LED (DANGER)  → GPIO38 (经220Ω→GND)
 *    红 LED (CRITICAL)→ GPIO39 (经220Ω→GND)
 *
 *  有源蜂鸣器 12095 (5V):
 *    VCC  → 5V (VIN)
 *    GND  → GND
 *    I/O  → GPIO6 (经S8050 NPN三极管: B极串1KΩ→GPIO6,
 *                   C极→蜂鸣器-, E极→GND, 蜂鸣器+→5V)
 *  ============================================================
 */

// ==================== TFT SPI 引脚定义 ====================
// 必须在 #include <TFT_eSPI.h> 之前定义, 与 User_Setup.h 保持一致
// ESP32-S3 ↔ ST7735 1.44寸 128×128 SPI 接线:
#define TFT_CS    5     // 片选   (Pin7 → GPIO5)
#define TFT_DC    4     // 数据/命令 (Pin6 → GPIO4)
#define TFT_RST   21    // 复位   (Pin5 → GPIO21)
#define TFT_MOSI  17    // SPI MOSI (Pin4 SDA → GPIO17)
#define TFT_SCLK  18    // SPI SCK  (Pin3 SCL → GPIO18)
#define TFT_MISO  19    // SPI MISO (未使用, 占位)
// SPI 时钟由 User_Setup.h 的 SPI_FREQUENCY 统一管理 (10MHz)
// 不使用底层寄存器补丁, 避免干扰 tft.init() 内部的 SPI 初始化流程

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>   // ngrok HTTPS 上报所需
#include <esp_now.h>
#include <TFT_eSPI.h>
#include <DHT.h>
#include <math.h>
#include "soc/soc.h"            // WRITE_PERI_REG 宏
#include "soc/rtc_cntl_reg.h"   // RTC_CNTL_BROWN_OUT_REG (正确地址由宏解析)

#include "protocol.h"

// 安全获取区域名称 (防止越界访问)
static inline const char* safe_zone_name(uint8_t zone_id) {
    static const int n = sizeof(ZONE_NAMES) / sizeof(ZONE_NAMES[0]);
    return ZONE_NAMES[(zone_id < n) ? zone_id : 0];
}

// ==================== 编译前配置 ====================
#undef  MAX_NODES            // 覆盖 protocol.h 中的默认值 (4)
#define MAX_NODES      0     // ← 实际子节点数量 (1或2, 不含本地)

// 子节点 MAC 地址（烧录前填入各子节点实际 MAC）
#if MAX_NODES > 0
uint8_t node_mac[MAX_NODES][6] = {};
#else
uint8_t (*node_mac)[6] = nullptr;  // 无子节点时占位, 防止编译报错
#endif

// ==================== 引脚定义 (ESP32-S3) ====================
// DHT22
#define DHT_PIN         16
#define DHT_TYPE        DHT22

// GP2Y1014AU 粉尘传感器
#define DUST_LED_PIN    7       // IR LED 驱动 (经 NPN 三极管)
#define DUST_ADC_PIN    1       // ADC1_CH0 → Vo 输出电压 (经分压, ESP32-S3 兼容)

// 预警 LED (普通发光二极管, GPIO 直驱, 各串 220Ω 限流电阻)
#define LED_GREEN_PIN   2       // 绿色 LED — NORMAL
#define LED_YELLOW_PIN  3       // 黄色 LED — WARNING
#define LED_ORANGE_PIN  38      // 橙色 LED — DANGER
#define LED_RED_PIN     39      // 红色 LED — CRITICAL

// 有源蜂鸣器 (5V, 经NPN驱动)
#define BUZZER_PIN      6

// 按键 (接GND, INPUT_PULLUP)
#define KEY_UP_PIN      9
#define KEY_DOWN_PIN    10
#define KEY_DEBOUNCE_MS 200

// ==================== 系统常量 ====================
#define POLL_INTERVAL   5000      // ESP-NOW 轮询间隔 ms
#define HEARTBEAT_TO    15000     // 心跳超时 ms
#define HEARTBEAT_RETRY 3         // 连续超时次数→判定离线
#define DISPLAY_REFRESH 3000      // 屏幕刷新间隔 ms (降至3秒, 减少SPI总线占用)
#define ALERT_REFRESH   1500      // 预警检查间隔 ms
#define SENSOR_SAMPLE   2000      // 传感器采样间隔 ms
#define UPLOAD_INTERVAL 30000     // 数据上报间隔 ms (30s, 减少 WiFi TX 频率以缓解电源压力)

// WiFi AP 配置 (本地调试热点)
const char* AP_SSID     = "ParkMonitor";
const char* AP_PASSWORD = "12345678";

// WiFi STA 配置 (连接路由器上网，用于上报数据到后端)
// !! 烧录前请修改为实际 WiFi 名称和密码 !!
const char* STA_SSID     = "vivo13";
const char* STA_PASSWORD = "12345678";

// 后端服务器地址 (ngrok 穿透后的公网地址或局域网地址)
// !! 烧录前请修改为实际后端地址 !!
// 示例: "http://192.168.1.100:3000" (局域网)
//       "https://xxxx.ngrok-free.app" (ngrok 穿透)
const char* BACKEND_URL  = "https://democrat-related-cozily.ngrok-free.dev";

// ==================== 全局对象 ====================
TFT_eSPI       tft = TFT_eSPI();
WebServer      server(80);
DHT            dht(DHT_PIN, DHT_TYPE);
SemaphoreHandle_t g_data_mutex;

// ---- 本地传感器状态 ----
sensor_data_t  g_local_data;              // 本地 DHT22 + GP2Y 采集数据
unsigned long  g_last_sensor_ms = 0;
bool           g_dht_ok = false;

// ---- 子节点状态 (ESP-NOW) ----
sensor_data_t  node_data[MAX_NODES] = {};
bool           node_online[MAX_NODES] = {};
int            node_timeout[MAX_NODES] = {};
unsigned long  node_last_resp[MAX_NODES] = {};
int            curr_poll_idx = 0;
unsigned long  last_poll_ms = 0;

// ---- 显示 & 预警 ----
int            display_node_idx = 0;   // 当前显示页面: 0=本地, 1~MAX_NODES=子节点
unsigned long  last_key_ms = 0;
AlertLevel     last_alert_lv = NORMAL;
unsigned long  sys_start_ms = 0;
unsigned long  last_display_ms = 0;
unsigned long  last_alert_ms = 0;

// ---- 数据上报 ----
unsigned long  last_upload_ms = 0;

// ---- WiFi STA 重连 ----
unsigned long  last_wifi_check_ms = 0;

// ---- 滑动窗口滤波器 ----
template<typename T, int N>
class MovingAvg {
    T buf[N];
    int idx = 0;
    int cnt = 0;
public:
    void clear() { idx = 0; cnt = 0; }
    T update(T val) {
        if (N <= 0) return val;
        buf[idx] = val;
        idx = (idx + 1) % N;
        if (cnt < N) cnt++;
        T sum = 0;
        for (int i = 0; i < cnt; i++) sum += buf[i];
        return sum / (T)cnt;
    }
    bool ready() const { return cnt >= N; }
};

MovingAvg<float, 5>   filter_temp;
MovingAvg<float, 5>   filter_hum;
MovingAvg<float, 5>   filter_dust;
float g_prev_temp = -99.0f, g_prev_hum = -99.0f;
uint16_t g_prev_dust = 0;
uint16_t g_dust_adc_raw = 0;   // 调试: 最近一次粉尘 ADC 原始值 (0~4095)

// ==================== GP2Y1014AU 粉尘传感器读取 ====================
/**
 * 读取 GP2Y1014AU 粉尘浓度。
 *
 * 时序要求 (数据手册):
 *   - ILED ON (拉高) 等待 0.28ms
 *   - 在 ILED ON 期间的后段采样 ADC
 *   - ILED OFF (拉低) 等待 9.68ms
 *   - 整个周期 ≈ 10ms
 *
 * 返回: 粉尘浓度 ug/m³
 */
uint16_t read_dust() {
    // 1. 开启 IR LED
    digitalWrite(DUST_LED_PIN, HIGH);
    delayMicroseconds(280);   // 等待 0.28ms 让 LED 稳定

    // 2. 采样 ADC (多次采样取均值消除噪声)
    uint32_t sum = 0;
    const int samples = 16;
    for (int i = 0; i < samples; i++) {
        sum += analogRead(DUST_ADC_PIN);
        delayMicroseconds(40);
    }
    uint16_t adc_avg = sum / samples;
    g_dust_adc_raw = adc_avg;   // 保存供调试打印

    // 3. 关闭 IR LED
    digitalWrite(DUST_LED_PIN, LOW);
    delayMicroseconds(9680);  // 等待 9.68ms 完成周期

    // 4. ADC → 电压 (ESP32-S3 ADC 12-bit, 衰减11dB, 量程0~3.3V)
    //    GP2Y 输出经 1:2 分压 (10K+10K), 实际电压 = adc_voltage * 2
    float adc_voltage = adc_avg * (3.3f / 4095.0f);
    float vo = adc_voltage * 2.0f;   // 反推分压前的原始 Vout

    // 5. 电压 → 粉尘浓度 (使用 protocol.h 中的换算函数)
    return gp2y_calc_dust(vo, 5.0f);
}

// ==================== 本地传感器采集流水线 ====================
/**
 * 采集 DHT22 + GP2Y1014AU, 经滤波 → 边缘计算 → 更新 g_local_data
 */
void sample_local_sensors() {
    // Step 1: 读取原始数据
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    g_dht_ok = !(isnan(t) || isnan(h));

    uint16_t dust_raw = read_dust();

    // Step 2: 容错 (DHT22 偶尔读取失败)
    if (!g_dht_ok) {
        t = g_prev_temp;
        h = g_prev_hum;
    }

    // Step 3: 滑动窗口均值滤波
    float ft = filter_temp.update(t);
    float fh = filter_hum.update(h);
    uint16_t fdust = (uint16_t)filter_dust.update((float)dust_raw);

    // Step 4: 边缘计算
    float hi = 0.0f, dp = 0.0f;
    uint16_t aqi_val = 0;

    // 体感温度
    if (ft >= 27.0f && fh >= 40.0f) {
        float t_f = ft * 1.8f + 32.0f;
        hi = -42.379f + 2.04901523f * t_f + 10.14333127f * fh
             - 0.22475541f * t_f * fh - 0.00683783f * t_f * t_f
             - 0.05481717f * fh * fh + 0.00122874f * t_f * t_f * fh
             + 0.00085282f * t_f * fh * fh - 0.00000199f * t_f * t_f * fh * fh;
        if (hi < ft) hi = ft;
    } else {
        hi = ft;
    }

    // 露点温度 (Magnus 公式)
    if (fh > 0) {
        const float a = 17.27f, b = 237.7f;
        float gamma = log(fh / 100.0f) + (a * ft) / (b + ft);
        dp = (b * gamma) / (a - gamma);
    }

    // AQI (基于粉尘浓度的简化计算)
    if (fdust <= 35)       aqi_val = (uint16_t)((uint32_t)fdust * 50 / 35);
    else if (fdust <= 75)  aqi_val = 50  + (uint16_t)((uint32_t)(fdust - 35) * 50 / 40);
    else if (fdust <= 115) aqi_val = 100 + (uint16_t)((uint32_t)(fdust - 75) * 50 / 40);
    else if (fdust <= 150) aqi_val = 150 + (uint16_t)((uint32_t)(fdust - 115) * 50 / 35);
    else if (fdust <= 250) aqi_val = 200 + (uint16_t)((uint32_t)(fdust - 150) * 100 / 100);
    else                   aqi_val = 300 + (uint16_t)((uint32_t)(fdust - 250) * 200 / 250);

    // 数据质量评估
    uint8_t quality = 100;
    if (!g_dht_ok) quality = 0;
    else {
        if (ft < -20.0f || ft > 60.0f)   quality -= 30;
        if (fh < 0.0f || fh > 100.0f)    quality -= 30;
        if (fdust > 1000)                 quality -= 20;
        if (quality > 100) quality = 100;
    }

    // 异常检测
    uint8_t anomaly = ANOMALY_NONE;
    if (!g_dht_ok) anomaly |= ANOMALY_SENSOR_ERR;
    if (ft > 38.0f)  anomaly |= ANOMALY_TEMP_HIGH;
    if (ft < -15.0f) anomaly |= ANOMALY_TEMP_LOW;
    if (fh > 95.0f)  anomaly |= ANOMALY_HUM_HIGH;
    if (fdust > 250) anomaly |= ANOMALY_DUST_HIGH;
    if (g_prev_temp > -99.0f && fabs(ft - g_prev_temp) > 10.0f) anomaly |= ANOMALY_SUDDEN_CHG;

    // 更新历史值
    if (g_dht_ok && filter_temp.ready()) {
        g_prev_temp = ft;
        g_prev_hum  = fh;
        g_prev_dust = fdust;
    }

    // Step 5: 更新全局数据 (互斥锁保护)
    if (xSemaphoreTake(g_data_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        g_local_data.node_id       = 0;   // 0 = 本地中心节点
        g_local_data.zone_id       = 0;   // 中心节点不分区
        g_local_data.temperature   = ft;
        g_local_data.humidity      = fh;
        g_local_data.dust_level    = fdust;
        g_local_data.dust_peak     = (uint16_t)(fdust * 1.3f);  // 峰值估算
        g_local_data.heat_index    = hi;
        g_local_data.dew_point     = dp;
        g_local_data.aqi           = aqi_val;
        g_local_data.anomaly_flags = anomaly;
        g_local_data.data_quality  = quality;
        g_local_data.timestamp     = millis();
        g_local_data.battery       = 100;  // 中心节点常供电
        xSemaphoreGive(g_data_mutex);
    }

    Serial.printf("[SENSOR] T=%.1f°C H=%.1f%% 粉尘=%d ug/m³ (ADC=%d) "
                  "HI=%.1f AQI=%d Q=%d FLG=0x%02X\n",
                  ft, fh, fdust, g_dust_adc_raw, hi, aqi_val, quality, anomaly);
}

// ==================== 数据上报到后端服务器 ====================
/**
 * 将本地 + 子节点数据通过 HTTP POST 上报到后端 /api/sensors/ingest
 *
 * 上报格式 (JSON):
 * {
 *   "nodes": [
 *     { "node_id": 0, "zone_id": 0, "zone_name": "中心节点",
 *       "temperature": 30.5, "humidity": 55.0, "dust_level": 42,
 *       "dust_peak": 58, "battery": 100, "timestamp": 1700000000000 },
 *     ...
 *   ]
 * }
 */
void upload_to_backend() {
    // 检查 WiFi STA 是否已连接
    if (WiFi.status() != WL_CONNECTED) {
        return;  // STA 未连接，跳过上报 (不打印日志避免刷屏)
    }

    sensor_data_t local_copy;
    sensor_data_t remote[MAX_NODES];
    bool online[MAX_NODES];

    if (xSemaphoreTake(g_data_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        local_copy = g_local_data;
        memcpy(remote, node_data, sizeof(remote));
        memcpy(online, node_online, sizeof(online));
        xSemaphoreGive(g_data_mutex);
    } else {
        return;
    }

    // 构建 JSON (使用 String 拼接，避免大栈分配)
    String json = "{\"nodes\":[";

    // 本地节点
    char buf[512];
    snprintf(buf, sizeof(buf),
        "{\"node_id\":0,\"zone_id\":0,\"zone_name\":\"中心节点\","
        "\"temperature\":%.1f,\"humidity\":%.1f,"
        "\"dust_level\":%d,\"dust_peak\":%d,"
        "\"battery\":%d,\"timestamp\":%lu}",
        local_copy.temperature, local_copy.humidity,
        local_copy.dust_level, local_copy.dust_peak,
        local_copy.battery, millis());
    json += buf;

    // 在线子节点
    for (int i = 0; i < MAX_NODES; i++) {
        if (!online[i]) continue;
        snprintf(buf, sizeof(buf),
            ",{\"node_id\":%d,\"zone_id\":%d,\"zone_name\":\"%s\","
            "\"temperature\":%.1f,\"humidity\":%.1f,"
            "\"dust_level\":%d,\"dust_peak\":%d,"
            "\"battery\":%d,\"timestamp\":%lu}",
            i + 1,
            remote[i].zone_id > 0 ? remote[i].zone_id : i + 1,
            safe_zone_name(remote[i].zone_id > 0 ? remote[i].zone_id : i + 1),
            remote[i].temperature, remote[i].humidity,
            remote[i].dust_level, remote[i].dust_peak,
            remote[i].battery, millis());
        json += buf;
    }

    json += "]}";

    // HTTP POST (自动适配 http/https, 支持 ngrok 穿透)
    HTTPClient http;
    http.setTimeout(8000);  // ngrok 穿透延迟较大, 超时放宽到8秒
    String url = String(BACKEND_URL) + "/api/sensors/ingest";

    // 根据地址协议选择普通/加密连接
    WiFiClientSecure secure_client;
    bool ok;
    if (url.startsWith("https")) {
        secure_client.setInsecure();          // 跳过证书验证 (ngrok 证书链)
        secure_client.setHandshakeTimeout(15); // TLS 握手超时 15s, 防止长时间阻塞
        ok = http.begin(secure_client, url);
    } else {
        ok = http.begin(url);
    }

    if (ok) {
        http.addHeader("Content-Type", "application/json");
        http.addHeader("ngrok-skip-browser-warning", "true");  // 跳过 ngrok 免费版警告页
        int code = http.POST(json);

        if (code > 0) {
            Serial.printf("[UPLOAD] HTTP %d → %s (%d 字节)\n",
                          code, url.c_str(), json.length());
        } else {
            Serial.printf("[UPLOAD] 失败: %s\n", http.errorToString(code).c_str());
        }
        http.end();
    } else {
        Serial.printf("[UPLOAD] 无法连接到 %s\n", url.c_str());
    }
}

// ==================== ESP-NOW 接收回调 (子节点数据) ====================
void on_data_recv(const uint8_t *mac, const uint8_t *data, int len) {
    if (len != sizeof(sensor_data_t)) {
        Serial.printf("[RX] 数据包长度异常: %d (期望 %d)\n", len, sizeof(sensor_data_t));
        return;
    }

    uint16_t computed = calc_crc16(data, sizeof(sensor_data_t) - sizeof(uint16_t));
    const sensor_data_t *d = (const sensor_data_t*)data;
    if (computed != d->crc) {
        Serial.printf("[RX] CRC 校验失败! computed=0x%04X received=0x%04X\n",
                      computed, d->crc);
        return;
    }

    int idx = d->node_id - 1;
    if (idx < 0 || idx >= MAX_NODES) {
        Serial.printf("[RX] 非法节点ID: %d\n", d->node_id);
        return;
    }

    if (xSemaphoreTake(g_data_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        memcpy(&node_data[idx], d, sizeof(sensor_data_t));
        node_online[idx]    = true;
        node_timeout[idx]   = 0;
        node_last_resp[idx] = millis();
        xSemaphoreGive(g_data_mutex);

        Serial.printf("[RX] 子节点%d: T=%.1f H=%.1f 粉尘=%d ug/m³ "
                      "AQI=%d 电池=%d%%\n",
                      d->node_id, d->temperature, d->humidity,
                      d->dust_level, d->aqi, d->battery);
    }
}

// ==================== 预警控制 ====================
/**
 * 设置 LED 预警灯 (级联点亮模式)
 *
 * 4 个 GPIO 直驱的普通发光二极管, 各串 220Ω 限流电阻:
 *   NORMAL:   仅绿灯亮           (空气质量优良)
 *   WARNING:  绿+黄亮             (轻度污染)
 *   DANGER:   绿+黄+橙亮          (中度污染)
 *   CRITICAL: 绿+黄+橙+红全亮     (严重污染)
 */
void set_led_color(AlertLevel lv) {
    // 先全部关闭
    digitalWrite(LED_GREEN_PIN,  LOW);
    digitalWrite(LED_YELLOW_PIN, LOW);
    digitalWrite(LED_ORANGE_PIN, LOW);
    digitalWrite(LED_RED_PIN,    LOW);

    switch (lv) {
        case CRITICAL:
            digitalWrite(LED_RED_PIN,    HIGH);  // fall through
        case DANGER:
            digitalWrite(LED_ORANGE_PIN, HIGH);  // fall through
        case WARNING:
            digitalWrite(LED_YELLOW_PIN, HIGH);  // fall through
        case NORMAL:
        default:
            digitalWrite(LED_GREEN_PIN,  HIGH);
            break;
    }
}

/**
 * 有源蜂鸣器控制
 * 有源蜂鸣器只需 DC 通电即可发出固定频率声音，用 digitalWrite 控制。
 * 分级策略:
 *   CRITICAL → 持续响 (1.5s ON)
 *   DANGER   → 间歇响 (400ms ON, 600ms OFF)
 *   WARNING  → 短促响 (150ms ON, 850ms OFF)
 *   NORMAL   → 关闭
 */
void set_buzzer(AlertLevel lv) {
    static unsigned long buzzer_on_ms = 0;
    static bool buzzer_state = false;
    static AlertLevel current_lv = NORMAL;

    // 等级变化时重置状态
    if (lv != current_lv) {
        current_lv = lv;
        buzzer_state = false;
        buzzer_on_ms = 0;
        digitalWrite(BUZZER_PIN, LOW);
    }

    if (lv == NORMAL) {
        digitalWrite(BUZZER_PIN, LOW);
        return;
    }

    unsigned long now = millis();
    unsigned long on_time = 0, off_time = 0;

    switch (lv) {
        case CRITICAL: on_time = 1500; off_time = 500;   break;
        case DANGER:   on_time = 400;  off_time = 600;   break;
        case WARNING:  on_time = 150;  off_time = 850;   break;
        default: break;
    }

    if (!buzzer_state) {
        // 当前关闭: 检查是否到了开启时间
        if (now - buzzer_on_ms >= off_time) {
            digitalWrite(BUZZER_PIN, HIGH);
            buzzer_state = true;
            buzzer_on_ms = now;
        }
    } else {
        // 当前开启: 检查是否到了关闭时间
        if (now - buzzer_on_ms >= on_time) {
            digitalWrite(BUZZER_PIN, LOW);
            buzzer_state = false;
            buzzer_on_ms = now;
        }
    }
}

/**
 * 综合预警判定 (基于本地 + 子节点数据)
 */
void check_all_alerts() {
    sensor_data_t local_copy;
    sensor_data_t remote[MAX_NODES];
    bool online[MAX_NODES];

    if (xSemaphoreTake(g_data_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        local_copy = g_local_data;
        memcpy(remote, node_data, sizeof(remote));
        memcpy(online, node_online, sizeof(online));
        xSemaphoreGive(g_data_mutex);
    } else {
        return;
    }

    AlertLevel worst = gp2y_dust_level(local_copy.dust_level);

    // 温度 / 湿度检查
    if (local_copy.temperature > 38.0f || local_copy.humidity > 95.0f) {
        if (worst < WARNING) worst = WARNING;
    }

    // 异常标志
    if (local_copy.anomaly_flags & ANOMALY_SENSOR_ERR) {
        if (worst < DANGER) worst = DANGER;
    }
    if (local_copy.anomaly_flags & ANOMALY_DUST_HIGH) {
        if (worst < DANGER) worst = DANGER;
    }

    // 子节点检查
    for (int i = 0; i < MAX_NODES; i++) {
        if (!online[i]) continue;
        AlertLevel rlv = gp2y_dust_level(remote[i].dust_level);
        if (remote[i].temperature > 38.0f || remote[i].humidity > 95.0f) {
            if (rlv < WARNING) rlv = WARNING;
        }
        if (rlv > worst) worst = rlv;
    }

    // 去抖: 同一等级不重复触发
    if (worst != last_alert_lv) {
        last_alert_lv = worst;
        set_led_color(worst);
        Serial.printf("[ALERT] 预警等级变化: %d\n", worst);
    }

    // 蜂鸣器持续控制 (需每周期调用以保证时序)
    set_buzzer(worst);
}

// ==================== 按键处理 ====================
/**
 * 翻页键: 0=本地传感器, 1~MAX_NODES=子节点
 * 总页数 = 1 (本地) + MAX_NODES (子节点)
 */
void handle_keys() {
    unsigned long now = millis();
    if (now - last_key_ms < KEY_DEBOUNCE_MS) return;

    int total_pages = 1 + MAX_NODES;  // 本地 + 子节点数

    if (digitalRead(KEY_UP_PIN) == LOW) {
        display_node_idx--;
        if (display_node_idx < 0) display_node_idx = total_pages - 1;
        last_key_ms = now;
        Serial.printf("[KEY] 切换到页面 %d/%d\n", display_node_idx, total_pages);
    }

    if (digitalRead(KEY_DOWN_PIN) == LOW) {
        display_node_idx++;
        if (display_node_idx >= total_pages) display_node_idx = 0;
        last_key_ms = now;
        Serial.printf("[KEY] 切换到页面 %d/%d\n", display_node_idx, total_pages);
    }
}

// ==================== TFT 显示 (128×128 ST7735) ====================
void draw_display() {
    sensor_data_t local_copy;
    sensor_data_t remote[MAX_NODES];
    bool online[MAX_NODES];

    if (xSemaphoreTake(g_data_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
        return;  // 互斥锁忙, 跳过本次刷新
    }
    local_copy = g_local_data;
    memcpy(remote, node_data, sizeof(remote));
    memcpy(online, node_online, sizeof(online));
    xSemaphoreGive(g_data_mutex);

    tft.fillScreen(TFT_BLACK);

    // ---- 顶栏 (深青色, 20px高) ----
    tft.fillRect(0, 0, 128, 20, TFT_DARKCYAN);
    tft.setTextColor(TFT_WHITE, TFT_DARKCYAN);
    tft.setTextFont(1);

    char title[24];
    if (display_node_idx == 0) {
        snprintf(title, sizeof(title), "Local Sensor");
    } else {
        snprintf(title, sizeof(title), "Sub Node %d", display_node_idx);
    }
    tft.drawString(title, 2, 4, 1);

    // ---- 确定要显示的数据 ----
    sensor_data_t display = {};
    bool is_online = true;
    const char* zone_name = "本地";

    if (display_node_idx == 0) {
        // 本地传感器
        display = local_copy;
        is_online = true;
        zone_name = "中心节点";
    } else {
        int ri = display_node_idx - 1;
        if (ri < MAX_NODES) {
            display = remote[ri];
            is_online = online[ri];
            zone_name = safe_zone_name(display.zone_id > 0 ? display.zone_id : 1);
        }
    }

    // ---- 离线状态 ----
    if (!is_online) {
        tft.setTextColor(TFT_RED, TFT_BLACK);
        tft.setTextFont(2);
        tft.drawString("OFFLINE!", 25, 45, 2);
        tft.setTextFont(1);
        tft.drawString("No signal", 35, 70, 1);

        // 底栏
        tft.fillRect(0, 108, 128, 20, TFT_DARKGREY);
        tft.setTextColor(TFT_WHITE, TFT_DARKGREY);
        int total = 1 + MAX_NODES;
        char nav[24];
        snprintf(nav, sizeof(nav), "<  %d/%d  >", display_node_idx + 1, total);
        tft.drawString(nav, 35, 110, 1);
        return;
    }

    // ---- 在线状态 & 区域 ----
    tft.setTextColor(TFT_GREEN, TFT_BLACK);
    tft.setTextFont(1);
    tft.drawString("ONLINE", 85, 23, 1);

    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.drawString(zone_name, 2, 23, 1);

    // ---- 数据区 (大字) ----
    tft.setTextFont(2);  // 16px 字体

    // 温度 (第1行)
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.drawString("T:", 2, 38, 2);
    tft.setTextColor(TFT_CYAN, TFT_BLACK);
    char buf[16];
    snprintf(buf, sizeof(buf), "%.1fC", display.temperature);
    tft.drawString(buf, 22, 38, 2);

    // 湿度 (第2行)
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.drawString("H:", 2, 56, 2);
    tft.setTextColor(TFT_MAGENTA, TFT_BLACK);
    snprintf(buf, sizeof(buf), "%.1f%%", display.humidity);
    tft.drawString(buf, 22, 56, 2);

    // 粉尘浓度 (第3行)
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.drawString("PM:", 2, 74, 2);
    uint16_t dc = gp2y_dust_color(display.dust_level);
    tft.setTextColor(dc, TFT_BLACK);
    snprintf(buf, sizeof(buf), "%d", display.dust_level);
    tft.drawString(buf, 36, 74, 2);

    // AQI (第3行右侧)
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.drawString("AQI:", 70, 74, 2);
    tft.setTextColor(dc, TFT_BLACK);
    snprintf(buf, sizeof(buf), "%d", display.aqi);
    tft.drawString(buf, 100, 74, 2);

    // ---- 分割线 ----
    tft.drawLine(0, 94, 128, 94, TFT_DARKGREY);

    // ---- 底部附加信息 ----
    tft.setTextFont(1);
    tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);

    // 体感温度 + 电池 / STA IP
    snprintf(buf, sizeof(buf), "HI:%.1fC", display.heat_index);
    tft.drawString(buf, 2, 96, 1);

    if (display_node_idx == 0) {
        // 显示 STA IP 最后一段 (如果已连接)
        if (WiFi.status() == WL_CONNECTED) {
            snprintf(buf, sizeof(buf), "%s", WiFi.localIP().toString().c_str());
            // 截断过长的 IP，只显示关键部分
            if (strlen(buf) > 10) {
                tft.drawString(buf, 40, 96, 1);
            } else {
                tft.drawString(buf, 53, 96, 1);
            }
        } else {
            snprintf(buf, sizeof(buf), "V:3.3V");
            tft.drawString(buf, 88, 96, 1);
        }
    } else {
        snprintf(buf, sizeof(buf), "Bat:%d%%", display.battery);
        tft.drawString(buf, 88, 96, 1);
    }

    // ---- 底栏 (翻页指示) ----
    tft.fillRect(0, 108, 128, 20, TFT_DARKGREY);
    tft.setTextColor(TFT_WHITE, TFT_DARKGREY);
    int total = 1 + MAX_NODES;
    if (total > 1) {
        char nav[24];
        snprintf(nav, sizeof(nav), "<  %d/%d  >", display_node_idx + 1, total);
        tft.drawString(nav, 35, 110, 1);
    } else {
        tft.drawString("Park Monitor", 18, 110, 1);
    }
}

// ==================== ESP-NOW 心跳轮询 ====================
void poll_next_node() {
    if (MAX_NODES == 0) return;

    int prev = (curr_poll_idx - 1 + MAX_NODES) % MAX_NODES;
    unsigned long elapsed = millis() - node_last_resp[prev];

    if (elapsed > HEARTBEAT_TO) {
        node_timeout[prev]++;
        if (node_timeout[prev] >= HEARTBEAT_RETRY) {
            if (xSemaphoreTake(g_data_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
                node_online[prev] = false;
                xSemaphoreGive(g_data_mutex);
            }
            Serial.printf("[FAULT] 子节点%d 离线\n", prev + 1);
        }
    } else {
        node_timeout[prev] = 0;
    }

    // 轮询下一个节点
    poll_request_t req;
    req.command     = CMD_DATA_REQ;
    req.target_node = (uint8_t)(curr_poll_idx + 1);

    // 检查 MAC 地址是否已配置 (非全 FF)
    bool mac_valid = false;
    for (int i = 0; i < 6; i++) {
        if (node_mac[curr_poll_idx][i] != 0xFF) { mac_valid = true; break; }
    }
    if (mac_valid) {
        esp_err_t err = esp_now_send(node_mac[curr_poll_idx], (uint8_t*)&req, sizeof(req));
        if (err != ESP_OK) {
            static unsigned long last_err_ms = 0;
            if (millis() - last_err_ms > 10000) {  // 限流: 每10秒最多报一次
                Serial.printf("[TX] 轮询子节点%d 发送失败: %d\n", curr_poll_idx + 1, err);
                last_err_ms = millis();
            }
        }
    }

    curr_poll_idx = (curr_poll_idx + 1) % MAX_NODES;
}

// ==================== WiFi STA 连接状态管理 ====================
/**
 * 检查并维护 WiFi STA 连接
 * 断线自动重连 (非阻塞)
 */
void check_wifi_sta() {
    static bool was_connected = false;
    wl_status_t status = WiFi.status();

    if (status == WL_CONNECTED) {
        if (!was_connected) {
            Serial.printf("[WiFi] STA 已连接! SSID: %s, IP: %s\n",
                          STA_SSID, WiFi.localIP().toString().c_str());
            was_connected = true;
        }
        return;
    }

    // 断开状态
    if (was_connected) {
        Serial.println("[WiFi] STA 连接断开，尝试重连...");
        was_connected = false;
    }

    // 每2分钟主动触发一次重连 (ESP32 Arduino 框架的自动重连不一定可靠)
    // 重连间隔拉长以避免弱供电下反复 TX 尖峰导致复位
    static unsigned long last_reconnect_log = 0;
    unsigned long now = millis();
    if (now - last_reconnect_log > 120000) {
        Serial.printf("[WiFi] STA 未连接 (status=%d)，主动重连...\n", status);
        WiFi.reconnect();
        last_reconnect_log = now;
    }
}

// ==================== HTTP API ====================
void addCorsHeaders() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void handleSensors() {
    addCorsHeaders();

    sensor_data_t local_copy;
    sensor_data_t remote[MAX_NODES];
    bool online[MAX_NODES];

    if (xSemaphoreTake(g_data_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
        server.send(503, "application/json", "{\"error\":\"busy\"}");
        return;
    }
    local_copy = g_local_data;
    memcpy(remote, node_data, sizeof(remote));
    memcpy(online, node_online, sizeof(online));
    xSemaphoreGive(g_data_mutex);

    char json[3072];
    int pos = 0;
    pos += snprintf(json + pos, sizeof(json) - pos, "{\"nodes\":[");

    // 本地节点 (node_id=0)
    pos += snprintf(json + pos, sizeof(json) - pos,
        "{"
        "\"node_id\":0,"
        "\"zone_id\":0,"
        "\"zone_name\":\"中心节点\","
        "\"temperature\":%.1f,"
        "\"humidity\":%.1f,"
        "\"dust_level\":%d,"
        "\"dust_peak\":%d,"
        "\"heat_index\":%.1f,"
        "\"dew_point\":%.1f,"
        "\"aqi\":%d,"
        "\"anomaly_flags\":%d,"
        "\"data_quality\":%d,"
        "\"battery\":%d,"
        "\"online\":true,"
        "\"timestamp\":%lu"
        "}",
        local_copy.temperature, local_copy.humidity,
        local_copy.dust_level, local_copy.dust_peak,
        local_copy.heat_index, local_copy.dew_point, local_copy.aqi,
        local_copy.anomaly_flags, local_copy.data_quality,
        local_copy.battery, millis());

    // 子节点
    for (int i = 0; i < MAX_NODES; i++) {
        pos += snprintf(json + pos, sizeof(json) - pos, ",");
        pos += snprintf(json + pos, sizeof(json) - pos,
            "{"
            "\"node_id\":%d,"
            "\"zone_id\":%d,"
            "\"zone_name\":\"%s\","
            "\"temperature\":%.1f,"
            "\"humidity\":%.1f,"
            "\"dust_level\":%d,"
            "\"dust_peak\":%d,"
            "\"heat_index\":%.1f,"
            "\"dew_point\":%.1f,"
            "\"aqi\":%d,"
            "\"anomaly_flags\":%d,"
            "\"data_quality\":%d,"
            "\"battery\":%d,"
            "\"online\":%s,"
            "\"timestamp\":%lu"
            "}",
            i + 1, remote[i].zone_id > 0 ? remote[i].zone_id : i + 1,
            safe_zone_name(remote[i].zone_id > 0 ? remote[i].zone_id : i + 1),
            remote[i].temperature, remote[i].humidity,
            remote[i].dust_level, remote[i].dust_peak,
            remote[i].heat_index, remote[i].dew_point, remote[i].aqi,
            remote[i].anomaly_flags, remote[i].data_quality,
            remote[i].battery,
            online[i] ? "true" : "false",
            millis());
    }

    pos += snprintf(json + pos, sizeof(json) - pos,
                    "],\"timestamp\":%lu,\"uptime\":%lu}",
                    millis(), (millis() - sys_start_ms) / 1000);

    server.send(200, "application/json", json);
}

void handleStatus() {
    addCorsHeaders();

    bool online[MAX_NODES];
    uint8_t battery[MAX_NODES];

    if (xSemaphoreTake(g_data_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        for (int i = 0; i < MAX_NODES; i++) {
            online[i]  = node_online[i];
            battery[i] = node_data[i].battery;
        }
        xSemaphoreGive(g_data_mutex);
    } else {
        // 互斥锁忙, 返回保守值
        for (int i = 0; i < MAX_NODES; i++) {
            online[i]  = false;
            battery[i] = 0;
        }
    }

    char json[512];
    int pos = 0;
    pos += snprintf(json + pos, sizeof(json) - pos, "{\"local\":{\"online\":true,\"battery\":100}");
    for (int i = 0; i < MAX_NODES; i++) {
        pos += snprintf(json + pos, sizeof(json) - pos,
                        ",\"node%d\":{\"online\":%s,\"battery\":%d}",
                        i + 1,
                        online[i] ? "true" : "false",
                        battery[i]);
    }
    pos += snprintf(json + pos, sizeof(json) - pos, "}");
    server.send(200, "application/json", json);
}

// ==================== FreeRTOS 任务 ====================
void Task_Sensor(void *pv) {
    for (;;) {
        if (millis() - g_last_sensor_ms >= SENSOR_SAMPLE) {
            sample_local_sensors();
            g_last_sensor_ms = millis();
        }
        vTaskDelay(pdMS_TO_TICKS(200));
    }
}

void Task_Comm(void *pv) {
    for (;;) {
        unsigned long now = millis();

        // ESP-NOW 子节点轮询
        if (MAX_NODES > 0 && now - last_poll_ms >= POLL_INTERVAL) {
            poll_next_node();
            last_poll_ms = now;
        }

        // 数据上报到后端 (STA 模式下)
        if (now - last_upload_ms >= UPLOAD_INTERVAL) {
            upload_to_backend();
            last_upload_ms = now;
        }

        // WiFi STA 连接检查
        if (now - last_wifi_check_ms >= 10000) {  // 每10秒检查一次
            check_wifi_sta();
            last_wifi_check_ms = now;
        }

        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

void Task_Display(void *pv) {
    for (;;) {
        if (millis() - last_display_ms >= DISPLAY_REFRESH) {
            draw_display();
            last_display_ms = millis();
        }
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

void Task_Alert(void *pv) {
    for (;;) {
        if (millis() - last_alert_ms >= ALERT_REFRESH) {
            check_all_alerts();
            last_alert_ms = millis();
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

void Task_Keys(void *pv) {
    for (;;) {
        handle_keys();
        vTaskDelay(pdMS_TO_TICKS(80));
    }
}

// ==================== DHT22 预热 ====================
void dht_warmup() {
    Serial.print("[DHT] 预热中");
    for (int i = 0; i < 6; i++) {
        delay(2000);
        float t = dht.readTemperature();
        float h = dht.readHumidity();
        Serial.print(".");
        if (!isnan(t) && !isnan(h)) {
            filter_temp.update(t);
            filter_hum.update(h);
        }
    }
    Serial.println(" OK");
}

// ==================== setup ====================
void setup() {
    // ---- 禁用棕断检测 ----
    // ❗ 上版用硬编码地址 0x60008078 是错的, 误写了其它 RTC 寄存器
    //   导致 TG1WDT_SYS_RST 看门狗复位。改用官方宏, 自动解析为
    //   ESP32-S3 正确的 RTC_CNTL_BROWN_OUT_REG 地址。
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

    // ---- CPU 降频 240MHz → 80MHz ----
    // 降低基载电流约 60%, 减小电源压力, 对传感器/TFT/HTTP 任务性能无影响
    setCpuFrequencyMhz(80);

    Serial.begin(115200);
    delay(500);
    sys_start_ms = millis();
    Serial.println("\n╔══════════════════════════════════════════════╗");
    Serial.println(  "║  城市公园环境监测系统 — ESP32-S3 中心节点  ║");
    Serial.println(  "╚══════════════════════════════════════════════╝");

    // ---- 互斥锁 ----
    g_data_mutex = xSemaphoreCreateMutex();
    if (g_data_mutex == NULL) {
        Serial.println("[FATAL] 互斥锁创建失败!");
        while (1) delay(1000);
    }

    // ---- GPIO 初始化 ----
    pinMode(DUST_LED_PIN, OUTPUT);
    digitalWrite(DUST_LED_PIN, LOW);
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
    // 预警 LED (GPIO 直驱, 高电平点亮, 各串 220Ω 限流电阻)
    pinMode(LED_GREEN_PIN, OUTPUT);
    pinMode(LED_YELLOW_PIN, OUTPUT);
    pinMode(LED_ORANGE_PIN, OUTPUT);
    pinMode(LED_RED_PIN, OUTPUT);
    set_led_color(NORMAL);   // 初始状态: 绿灯
    pinMode(KEY_UP_PIN, INPUT_PULLUP);
    pinMode(KEY_DOWN_PIN, INPUT_PULLUP);

    // ADC 初始化 (ESP32-S3: 12-bit, 衰减11dB → 0~3.3V)
    analogReadResolution(12);
    analogSetAttenuation(ADC_11db);

    // ---- TFT ----
    delay(800);   // ST7735 上电延时: 等待屏幕内部电源稳定 (≥500ms)
    tft.init();
    tft.setRotation(0);   // 竖屏 128×128

    tft.fillScreen(TFT_BLACK);
    tft.setTextColor(TFT_WHITE);
    tft.setTextFont(2);
    tft.drawString("Starting...", 25, 55, 2);

    // ---- LED ----
    Serial.printf("[LED] 4路预警LED已就绪 (绿:GPIO%d 黄:GPIO%d 橙:GPIO%d 红:GPIO%d)\n",
                  LED_GREEN_PIN, LED_YELLOW_PIN, LED_ORANGE_PIN, LED_RED_PIN);

    // ---- DHT22 ----
    dht.begin();
    dht_warmup();
    Serial.println("[DHT] DHT22 已就绪");

    // ---- GP2Y1014AU 初始读数 (丢弃前几次不稳定值) ----
    for (int i = 0; i < 5; i++) {
        read_dust();
        delay(12);
    }
    Serial.println("[DUST] GP2Y1014AU 已就绪");

    // ---- WiFi AP+STA 双模式 ----
    // AP 模式: 本地调试热点 (始终可用)
    // STA 模式: 连接路由器上网，上报数据到后端
    WiFi.mode(WIFI_AP_STA);

    // 启用 WiFi 省电模式 (modem sleep): WiFi 在 beacon 间隔内进入浅睡眠, 降低平均功耗
    WiFi.setSleep(true);

    // 启动 AP 前稍等, 让电源稳定
    delay(100);
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.printf("[WiFi] AP 已启动: %s  IP: %s\n",
                  AP_SSID, WiFi.softAPIP().toString().c_str());

    // 降低 WiFi 发射功率到最低 (2dBm): 减小 TX 瞬时电流尖峰,
    // 缓解弱供电下电压跌落。必须在 AP/STA 启动后调用才生效
    WiFi.setTxPower(WIFI_POWER_2dBm);

    // 启动 STA (连接路由器)
    WiFi.begin(STA_SSID, STA_PASSWORD);
    Serial.printf("[WiFi] STA 正在连接: %s ...\n", STA_SSID);

    // 等待 STA 连接 (最多 5秒, 快速放弃, 避免长时间 TX 扫描导致电流尖峰)
    int wait_count = 0;
    while (WiFi.status() != WL_CONNECTED && wait_count < 10) {
        delay(500);
        Serial.print(".");
        wait_count++;
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[WiFi] STA 已连接! IP: %s\n",
                      WiFi.localIP().toString().c_str());
    } else {
        Serial.printf("\n[WiFi] STA 连接超时，将在后台继续尝试。"
                      "AP 仍可用: %s\n",
                      WiFi.softAPIP().toString().c_str());
    }

    // ---- ESP-NOW (如果有子节点) ----
    if (MAX_NODES > 0) {
        if (esp_now_init() != ESP_OK) {
            Serial.println("[ESP-NOW] 初始化失败!");
            tft.drawString("ESP-NOW FAIL!", 10, 80, 1);
        } else {
            esp_now_register_recv_cb(on_data_recv);

            for (int i = 0; i < MAX_NODES; i++) {
                esp_now_peer_info_t peer = {};
                memcpy(peer.peer_addr, node_mac[i], 6);
                peer.channel = 0;
                peer.encrypt = false;
                if (esp_now_add_peer(&peer) != ESP_OK) {
                    Serial.printf("[ESP-NOW] 添加子节点%d失败\n", i + 1);
                }
            }
            Serial.printf("[ESP-NOW] 已注册 %d 个子节点\n", MAX_NODES);
        }
    } else {
        Serial.println("[ESP-NOW] 无子节点配置，仅本地采集模式");
    }

    // ---- HTTP Server (本地调试用) ----
    server.on("/api/sensors", handleSensors);
    server.on("/api/status",  handleStatus);
    server.on("/api/health", []() {
        server.send(200, "text/plain", "OK");
    });
    server.begin();
    Serial.println("[HTTP] Server started on port 80");

    // ---- FreeRTOS 任务 ----
    // 注意: Task_Comm 负责 HTTPS 上报, TLS 握手需要 ≥8KB 栈, 故分配 12KB 防止爆栈
    xTaskCreatePinnedToCore(Task_Sensor,  "Sensor",  4096,  NULL, 3, NULL, 0);
    xTaskCreatePinnedToCore(Task_Comm,    "Comm",    12288, NULL, 2, NULL, 0);
    xTaskCreatePinnedToCore(Task_Display, "Display", 4096,  NULL, 1, NULL, 1);
    xTaskCreatePinnedToCore(Task_Alert,   "Alert",   4096,  NULL, 2, NULL, 1);
    xTaskCreatePinnedToCore(Task_Keys,    "Keys",    2048,  NULL, 1, NULL, 1);

    Serial.println("[SYS] 中心节点启动完成");
    Serial.println("[SYS] AP: 192.168.4.1 | HTTP: /api/sensors | ESP-NOW: OK");
    Serial.println("[SYS] STA: 连接路由器后上报数据到后端");
    Serial.printf( "[SYS] 后端地址: %s/api/sensors/ingest\n", BACKEND_URL);
    Serial.println("[SYS] 传感器: DHT22(GPIO16) + GP2Y1014AU(GPIO1/GPIO7)");
    Serial.println("[SYS] 显示: ST7735 128×128 | LED: GPIO直驱×4(绿黄橙红) | 蜂鸣器: 有源5V");
}

void loop() {
    server.handleClient();
    delay(10);
}
