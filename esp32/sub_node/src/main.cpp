/**
 * 城市公园环境监测系统 — ESP32 子节点 (GP2Y1014AU + DHT22 版)
 *
 * 功能:
 *  - DHT22 采集温湿度
 *  - GP2Y1014AU 粉尘传感器采集粉尘浓度
 *  - 滑动窗口均值滤波
 *  -  边缘计算引擎: 体感温度 / 露点温度 / AQI / 异常检测 / 数据质量
 *  - ESP-NOW 与中心节点通信（应答模式 + 心跳响应）
 *
 * 硬件接线:
 *  DHT22 DATA    → GPIO4  (需10KΩ上拉到3.3V)
 *  GP2Y1014AU Vo → GPIO34 (ADC1_CH6, 经1:2分压 10K+10K)
 *  GP2Y1014AU LED→ GPIO7 (经NPN三极管驱动IR LED)
 *  GP2Y1014AU Vcc→ 5V (VIN引脚)
 *  GP2Y1014AU GND→ GND
 *  电池检测        → GPIO35 (ADC1, 1:2分压)
 */

#include <WiFi.h>
#include <esp_now.h>
#include <DHT.h>
#include <math.h>
#include "protocol.h"

// ==================== 编译前配置 ====================
#define NODE_ID        1      //  烧录前修改为 1~4
#define ZONE_ID        1      //  1=入口广场 2=健身活动区 3=湖区周边 4=林荫步道

// 中心节点 MAC 地址（ 烧录前填入中心节点实际 MAC）
uint8_t CENTER_MAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// ==================== 引脚定义 ====================
#define DHT_PIN         4      // DHT22 DATA
#define DHT_TYPE        DHT22
#define DUST_LED_PIN    7      // GP2Y1014AU IR LED 驱动 (经NPN三极管)
#define DUST_ADC_PIN    34     // GP2Y1014AU Vo → ADC1_CH6 (经1:2分压, 避开UART)
#define BATTERY_PIN     35     // 电池电压检测 ADC1 (需外部 1:2 分压)

// ==================== 边缘计算阈值 ====================
#define EDGE_TEMP_HIGH      38.0f   // 温度过高阈值 °C
#define EDGE_TEMP_LOW      -15.0f   // 温度过低阈值 °C
#define EDGE_HUM_HIGH       95.0f   // 湿度过高阈值 %
#define EDGE_DUST_HIGH      250     // 粉尘浓度严重超标 ug/m³
#define EDGE_DELTA_TEMP     10.0f   // 相邻周期温度跳变阈值 °C
#define EDGE_DELTA_HUM      30.0f   // 相邻周期湿度跳变阈值 %
#define EDGE_DELTA_DUST     3.0f    // 相邻周期粉尘浓度倍增因子

// ==================== 传感器对象 ====================
DHT dht(DHT_PIN, DHT_TYPE);

// ==================== 滑动窗口均值滤波 ====================
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

// 滑动窗口最大值 (用于粉尘峰值跟踪)
template<typename T, int N>
class MovingMax {
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
        T maxv = buf[0];
        for (int i = 1; i < cnt; i++) {
            if (buf[i] > maxv) maxv = buf[i];
        }
        return maxv;
    }
    bool ready() const { return cnt >= N; }
};

// 滤波器实例（5 样本窗口 ≈ 在 2s 轮询间隔下 10s 平滑）
MovingAvg<float, 5>   filter_temp;
MovingAvg<float, 5>   filter_hum;
MovingAvg<float, 5>   filter_dust;
MovingMax<float, 5>   filter_dust_peak;

// 上一周期有效值（用于突变检测）
float    g_prev_temp = -99.0f;
float    g_prev_hum  = -99.0f;
uint16_t g_prev_dust = 0;

// ESP-NOW 发送就绪标志 (peer 添加成功后置 true)
bool g_espnow_ready = false;

// ==================== GP2Y1014AU 粉尘传感器读取 ====================
/**
 * 读取 GP2Y1014AU 粉尘浓度。
 *
 * 时序要求:
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
    delayMicroseconds(280);

    // 2. 多次采样 ADC (消除工频噪声)
    uint32_t sum = 0;
    const int samples = 16;
    for (int i = 0; i < samples; i++) {
        sum += analogRead(DUST_ADC_PIN);
        delayMicroseconds(40);
    }
    uint16_t adc_avg = sum / samples;

    // 3. 关闭 IR LED
    digitalWrite(DUST_LED_PIN, LOW);
    delayMicroseconds(9680);

    // 4. ADC → 电压 (ESP32 ADC 12-bit, 衰减11dB, 量程0~3.3V)
    //    GP2Y 输出经 1:2 分压, 实际电压 = adc_voltage * 2
    float adc_voltage = adc_avg * (3.3f / 4095.0f);
    float vo = adc_voltage * 2.0f;

    // 5. 电压 → 粉尘浓度
    return gp2y_calc_dust(vo, 5.0f);
}

// ==================== 边缘计算引擎 ====================
namespace Edge {

/**
 * 体感温度 Heat Index（Rothfusz 多元回归）
 * 仅在 T≥27°C 且 RH≥40% 时有效
 */
float calc_heat_index(float t_c, float rh) {
    if (t_c < 27.0f || rh < 40.0f) return t_c;

    float t_f = t_c * 1.8f + 32.0f;
    float t2  = t_f * t_f;
    float r2  = rh * rh;

    float hi_f = -42.379f
               + 2.04901523f * t_f
               + 10.14333127f * rh
               - 0.22475541f * t_f * rh
               - 0.00683783f * t2
               - 0.05481717f * r2
               + 0.00122874f * t2 * rh
               + 0.00085282f * t_f * r2
               - 0.00000199f * t2 * r2;

    if (hi_f < t_f) hi_f = t_f;
    return (hi_f - 32.0f) / 1.8f;
}

/**
 * 露点温度 Dew Point（Magnus 公式）
 */
float calc_dew_point(float t_c, float rh) {
    const float a = 17.27f;
    const float b = 237.7f;
    float gamma = log(rh / 100.0f) + (a * t_c) / (b + t_c);
    return (b * gamma) / (a - gamma);
}

/**
 * AQI 空气质量指数（基于粉尘浓度, 简化中国 HJ 633-2012）
 */
uint16_t calc_aqi(uint16_t dust) {
    if (dust <= 35)       return (uint16_t)((uint32_t)dust * 50 / 35);
    else if (dust <= 75)  return (uint16_t)(50  + (uint32_t)(dust - 35) * 50 / 40);
    else if (dust <= 115) return (uint16_t)(100 + (uint32_t)(dust - 75) * 50 / 40);
    else if (dust <= 150) return (uint16_t)(150 + (uint32_t)(dust - 115) * 50 / 35);
    else if (dust <= 250) return (uint16_t)(200 + (uint32_t)(dust - 150) * 100 / 100);
    else                  return (uint16_t)(300 + (uint32_t)(dust - 250) * 200 / 250);
}

/**
 * 数据质量评估 (0~100)
 */
uint8_t assess_quality(float t, float h, uint16_t dust, bool sensor_ok) {
    if (!sensor_ok) return 0;

    uint8_t score = 100;

    // 温度合理性检查
    if (t < -20.0f || t > 60.0f)  score -= 30;
    else if (t < -10.0f || t > 50.0f) score -= 10;

    // 湿度合理性检查
    if (h < 0.0f || h > 100.0f)  score -= 30;
    else if (h < 5.0f || h > 98.0f) score -= 10;

    // 粉尘浓度合理性检查
    if (dust > 1000) score -= 20;
    else if (dust > 500) score -= 10;

    return (score > 100) ? 100 : score;
}

/**
 * 异常检测
 */
uint8_t detect_anomalies(float t, float h, uint16_t dust,
                          float prev_t, float prev_h, uint16_t prev_dust,
                          bool sensor_ok) {
    uint8_t flags = ANOMALY_NONE;

    if (!sensor_ok) flags |= ANOMALY_SENSOR_ERR;

    if (t > EDGE_TEMP_HIGH) flags |= ANOMALY_TEMP_HIGH;
    if (t < EDGE_TEMP_LOW)  flags |= ANOMALY_TEMP_LOW;
    if (h > EDGE_HUM_HIGH)  flags |= ANOMALY_HUM_HIGH;
    if (dust > EDGE_DUST_HIGH) flags |= ANOMALY_DUST_HIGH;

    if (prev_t > -99.0f && fabs(t - prev_t) > EDGE_DELTA_TEMP)
        flags |= ANOMALY_SUDDEN_CHG;
    if (prev_h > -99.0f && fabs(h - prev_h) > EDGE_DELTA_HUM)
        flags |= ANOMALY_SUDDEN_CHG;
    if (prev_dust > 0 && dust > (uint16_t)(prev_dust * EDGE_DELTA_DUST))
        flags |= ANOMALY_SUDDEN_CHG;

    return flags;
}

} // namespace Edge

// ==================== 电池检测 ====================
uint8_t read_battery() {
    int   raw     = analogRead(BATTERY_PIN);
    float voltage = raw * (3.3f / 4095.0f) * 2.0f;
    float pct     = (voltage - 3.0f) / (4.2f - 3.0f) * 100.0f;
    if (pct < 0.0f)   pct = 0.0f;
    if (pct > 100.0f) pct = 100.0f;
    return (uint8_t)pct;
}

// ==================== ESP-NOW 回调 ====================
// 注意: ESP-NOW 回调运行在 WiFi 任务上下文, 禁止做耗时操作 (Serial.printf 等)
//       日志通过 g_pending_log 标志位延迟到 loop() 中输出

// 延迟日志结构 (避免在 ESP-NOW 回调中直接使用 Serial.printf)
volatile bool g_pending_log = false;
sensor_data_t g_last_sent;   // 最后一次发送的数据副本, 供 loop() 打印日志

void on_data_sent(const uint8_t *mac, esp_now_send_status_t status) {}

void on_data_recv(const uint8_t *mac, const uint8_t *data, int len) {
    // 数据包长度校验
    if (len < (int)sizeof(poll_request_t)) {
        Serial.printf("[RX] 数据包长度异常: %d (期望 %d)\n", len, sizeof(poll_request_t));
        return;
    }

    poll_request_t *req = (poll_request_t*)data;

    if (req->target_node != NODE_ID) return;

    // 心跳应答
    if (req->command == CMD_HEARTBEAT) {
        if (!g_espnow_ready) return;
        heartbeat_resp_t resp;
        resp.node_id = NODE_ID;
        resp.status  = 0x00;
        resp.battery = read_battery();
        resp.uptime  = millis() / 1000;
        esp_now_send(CENTER_MAC, (uint8_t*)&resp, sizeof(resp));
        return;
    }

    // 数据请求
    if (req->command != CMD_DATA_REQ) return;

    // ============ 边缘计算数据流水线 ============

    // Step 1: 读取原始传感器数据
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    bool  dht_ok = !(isnan(t) || isnan(h));

    uint16_t dust_raw = read_dust();

    // Step 2: 传感器容错
    if (!dht_ok) {
        t = g_prev_temp;
        h = g_prev_hum;
    }

    // Step 3: 滑动窗口均值滤波
    float ft = filter_temp.update(t);
    float fh = filter_hum.update(h);
    uint16_t fdust = (uint16_t)filter_dust.update((float)dust_raw);
    uint16_t fdust_peak = (uint16_t)filter_dust_peak.update((float)dust_raw);

    // Step 4: 边缘计算 — 衍生指标
    float    hi  = Edge::calc_heat_index(ft, fh);
    float    dp  = Edge::calc_dew_point(ft, fh);
    uint16_t aqi = Edge::calc_aqi(fdust);

    // Step 5: 边缘计算 — 数据质量 + 异常检测
    uint8_t quality = Edge::assess_quality(ft, fh, fdust, dht_ok);
    uint8_t anomaly = Edge::detect_anomalies(ft, fh, fdust,
                                              g_prev_temp, g_prev_hum, g_prev_dust,
                                              dht_ok);

    // 更新历史值
    if (dht_ok && filter_temp.ready()) {
        g_prev_temp = ft;
        g_prev_hum  = fh;
        g_prev_dust = fdust;
    }

    // Step 6: 组装数据包
    sensor_data_t sd;
    memset(&sd, 0, sizeof(sd));
    sd.node_id       = NODE_ID;
    sd.zone_id       = ZONE_ID;
    sd.temperature   = ft;
    sd.humidity      = fh;
    sd.dust_level    = fdust;
    sd.dust_peak     = fdust_peak;
    sd.heat_index    = hi;
    sd.dew_point     = dp;
    sd.aqi           = aqi;
    sd.anomaly_flags = anomaly;
    sd.data_quality  = quality;
    sd.timestamp     = millis();
    sd.battery       = read_battery();
    sd.crc           = calc_crc16((uint8_t*)&sd, sizeof(sd) - sizeof(uint16_t));

    // Step 7: ESP-NOW 上报
    if (!g_espnow_ready) return;
    esp_err_t err = esp_now_send(CENTER_MAC, (uint8_t*)&sd, sizeof(sd));
    if (err == ESP_OK) {
        // 复制数据供 loop() 打印日志 (不在回调中做慢速 I/O)
        memcpy((void*)&g_last_sent, &sd, sizeof(sd));
        g_pending_log = true;
    } else {
        Serial.printf("[TX] 发送失败 err=%d\n", err);
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
    Serial.begin(115200);
    Serial.printf("\n[SUB]  子节点 %d 启动 (区域: %d — %s) [GP2Y1014AU+DHT22]\n",
                  NODE_ID, ZONE_ID, ZONE_NAMES[ZONE_ID]);

    // ---- GPIO ----
    pinMode(DUST_LED_PIN, OUTPUT);
    digitalWrite(DUST_LED_PIN, LOW);

    // ---- ADC ----
    analogReadResolution(12);
    analogSetAttenuation(ADC_11db);

    // ---- DHT22 ----
    dht.begin();
    dht_warmup();

    // ---- GP2Y1014AU 初始读数 (丢弃前几次) ----
    for (int i = 0; i < 5; i++) {
        read_dust();
        delay(12);
    }
    Serial.println("[DUST] GP2Y1014AU 已就绪");

    // ---- WiFi + ESP-NOW ----
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();

    if (esp_now_init() != ESP_OK) {
        Serial.println("[ESP-NOW] 初始化失败! 系统暂停.");
        while (1) delay(1000);
    }

    esp_now_register_recv_cb(on_data_recv);
    esp_now_register_send_cb(on_data_sent);

    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, CENTER_MAC, 6);
    peer.channel = 0;
    peer.encrypt = false;

    // 检查 MAC 地址是否已配置 (非全0xFF且非全0x00)
    bool mac_configured = false;
    for (int i = 0; i < 6; i++) {
        if (CENTER_MAC[i] != 0xFF && CENTER_MAC[i] != 0x00) {
            mac_configured = true;
            break;
        }
    }
    if (!mac_configured) {
        Serial.println("[ESP-NOW]  中心节点 MAC 未配置! 请在代码中填入实际 MAC 地址。");
        Serial.println("[ESP-NOW]  当前 MAC 为全 FF, ESP-NOW 发送将被禁用。");
    } else if (esp_now_add_peer(&peer) != ESP_OK) {
        Serial.println("[ESP-NOW] 添加中心节点失败! ESP-NOW 发送将被禁用。");
    } else {
        g_espnow_ready = true;
        Serial.println("[ESP-NOW] 中心节点 peer 已添加");
    }

    Serial.print("[INFO] 本节点 MAC: ");
    Serial.println(WiFi.macAddress());
    Serial.printf("[INFO] 节点ID=%d  区域=%s  滤波窗口=5  传感器=GP2Y1014AU+DHT22\n",
                  NODE_ID, ZONE_NAMES[ZONE_ID]);
    Serial.println("[INFO] 流水线: 采样→滤波→体感温度/露点/AQI→异常检测→质量评分→上报");
    Serial.println("[SYS] 子节点就绪，等待中心节点轮询...\n");
}

void loop() {
    // 延迟日志输出 (避免在 ESP-NOW 回调中阻塞)
    if (g_pending_log) {
        g_pending_log = false;
        sensor_data_t sd = g_last_sent;
        Serial.printf("[TX] T=%.1f H=%.1f 粉尘=%d ug/m³ 峰值=%d "
                      "HI=%.1f DP=%.1f AQI=%d Q=%d FLG=0x%02X 电池=%d%%\n",
                      sd.temperature, sd.humidity, sd.dust_level, sd.dust_peak,
                      sd.heat_index, sd.dew_point, sd.aqi,
                      sd.data_quality, sd.anomaly_flags, sd.battery);
    }
    delay(100);
}
